// Digest automático: lectura de fuentes (Gmail y Calendar vía Google Workspace) y Bandeja de propuestas.
// Flujo: un proceso externo (tarea programada de Claude) llama a /api/ingest/* con INGEST_TOKEN,
// lee novedades, y carga PROPUESTAS. Nada se escribe en las tablas hasta que un admin aprueba.
import { conEtapas } from "./seguimiento.js";
import crypto from "node:crypto";
import { eq, desc } from "drizzle-orm";

const today = () => new Date().toISOString().slice(0, 10);
const OPS = ["crear", "actualizar", "bitacora", "minuta"];
const COLECCIONES = ["busquedas", "candidatos", "postulaciones", "clientes", "leads", "facturas", "busquedasFin"];
const CON_MINUTAS = ["busquedas", "candidatos", "clientes", "leads"];
const PREFIJO = { busquedas: "b", candidatos: "c", postulaciones: "p", clientes: "cl", leads: "l", facturas: "f" };

export const CREATE_SQL = `CREATE TABLE IF NOT EXISTS propuestas (
  id text PRIMARY KEY,
  ref text CONSTRAINT propuestas_ref_unique UNIQUE,
  fuente text,
  cuenta text,
  fecha text,
  resumen text NOT NULL,
  evidencia text,
  link text,
  coleccion text NOT NULL,
  registro_id text,
  op text NOT NULL,
  datos jsonb DEFAULT '{}'::jsonb,
  estado text NOT NULL DEFAULT 'Pendiente',
  revisado_por text,
  revisado_en text,
  creado timestamp DEFAULT now()
)`;

export function registerDigest(app, { db, pool, S, auth, rank, RANK, R, clean, newId, getTableColumns }) {
  pool.query(CREATE_SQL).catch((e) => console.error("No se pudo crear la tabla propuestas:", e.message));

  // ---------- token para procesos automáticos ----------
  const ingest = (req, res, next) => {
    const tok = process.env.INGEST_TOKEN || "";
    const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (tok.length < 20) return res.status(503).json({ error: "Falta configurar INGEST_TOKEN (mínimo 20 caracteres) en Secrets." });
    const a = Buffer.from(tok), b = Buffer.from(got);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Token inválido." });
    next();
  };

  // Contexto compacto para que el digest sepa qué búsquedas, candidatos, clientes y facturas existen.
  app.get("/api/ingest/contexto", ingest, async (req, res, next) => {
    try {
      const [bus, cands, posts, clis, leads, facts, eqRow, dgRow, pend] = await Promise.all([
        db.select().from(S.busquedas), db.select().from(S.candidatos), db.select().from(S.postulaciones),
        db.select().from(S.clientes), db.select().from(S.leads), db.select().from(S.facturas),
        db.select().from(S.config).where(eq(S.config.key, "equipo")),
        db.select().from(S.config).where(eq(S.config.key, "digest")),
        db.select({ ref: S.propuestas.ref, resumen: S.propuestas.resumen }).from(S.propuestas).where(eq(S.propuestas.estado, "Pendiente")),
      ]);
      const hace60 = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
      const busV = bus.filter((b) => ["Activa", "En pausa"].includes(b.estado) || (b.fechaCierre || "") >= hace60);
      const busIds = new Set(busV.map((b) => b.id));
      const postsV = posts.filter((p) => busIds.has(p.busquedaId));
      res.json({
        hoy: today(),
        digest: dgRow[0]?.value || null,
        equipo: eqRow[0]?.value?.recruiters?.map((r) => r.nombre) || [],
        busquedas: busV.map((b) => ({ id: b.id, puesto: b.puesto, cliente: b.cliente, recruiter: b.recruiter, estado: b.estado, proximoPaso: b.proximoPaso, actualizado: b.actualizado, ultimaBitacora: (b.bitacora || []).slice(-1)[0]?.texto || null })),
        postulaciones: postsV.map((p) => ({ id: p.id, busquedaId: p.busquedaId, candidatoId: p.candidatoId, etapa: p.etapa })),
        candidatos: cands.map((c) => ({ id: c.id, nombre: c.nombre, email: c.email, telefono: c.telefono, linkedin: c.linkedin, empresaActual: c.empresaActual })),
        clientes: clis.map((c) => ({ id: c.id, nombre: c.nombre, contactos: c.contactos })),
        leads: leads.filter((l) => !["Ganado", "Perdido"].includes(l.etapa)).map((l) => ({ id: l.id, empresa: l.empresa, contacto: l.contacto, etapa: l.etapa, proximoSeguimiento: l.proximoSeguimiento })),
        facturasPendientes: facts.filter((f) => !f.cobrada).map((f) => ({ id: f.id, cliente: f.cliente, monto: f.monto, moneda: f.moneda, concepto: f.concepto, fechaEmision: f.fechaEmision })),
        propuestasPendientes: pend,
        reglas: {
          ops: OPS, colecciones: COLECCIONES,
          etapasPostulacion: ["Sourcing", "Contactado", "Entrevista LT", "Presentado", "Entrevista cliente", "Oferta", "Contratado", "Descartado"],
          estadosBusqueda: ["Activa", "En pausa", "Cerrada", "Cancelada"],
          etapasLead: ["Nuevo", "Contactado", "En conversación", "Propuesta enviada", "Ganado", "Perdido"],
        },
      });
    } catch (e) { next(e); }
  });

  // Carga de propuestas (deduplica por ref: id del mail, evento o chat).
  app.post("/api/ingest/propuestas", ingest, async (req, res, next) => {
    try {
      const list = Array.isArray(req.body) ? req.body : req.body?.propuestas || [];
      let creadas = 0, duplicadas = 0; const errores = [];
      for (const [i, p] of list.entries()) {
        if (!p || !p.resumen || !COLECCIONES.includes(p.coleccion) || !OPS.includes(p.op)) { errores.push({ i, error: "Falta resumen o coleccion/op inválida." }); continue; }
        if (["actualizar", "bitacora", "minuta"].includes(p.op) && !p.registroId) { errores.push({ i, error: "Falta registroId." }); continue; }
        if (p.op === "bitacora" && p.coleccion !== "busquedas") { errores.push({ i, error: "La bitácora es solo para búsquedas." }); continue; }
        if (p.op === "minuta" && !CON_MINUTAS.includes(p.coleccion)) { errores.push({ i, error: "Esa colección no tiene minutas." }); continue; }
        const row = {
          id: newId("pr"), ref: p.ref ? String(p.ref).slice(0, 300) : null, fuente: p.fuente || null, cuenta: p.cuenta || null,
          fecha: p.fecha || null, resumen: String(p.resumen).slice(0, 500), evidencia: p.evidencia ? String(p.evidencia).slice(0, 2000) : null,
          link: p.link || null, coleccion: p.coleccion, registroId: p.registroId || null, op: p.op,
          datos: p.datos && typeof p.datos === "object" ? p.datos : {}, estado: "Pendiente",
        };
        const out = await db.insert(S.propuestas).values(row).onConflictDoNothing().returning({ id: S.propuestas.id });
        out.length ? creadas++ : duplicadas++;
      }
      res.json({ creadas, duplicadas, errores });
    } catch (e) { next(e); }
  });

  // Marca de la última lectura (para leer solo lo nuevo en cada corrida).
  app.put("/api/ingest/cursor", ingest, async (req, res, next) => {
    try {
      const value = { ...(req.body || {}), actualizado: new Date().toISOString() };
      await db.insert(S.config).values({ key: "digest", value }).onConflictDoUpdate({ target: S.config.key, set: { value } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Novedades de Gmail y Calendar de las cuentas del equipo (Google Workspace, delegación de dominio).
  app.get("/api/ingest/google", ingest, async (req, res, next) => {
    try {
      if (!process.env.GOOGLE_SA_JSON) return res.status(503).json({ error: "Falta GOOGLE_SA_JSON en Secrets." });
      const sa = JSON.parse(process.env.GOOGLE_SA_JSON);
      const desde = new Date(req.query.desde || Date.now() - 2 * 3600e3);
      if (isNaN(desde)) return res.status(400).json({ error: "Parámetro desde inválido." });
      const max = Math.min(Number(req.query.max) || 60, 150);
      let cuentas = (process.env.GOOGLE_CUENTAS || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!cuentas.length) {
        const dom = (process.env.GOOGLE_DOMINIO || "lemontalent.com").toLowerCase();
        cuentas = (await db.select().from(S.users)).filter((u) => u.activo && u.email.endsWith("@" + dom)).map((u) => u.email);
      }
      const out = [];
      for (const cuenta of cuentas) {
        const r = { cuenta, mails: [], eventos: [], errores: [] };
        try { r.mails = await gmailDesde(sa, cuenta, desde, max); } catch (e) { r.errores.push("Gmail: " + e.message); }
        try { r.eventos = await calendarDesde(sa, cuenta, desde); } catch (e) { r.errores.push("Calendar: " + e.message); }
        out.push(r);
      }
      res.json({ desde: desde.toISOString(), hasta: new Date().toISOString(), cuentas: out });
    } catch (e) { next(e); }
  });

  // ---------- Bandeja de propuestas (admins) ----------
  app.get("/api/propuestas", auth("admin"), async (req, res, next) => {
    try { res.json(await db.select().from(S.propuestas).orderBy(desc(S.propuestas.creado)).limit(800)); } catch (e) { next(e); }
  });

  app.post("/api/propuestas/:id/rechazar", auth("admin"), async (req, res, next) => {
    try {
      await db.update(S.propuestas).set({ estado: "Rechazada", revisadoPor: req.user.id, revisadoEn: new Date().toISOString() }).where(eq(S.propuestas.id, req.params.id));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.post("/api/propuestas/:id/aprobar", auth("admin"), async (req, res, next) => {
    try {
      const [p] = await db.select().from(S.propuestas).where(eq(S.propuestas.id, req.params.id));
      if (!p) return res.status(404).json({ error: "No existe esa propuesta." });
      if (p.estado !== "Pendiente") return res.status(400).json({ error: "Esa propuesta ya fue revisada." });
      const r = R[p.coleccion];
      if (!r || rank(req.user) < RANK[r.write || r.min]) return res.status(403).json({ error: "No tenés permiso para aplicar este cambio." });
      const datos = req.body && req.body.datos && typeof req.body.datos === "object" ? req.body.datos : p.datos || {};
      const cols = getTableColumns(r.t);
      let regId = p.registroId;

      if (p.op === "crear") {
        const { _busquedaId, _etapa, ...resto } = datos;
        const vals = clean(r.t, resto); delete vals.id;
        if (p.coleccion === "candidatos" && !vals.creado) vals.creado = today();
        if (p.coleccion === "busquedas" && !vals.fechaInicio) vals.fechaInicio = today();
        regId = regId || newId(PREFIJO[p.coleccion] || "x");
        await db.insert(r.t).values({ ...vals, id: regId });
        if (p.coleccion === "candidatos" && _busquedaId)
          await db.insert(S.postulaciones).values({ id: newId("p"), busquedaId: _busquedaId, candidatoId: regId, etapa: _etapa || "Contactado", fecha: today(), etapas: [{ etapa: _etapa || "Contactado", fecha: today(), autor: req.user.id }] });
      } else {
        const [row] = await db.select().from(r.t).where(eq(cols.id, regId));
        if (!row) return res.status(404).json({ error: "El registro de esta propuesta ya no existe." });
        if (p.op === "actualizar") {
          const vals = clean(r.t, datos); delete vals.id;
          if (p.coleccion === "postulaciones") conEtapas(vals, row, req.user); // historial de etapas (p. ej. opinión del cliente)
          if (p.coleccion === "busquedas") vals.actualizado = today();
          if (Object.keys(vals).length) await db.update(r.t).set(vals).where(eq(cols.id, regId));
        } else if (p.op === "bitacora") {
          const texto = String(datos.texto || p.resumen);
          const bitacora = [...(row.bitacora || []), { fecha: datos.fecha || today(), texto, autor: req.user.id, fuente: p.fuente || "Digest" }];
          const set = { bitacora, actualizado: today() };
          if (datos.proximoPaso) set.proximoPaso = String(datos.proximoPaso);
          await db.update(r.t).set(set).where(eq(cols.id, regId));
        } else if (p.op === "minuta") {
          if (!datos.url) return res.status(400).json({ error: "La minuta no tiene link." });
          const minutas = row.minutas || [];
          if (!minutas.some((m) => m.url === datos.url)) minutas.push({ fecha: datos.fecha || today(), titulo: datos.titulo || "Reunión", url: datos.url });
          await db.update(r.t).set({ minutas }).where(eq(cols.id, regId));
        }
      }
      await db.update(S.propuestas).set({ estado: "Aprobada", datos, registroId: regId, revisadoPor: req.user.id, revisadoEn: new Date().toISOString() }).where(eq(S.propuestas.id, p.id));
      res.json({ ok: true, coleccion: p.coleccion, id: regId });
    } catch (e) {
      if (String(e.code || "").startsWith("23")) return res.status(400).json({ error: "Faltan datos obligatorios o el registro ya existe. Editá la propuesta y probá de nuevo." });
      next(e);
    }
  });
}

// ---------- Google (cuenta de servicio con delegación de dominio) ----------
const tokens = new Map();
export async function googleToken(sa, sub, scope) {
  const k = sub + "|" + scope, hit = tokens.get(k);
  if (hit && hit.exp > Date.now() + 60e3) return hit.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({ iss: sa.client_email, sub, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + sig }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || "no se pudo autenticar");
  tokens.set(k, { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}
async function gget(url, token) {
  const r = await fetch(url, { headers: { authorization: "Bearer " + token } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || "HTTP " + r.status);
  return j;
}
const decode = (d) => Buffer.from(String(d || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
function textoDe(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  if (part.parts) { for (const p of part.parts) { const t = textoDe(p); if (t) return t; } }
  if (part.mimeType === "text/html" && part.body?.data)
    return decode(part.body.data).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  return "";
}
async function gmailDesde(sa, cuenta, desde, max) {
  const token = await googleToken(sa, cuenta, "https://www.googleapis.com/auth/gmail.readonly");
  const q = `after:${Math.floor(desde.getTime() / 1000)} -in:chats -category:promotions -category:social -category:forums`;
  const base = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(cuenta)}/messages`;
  const list = await gget(`${base}?maxResults=${max}&q=${encodeURIComponent(q)}`, token);
  const out = [];
  for (const m of list.messages || []) {
    const full = await gget(`${base}/${m.id}?format=full`, token);
    const h = Object.fromEntries((full.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    out.push({
      ref: "gmail:" + full.id, threadId: full.threadId, fecha: new Date(Number(full.internalDate)).toISOString(),
      de: h.from, para: h.to, cc: h.cc, asunto: h.subject, enviado: (full.labelIds || []).includes("SENT"),
      texto: textoDe(full.payload).replace(/\n{3,}/g, "\n\n").slice(0, 2500),
      link: `https://mail.google.com/mail/u/${cuenta}/#all/${full.id}`,
    });
  }
  return out;
}
async function calendarDesde(sa, cuenta, desde) {
  const token = await googleToken(sa, cuenta, "https://www.googleapis.com/auth/calendar.readonly");
  const p = new URLSearchParams({
    updatedMin: desde.toISOString(), timeMin: new Date(Date.now() - 30 * 864e5).toISOString(), timeMax: new Date(Date.now() + 21 * 864e5).toISOString(),
    singleEvents: "true", maxResults: "100", showDeleted: "true",
  });
  const j = await gget(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cuenta)}/events?${p}`, token);
  return (j.items || []).map((e) => ({
    ref: "gcal:" + e.id + ":" + (e.updated || ""), estado: e.status, titulo: e.summary, inicio: e.start?.dateTime || e.start?.date, fin: e.end?.dateTime || e.end?.date,
    asistentes: (e.attendees || []).map((a) => a.email), organizador: e.organizer?.email,
    descripcion: String(e.description || "").replace(/<[^>]+>/g, " ").slice(0, 1500), link: e.htmlLink,
  }));
}
