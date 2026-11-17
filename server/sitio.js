// Sitio público de Lemon Talent (public/sitio/) y búsquedas abiertas con postulación, sin login.
// - GET  /api/publico/busquedas: solo búsquedas Activas marcadas "Publicar en la web", con campos públicos.
// - POST /api/publico/postular: crea o completa el candidato (fuente "Postulación") y lo suma a la búsqueda en Sourcing.
// - En los hosts de SITE_HOSTS (lemontalent.com), "/" muestra el sitio en lugar del OS.
import path from "node:path";
import { enviarMail, plantilla, destinatariosBusqueda, APP_URL, escHtml } from "./mail.js";
import { hoyBA } from "./seguimiento.js";

const SQL = `
ALTER TABLE busquedas ADD COLUMN IF NOT EXISTS publicar_web boolean DEFAULT false;
ALTER TABLE busquedas ADD COLUMN IF NOT EXISTS mostrar_cliente_web boolean DEFAULT false;
ALTER TABLE busquedas ADD COLUMN IF NOT EXISTS rubro_web text;
ALTER TABLE busquedas ADD COLUMN IF NOT EXISTS ubicacion_web text;
ALTER TABLE busquedas ADD COLUMN IF NOT EXISTS descripcion_web text;
ALTER TABLE busquedas ADD COLUMN IF NOT EXISTS link_empresa_web text;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS consentimiento_web date;`;

export async function migrarSitio(pool) { await pool.query(SQL); }

const MAX_CV = 5 * 1024 * 1024;
const LIMITE = 5;                    // postulaciones por IP
const VENTANA = 60 * 60 * 1000;      // por hora
const intentos = new Map();          // ip -> [timestamps]
const ipDe = (req) => String(req.ip || req.headers["x-forwarded-for"] || "").split(",")[0].trim();

export const normLi = (u) => String(u || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
const txt = (v, max) => String(v ?? "").trim().slice(0, max);

const MSG = {
  es: {
    datos: "Completá nombre, email y LinkedIn.", email: "Revisá el email.", li: "Pegá el link a tu perfil de LinkedIn.",
    acepta: "Necesitamos tu consentimiento para guardar tus datos.", cv: "El CV tiene que ser un PDF de hasta 5 MB.",
    busq: "Esta búsqueda ya no está abierta.", limite: "Recibimos varias postulaciones desde tu conexión. Probá de nuevo en un rato.",
  },
  en: {
    datos: "Please fill in your name, email and LinkedIn.", email: "Please check your email.", li: "Please paste your LinkedIn profile link.",
    acepta: "We need your consent to store your details.", cv: "Your CV must be a PDF up to 5 MB.",
    busq: "This role is no longer open.", limite: "We’ve received several applications from your connection. Please try again later.",
  },
};

// Lo que se publica de una búsqueda: nunca recruiter, montos, notas, bitácora, job description interna ni candidatos.
export function busquedaPublica(b) {
  return {
    id: b.id,
    puesto: b.puesto,
    empresa: b.mostrar_cliente_web ? b.cliente || null : b.rubro_web || null,
    rubro: b.mostrar_cliente_web ? b.rubro_web || null : null,
    link: b.mostrar_cliente_web && /^https:\/\/[^\s"<>]+$/i.test(b.link_empresa_web || "") ? b.link_empresa_web : null,
    area: b.area || null,
    seniority: b.seniority || null,
    ubicacion: b.ubicacion_web || null,
    descripcion: b.descripcion_web || null,
  };
}

export function registerSitio(app, { pool, newId, publicDir }) {
  const sitioDir = path.join(publicDir, "sitio");
  const hosts = () => (process.env.SITE_HOSTS || "lemontalent.com,www.lemontalent.com").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

  // En el dominio del sitio, "/" y "/assets/*" son el sitio público; todo lo demás sigue igual.
  app.use((req, res, next) => {
    if (req.method !== "GET" || !hosts().includes(String(req.hostname || "").toLowerCase())) return next();
    if (req.path === "/") return res.sendFile(path.join(sitioDir, "index.html"));
    if (req.path.startsWith("/assets/")) {
      const f = path.normalize(path.join(sitioDir, req.path));
      if (!f.startsWith(path.join(sitioDir, "assets") + path.sep)) return res.status(404).end();
      return res.sendFile(f, (e) => (e ? next() : undefined));
    }
    next();
  });

  let cache = { t: 0, data: null };
  app.get("/api/publico/busquedas", async (req, res, next) => {
    try {
      if (!cache.data || Date.now() - cache.t > 60_000) {
        const { rows } = await pool.query(
          `SELECT id, puesto, cliente, area, seniority, mostrar_cliente_web, rubro_web, ubicacion_web, descripcion_web, link_empresa_web
             FROM busquedas WHERE estado = 'Activa' AND publicar_web IS TRUE
             ORDER BY coalesce(fecha_reapertura, fecha_inicio) DESC NULLS LAST, id`);
        cache = { t: Date.now(), data: rows.map(busquedaPublica) };
      }
      res.set("Cache-Control", "public, max-age=60");
      res.json({ busquedas: cache.data });
    } catch (e) { next(e); }
  });
  app.locals.limpiarCacheSitio = () => { cache = { t: 0, data: null }; };

  app.post("/api/publico/postular", async (req, res, next) => {
    const b0 = req.body || {};
    const M = MSG[b0.idioma === "en" ? "en" : "es"];
    const error = (status, msg) => res.status(status).json({ ok: false, error: msg });
    try {
      // Honeypot: un bot completa el campo oculto; se responde como si nada.
      if (txt(b0.web, 200)) return res.json({ ok: true });

      const ip = ipDe(req), ahora = Date.now();
      const previos = (intentos.get(ip) || []).filter((t) => ahora - t < VENTANA);
      if (previos.length >= LIMITE) return error(429, M.limite);

      const nombre = txt(b0.nombre, 120), email = txt(b0.email, 160).toLowerCase(), telefono = txt(b0.telefono, 40);
      const linkedin = txt(b0.linkedin, 300), mensaje = txt(b0.mensaje, 2000), busquedaId = txt(b0.busquedaId, 80);
      if (!nombre || !email || !linkedin) return error(400, M.datos);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(400, M.email);
      if (!/(^|\.|\/)linkedin\.com\//i.test(linkedin)) return error(400, M.li);
      if (!(b0.acepta === true || b0.acepta === "on" || b0.acepta === "true")) return error(400, M.acepta);

      let cv = null;
      if (b0.cv && b0.cv.base64) {
        const buf = Buffer.from(String(b0.cv.base64), "base64");
        if (buf.length > MAX_CV || buf.subarray(0, 4).toString("latin1") !== "%PDF") return error(400, M.cv);
        cv = { nombre: txt(b0.cv.nombre, 200) || "CV.pdf", buf };
      }

      let b = null;
      if (busquedaId) {
        const { rows } = await pool.query("SELECT id, puesto, cliente, recruiter FROM busquedas WHERE id = $1 AND estado = 'Activa' AND publicar_web IS TRUE", [busquedaId]);
        b = rows[0];
        if (!b) return error(400, M.busq);
      }

      previos.push(ahora); intentos.set(ip, previos);
      if (intentos.size > 5000) for (const [k, v] of intentos) if (!v.some((t) => ahora - t < VENTANA)) intentos.delete(k);

      const hoy = hoyBA();
      const nota = `Postulación web (${hoy})${b ? ` a ${b.puesto}` : " · perfil general"}${mensaje ? `: ${mensaje}` : ""}`;

      // Candidato: mismo criterio que la Carga masiva (LinkedIn y después email), sin pisar datos existentes.
      const li = normLi(linkedin);
      const { rows: existentes } = await pool.query(
        `SELECT id, nombre, email, telefono, linkedin, notas FROM candidatos
          WHERE (linkedin IS NOT NULL AND linkedin <> '' AND lower(regexp_replace(regexp_replace(regexp_replace(linkedin, '^https?://(www\\.)?', '', 'i'), '[?#].*$', ''), '/+$', '')) = $1)
             OR (email IS NOT NULL AND lower(email) = $2)
          ORDER BY (lower(regexp_replace(regexp_replace(regexp_replace(coalesce(linkedin,''), '^https?://(www\\.)?', '', 'i'), '[?#].*$', ''), '/+$', '')) = $1) DESC
          LIMIT 1`, [li, email]);
      let cand = existentes[0], nuevo = false;
      if (cand) {
        await pool.query(
          `UPDATE candidatos SET email = coalesce(nullif(email, ''), $2), telefono = coalesce(nullif(telefono, ''), $3), linkedin = coalesce(nullif(linkedin, ''), $4),
             notas = CASE WHEN coalesce(notas, '') = '' THEN $5 ELSE notas || E'\\n' || $5 END, consentimiento_web = $6 WHERE id = $1`,
          [cand.id, email, telefono || null, linkedin, nota, hoy]);
      } else {
        nuevo = true;
        cand = { id: newId("c"), nombre };
        await pool.query(
          `INSERT INTO candidatos (id, nombre, linkedin, email, telefono, fuente, estado_relacion, creado, notas, tags, consentimiento_web)
           VALUES ($1,$2,$3,$4,$5,'Postulación','No contactado',$6,$7,'[]'::jsonb,$6)`,
          [cand.id, nombre, linkedin, email, telefono || null, hoy, nota]);
      }
      await historial(pool, "candidatos", cand.id, nuevo ? "crear" : "editar", nuevo ? { fuente: [null, "Postulación"] } : { notas: ["…", "postulación web"] });

      if (cv) {
        await pool.query("INSERT INTO archivos (id, usuario_id, coleccion, registro_id, nombre, tipo, tamano, datos) VALUES ($1,NULL,'candidatos',$2,$3,'application/pdf',$4,$5)",
          [newId("ar"), cand.id, cv.nombre, cv.buf.length, cv.buf]);
      }

      let sumado = false;
      if (b) {
        const { rows: ya } = await pool.query("SELECT id FROM postulaciones WHERE busqueda_id = $1 AND candidato_id = $2", [b.id, cand.id]);
        if (!ya.length) {
          const pid = newId("p");
          await pool.query(
            `INSERT INTO postulaciones (id, busqueda_id, candidato_id, etapa, fecha, notas, etapas) VALUES ($1,$2,$3,'Sourcing',$4,'Se postuló desde la web',$5)`,
            [pid, b.id, cand.id, hoy, JSON.stringify([{ etapa: "Sourcing", fecha: hoy, autor: "web" }])]);
          await historial(pool, "postulaciones", pid, "crear", { etapa: [null, "Sourcing"] });
          sumado = true;
        }
      }

      res.json({ ok: true });
      avisarPostulacion(pool, { b, nombre, email, linkedin, mensaje, nuevo, sumado, conCv: !!cv, candId: cand.id })
        .catch((e) => console.error("No se pudo avisar la postulación web:", e.message));
    } catch (e) { next(e); }
  });
}

async function historial(pool, coleccion, id, accion, cambios) {
  try {
    await pool.query("INSERT INTO historial (usuario_id, coleccion, registro_id, accion, cambios) VALUES ('web',$1,$2,$3,$4)",
      [coleccion, String(id), accion, JSON.stringify(cambios)]);
  } catch (e) { console.error("historial (web):", e.message); }
}

async function avisarPostulacion(pool, { b, nombre, email, linkedin, mensaje, nuevo, sumado, conCv, candId }) {
  const para = await destinatariosBusqueda(pool, b ? b.recruiter : null);
  const r = await enviarMail({
    para,
    asunto: b ? `Nueva postulación web: ${nombre} para ${b.puesto}` : `Nuevo perfil desde la web: ${nombre}`,
    html: plantilla({
      titulo: b ? `${nombre} se postuló a ${b.puesto}` : `${nombre} dejó su perfil en la web`,
      lineas: [
        `<b>${escHtml(nombre)}</b> · ${escHtml(email)} · <a href="${escHtml(linkedin)}">LinkedIn</a>${conCv ? " · con CV adjunto" : ""}`,
        b ? `${escHtml(b.cliente || "")} · ${sumado ? "Quedó en Sourcing en la búsqueda." : "Ya estaba en el pipeline de esta búsqueda."}` : "No eligió una búsqueda puntual.",
        nuevo ? "Es un candidato nuevo en la base (fuente: Postulación)." : "Ya estaba en la base: se completaron sus datos y se sumó la nota.",
        mensaje ? `Mensaje: “${escHtml(mensaje)}”` : "",
      ].filter(Boolean),
      boton: b ? "Ver la búsqueda" : "Ver candidatos",
      link: b ? `${APP_URL()}/#busqueda/${encodeURIComponent(b.id)}` : `${APP_URL()}/#candidatos`,
    }),
  });
  if (!r.ok) console.warn("Aviso de postulación web sin enviar:", r.motivo, candId);
}
