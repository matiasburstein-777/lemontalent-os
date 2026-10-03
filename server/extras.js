// Historial de cambios, papelera (30 días), archivos adjuntos (CV) y backup.
import crypto from "node:crypto";
import { eq, getTableColumns } from "drizzle-orm";

export const EXTRAS_SQL = `
CREATE TABLE IF NOT EXISTS historial (
  id bigserial PRIMARY KEY,
  fecha timestamp DEFAULT now(),
  usuario_id text,
  coleccion text NOT NULL,
  registro_id text NOT NULL,
  accion text NOT NULL,
  cambios jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS historial_reg_idx ON historial (coleccion, registro_id);
CREATE TABLE IF NOT EXISTS papelera (
  id text PRIMARY KEY,
  fecha timestamp DEFAULT now(),
  usuario_id text,
  coleccion text NOT NULL,
  registro_id text NOT NULL,
  datos jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS archivos (
  id text PRIMARY KEY,
  fecha timestamp DEFAULT now(),
  usuario_id text,
  coleccion text NOT NULL,
  registro_id text NOT NULL,
  nombre text NOT NULL,
  tipo text,
  tamano integer,
  datos bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS archivos_reg_idx ON archivos (coleccion, registro_id);`;

// Colecciones visibles por rol (para filtrar el historial)
const VISIBLE = {
  recruiter: ["busquedas", "candidatos", "postulaciones", "feedback"],
  admin: ["busquedas", "candidatos", "postulaciones", "feedback", "busquedasFin", "facturas", "clientes", "leads"],
};
const ADJUNTOS = { candidatos: "recruiter", busquedas: "recruiter", clientes: "admin", leads: "admin" };
const MAX_ARCHIVO = 8 * 1024 * 1024;

const corto = (v) => {
  if (v === undefined) return null;
  if (Array.isArray(v)) return `[${v.length} ítems]`;
  if (v && typeof v === "object") return "{…}";
  const s = v === null ? null : String(v);
  return s && s.length > 160 ? s.slice(0, 157) + "…" : s;
};
export function diff(antes, despues) {
  const out = {};
  const keys = new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})]);
  for (const k of keys) {
    if (k === "id" || k === "actualizado" || k === "etapas") continue; // etapas: lo arma el servidor, ya queda el cambio de etapa
    if (despues && !(k in despues)) continue; // solo lo que se envió
    const a = antes ? antes[k] : undefined, b = despues ? despues[k] : undefined;
    const na = a === "" ? null : a ?? null, nb = b === "" ? null : b ?? null;
    if (JSON.stringify(na) === JSON.stringify(nb)) continue;
    if (Array.isArray(na) || Array.isArray(nb)) {
      const la = (na || []).length, lb = (nb || []).length;
      out[k] = [`${la} ítems`, lb > la ? `${lb} ítems (+${lb - la})` : `${lb} ítems`];
    } else out[k] = [corto(na), corto(nb)];
  }
  return out;
}

export function registerExtras(app, { db, pool, S, auth, rank, RANK, R, newId }) {
  pool.query(EXTRAS_SQL).catch((e) => console.error("No se pudieron crear las tablas de historial/papelera/archivos:", e.message));

  const ingest = (req, res, next) => {
    const tok = process.env.INGEST_TOKEN || "";
    const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (tok.length < 20) return res.status(503).json({ error: "Falta configurar INGEST_TOKEN en Secrets." });
    const a = Buffer.from(tok), b = Buffer.from(got);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Token inválido." });
    next();
  };

  // ---------- helpers que usa la API genérica ----------
  const H = {
    async leer(r, id) {
      const cols = getTableColumns(r.t);
      const [row] = await db.select().from(r.t).where(eq(cols[r.pk || "id"], id));
      return row || null;
    },
    async registrar(user, coleccion, id, accion, antes, despues) {
      try {
        const cambios = accion === "borrar" ? {} : diff(antes, despues);
        if (accion === "editar" && !Object.keys(cambios).length) return;
        await pool.query("INSERT INTO historial (usuario_id, coleccion, registro_id, accion, cambios) VALUES ($1,$2,$3,$4,$5)",
          [user?.id || null, coleccion, String(id), accion, JSON.stringify(cambios)]);
      } catch (e) { console.error("historial:", e.message); }
    },
    async aPapelera(user, coleccion, id, datos) {
      if (!datos) return;
      await pool.query("INSERT INTO papelera (id, usuario_id, coleccion, registro_id, datos) VALUES ($1,$2,$3,$4,$5)",
        [newId("pp"), user?.id || null, coleccion, String(id), JSON.stringify(datos)]);
    },
  };

  // ---------- historial ----------
  app.get("/api/historial", auth(), async (req, res, next) => {
    try {
      const { coleccion, registro, limite } = req.query;
      const params = []; const where = [];
      if (coleccion) { params.push(coleccion); where.push(`coleccion = $${params.length}`); }
      if (registro) { params.push(registro); where.push(`registro_id = $${params.length}`); }
      if (req.user.rol !== "socio") { params.push(VISIBLE[req.user.rol] || VISIBLE.recruiter); where.push(`coleccion = ANY($${params.length})`); }
      const lim = Math.min(Number(limite) || 300, 1000);
      const { rows } = await pool.query(`SELECT id, fecha, usuario_id, coleccion, registro_id, accion, cambios FROM historial ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY fecha DESC LIMIT ${lim}`, params);
      res.json(rows.map((r) => ({ id: r.id, fecha: r.fecha, usuarioId: r.usuario_id, coleccion: r.coleccion, registroId: r.registro_id, accion: r.accion, cambios: r.cambios })));
    } catch (e) { next(e); }
  });

  // ---------- papelera ----------
  app.get("/api/papelera", auth("socio"), async (req, res, next) => {
    try {
      await pool.query("DELETE FROM papelera WHERE fecha < now() - interval '30 days'");
      const { rows } = await pool.query("SELECT id, fecha, usuario_id, coleccion, registro_id, datos FROM papelera ORDER BY fecha DESC LIMIT 500");
      res.json(rows.map((r) => ({ id: r.id, fecha: r.fecha, usuarioId: r.usuario_id, coleccion: r.coleccion, registroId: r.registro_id, datos: r.datos })));
    } catch (e) { next(e); }
  });
  app.post("/api/papelera/:id/restaurar", auth("socio"), async (req, res, next) => {
    try {
      const { rows } = await pool.query("SELECT * FROM papelera WHERE id = $1", [req.params.id]);
      const p = rows[0]; if (!p) return res.status(404).json({ error: "Ya no está en la papelera." });
      const r = R[p.coleccion]; if (!r) return res.status(400).json({ error: "Colección desconocida." });
      const cols = getTableColumns(r.t); const pk = r.pk || "id";
      const vals = {}; for (const k of Object.keys(cols)) if (k in p.datos) vals[k] = p.datos[k];
      vals[pk] = p.registro_id;
      await db.insert(r.t).values(vals).onConflictDoNothing();
      await pool.query("DELETE FROM papelera WHERE id = $1", [p.id]);
      await H.registrar(req.user, p.coleccion, p.registro_id, "restaurar", null, null);
      res.json({ ok: true, coleccion: p.coleccion, id: p.registro_id });
    } catch (e) { next(e); }
  });

  // ---------- archivos (CV) ----------
  const puedeAdjuntar = (user, col) => ADJUNTOS[col] && rank(user) >= RANK[ADJUNTOS[col]];
  app.get("/api/archivos", auth(), async (req, res, next) => {
    try {
      const { coleccion, registro } = req.query;
      if (!puedeAdjuntar(req.user, coleccion)) return res.status(403).json({ error: "No tenés permiso para ver esto." });
      const { rows } = await pool.query("SELECT id, fecha, usuario_id, nombre, tipo, tamano FROM archivos WHERE coleccion=$1 AND registro_id=$2 ORDER BY fecha DESC", [coleccion, registro]);
      res.json(rows.map((r) => ({ id: r.id, fecha: r.fecha, usuarioId: r.usuario_id, nombre: r.nombre, tipo: r.tipo, tamano: r.tamano })));
    } catch (e) { next(e); }
  });
  app.post("/api/archivos", auth(), async (req, res, next) => {
    try {
      const { coleccion, registroId, nombre, tipo, base64 } = req.body || {};
      if (!puedeAdjuntar(req.user, coleccion)) return res.status(403).json({ error: "No tenés permiso para adjuntar acá." });
      if (!registroId || !nombre || !base64) return res.status(400).json({ error: "Falta el archivo." });
      const buf = Buffer.from(String(base64), "base64");
      if (buf.length > MAX_ARCHIVO) return res.status(400).json({ error: "El archivo supera los 8 MB." });
      const id = newId("ar");
      await pool.query("INSERT INTO archivos (id, usuario_id, coleccion, registro_id, nombre, tipo, tamano, datos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, req.user.id, coleccion, String(registroId), String(nombre).slice(0, 200), tipo || "application/octet-stream", buf.length, buf]);
      await H.registrar(req.user, coleccion, registroId, "adjuntar", {}, { archivo: nombre });
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });
  app.get("/api/archivos/:id", auth(), async (req, res, next) => {
    try {
      const { rows } = await pool.query("SELECT * FROM archivos WHERE id=$1", [req.params.id]);
      const a = rows[0]; if (!a) return res.status(404).json({ error: "No existe ese archivo." });
      if (!puedeAdjuntar(req.user, a.coleccion)) return res.status(403).json({ error: "No tenés permiso para ver esto." });
      res.setHeader("Content-Type", a.tipo || "application/octet-stream");
      res.setHeader("Content-Disposition", `${req.query.ver ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
      res.send(a.datos);
    } catch (e) { next(e); }
  });
  app.delete("/api/archivos/:id", auth(), async (req, res, next) => {
    try {
      const { rows } = await pool.query("SELECT id, usuario_id, coleccion, registro_id, nombre FROM archivos WHERE id=$1", [req.params.id]);
      const a = rows[0]; if (!a) return res.json({ ok: true });
      if (a.usuario_id !== req.user.id && req.user.rol !== "socio") return res.status(403).json({ error: "Solo quien lo subió o un socio puede borrarlo." });
      await pool.query("DELETE FROM archivos WHERE id=$1", [a.id]);
      await H.registrar(req.user, a.coleccion, a.registro_id, "editar", { archivo: a.nombre }, { archivo: null });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- backup ----------
  async function backup() {
    const out = { generado: new Date().toISOString(), version: 1, tablas: {} };
    const tablas = ["busquedas", "busquedas_fin", "candidatos", "postulaciones", "facturas", "clientes", "leads", "meses", "config", "feedback", "propuestas", "historial"];
    for (const t of tablas) {
      try { out.tablas[t] = (await pool.query(`SELECT * FROM ${t}`)).rows; } catch { out.tablas[t] = null; }
    }
    out.tablas.users = (await pool.query("SELECT id, email, nombre, rol, activo, creado FROM users")).rows;
    out.tablas.archivos = (await pool.query("SELECT id, fecha, coleccion, registro_id, nombre, tipo, tamano FROM archivos")).rows;
    return out;
  }
  const enviarBackup = async (req, res, next) => {
    try {
      const b = await backup();
      res.setHeader("Content-Disposition", `attachment; filename="lemon-talent-backup-${b.generado.slice(0, 10)}.json"`);
      res.json(b);
    } catch (e) { next(e); }
  };
  app.get("/api/backup", auth("socio"), enviarBackup);
  app.get("/api/ingest/backup", ingest, enviarBackup);

  return H;
}
