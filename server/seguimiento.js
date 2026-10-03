// Seguimiento de búsquedas: historial de etapas de cada postulación y link privado de solo lectura para el cliente.
import crypto from "node:crypto";

export const ETAPAS = ["Sourcing", "Contactado", "Entrevista LT", "Presentado", "Entrevista cliente", "Oferta", "Contratado", "Descartado"];
const FUNNEL = ETAPAS.slice(0, 7);
export const hoyBA = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

const SQL = `
ALTER TABLE postulaciones ADD COLUMN IF NOT EXISTS etapas jsonb DEFAULT '[]'::jsonb;
ALTER TABLE postulaciones ADD COLUMN IF NOT EXISTS motivo_detalle text;
CREATE TABLE IF NOT EXISTS links_cliente (
  token text PRIMARY KEY,
  busqueda_id text NOT NULL,
  activo boolean DEFAULT true,
  resumen text,
  proximos text,
  mostrar_candidatos boolean DEFAULT true,
  usuario_id text,
  creado timestamp DEFAULT now(),
  vistas integer DEFAULT 0,
  ultima_vista timestamp
);
CREATE INDEX IF NOT EXISTS links_cliente_busq_idx ON links_cliente (busqueda_id);`;

// Crea columnas/tablas nuevas y reconstruye el historial de etapas de postulaciones viejas desde la tabla historial.
// Se espera antes de abrir el puerto: el esquema ya incluye las columnas nuevas.
export async function migrarSeguimiento(pool) {
  await pool.query(SQL);
  const { rows: sinHist } = await pool.query("SELECT id, etapa, fecha::text AS fecha FROM postulaciones WHERE etapas IS NULL OR etapas = '[]'::jsonb");
  if (!sinHist.length) return;
  let cambios = [];
  try {
    ({ rows: cambios } = await pool.query("SELECT registro_id, fecha, usuario_id, cambios FROM historial WHERE coleccion = 'postulaciones' AND cambios ? 'etapa' ORDER BY fecha"));
  } catch { /* sin tabla historial todavía */ }
  const porId = {};
  for (const c of cambios) (porId[c.registro_id] ||= []).push(c);
  for (const p of sinHist) {
    const hs = porId[p.id] || [];
    const etapas = [];
    if (hs.length && hs[0].cambios.etapa[0]) etapas.push({ etapa: hs[0].cambios.etapa[0], fecha: null });
    for (const h of hs) etapas.push({ etapa: h.cambios.etapa[1], fecha: new Date(h.fecha).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }), autor: h.usuario_id || undefined });
    if (!etapas.length || etapas[etapas.length - 1].etapa !== p.etapa) etapas.push({ etapa: p.etapa, fecha: p.fecha || null });
    await pool.query("UPDATE postulaciones SET etapas = $1 WHERE id = $2", [JSON.stringify(etapas), p.id]);
  }
  console.log(`Historial de etapas reconstruido para ${sinHist.length} postulaciones.`);
}

// Lo llama la API genérica al crear o editar una postulación: el historial de etapas lo arma solo el servidor.
export function conEtapas(vals, antes, user) {
  delete vals.etapas;
  const nueva = vals.etapa || (!antes ? "Sourcing" : null);
  if (!nueva || (antes && antes.etapa === nueva)) return;
  const paso = { etapa: nueva, fecha: hoyBA(), autor: user?.id };
  if (nueva === "Descartado" && vals.motivo) paso.motivo = vals.motivo;
  vals.etapas = [...((antes && antes.etapas) || []), paso];
}

const alcance = (p) => {
  const idx = [...(p.etapas || []), { etapa: p.etapa }].map((x) => ETAPAS.indexOf(x.etapa)).filter((i) => i >= 0 && i < 7);
  return idx.length ? Math.max(...idx) : 0;
};
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fd = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+d} ${MES[+m - 1]} ${y}`; };
const dias = (a, b = hoyBA()) => (a ? Math.round((new Date(b) - new Date(a)) / 864e5) : null);
const linkOut = (l) => l && { token: l.token, activo: l.activo, resumen: l.resumen, proximos: l.proximos, mostrarCandidatos: l.mostrar_candidatos, creado: l.creado, vistas: l.vistas, ultimaVista: l.ultima_vista };

export function registerSeguimiento(app, { pool, auth }) {
  // ---------- administración del link (cualquier usuario con acceso a búsquedas) ----------
  app.get("/api/links/:bid", auth(), async (req, res, next) => {
    try {
      const { rows } = await pool.query("SELECT * FROM links_cliente WHERE busqueda_id = $1 AND activo ORDER BY creado DESC LIMIT 1", [req.params.bid]);
      res.json(linkOut(rows[0]) || null);
    } catch (e) { next(e); }
  });
  app.post("/api/links/:bid", auth(), async (req, res, next) => {
    try {
      const { rows: b } = await pool.query("SELECT id FROM busquedas WHERE id = $1", [req.params.bid]);
      if (!b.length) return res.status(404).json({ error: "No existe esa búsqueda." });
      const resumen = String(req.body?.resumen || ""), proximos = String(req.body?.proximos || ""), mostrar = req.body?.mostrarCandidatos !== false;
      const { rows } = await pool.query("SELECT token FROM links_cliente WHERE busqueda_id = $1 AND activo LIMIT 1", [req.params.bid]);
      let token = rows[0]?.token;
      if (token) await pool.query("UPDATE links_cliente SET resumen = $1, proximos = $2, mostrar_candidatos = $3 WHERE token = $4", [resumen, proximos, mostrar, token]);
      else {
        token = crypto.randomBytes(24).toString("base64url");
        await pool.query("INSERT INTO links_cliente (token, busqueda_id, resumen, proximos, mostrar_candidatos, usuario_id) VALUES ($1,$2,$3,$4,$5,$6)", [token, req.params.bid, resumen, proximos, mostrar, req.user.id]);
      }
      const { rows: out } = await pool.query("SELECT * FROM links_cliente WHERE token = $1", [token]);
      res.json(linkOut(out[0]));
    } catch (e) { next(e); }
  });
  app.delete("/api/links/:bid", auth(), async (req, res, next) => {
    try {
      await pool.query("UPDATE links_cliente SET activo = false WHERE busqueda_id = $1", [req.params.bid]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- página pública para el cliente (sin login, solo con el token) ----------
  app.get("/c/:token", async (req, res, next) => {
    try {
      res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
      const { rows: ls } = await pool.query("SELECT * FROM links_cliente WHERE token = $1 AND activo", [String(req.params.token)]);
      const l = ls[0];
      const { rows: bs } = l ? await pool.query("SELECT id, puesto, cliente, recruiter, estado, fecha_inicio::text AS fecha_inicio, fecha_cierre::text AS fecha_cierre FROM busquedas WHERE id = $1", [l.busqueda_id]) : { rows: [] };
      const b = bs[0];
      if (!l || !b) return res.status(404).send(pagina("Link no disponible", `<p class="muted">Este link ya no está activo. Pedile uno nuevo a tu contacto en Lemon Talent.</p>`));
      pool.query("UPDATE links_cliente SET vistas = vistas + 1, ultima_vista = now() WHERE token = $1", [l.token]).catch(() => {});
      const { rows: ps } = await pool.query(
        "SELECT p.etapa, p.etapas, c.nombre, c.rol_actual, c.empresa_actual FROM postulaciones p LEFT JOIN candidatos c ON c.id = p.candidato_id WHERE p.busqueda_id = $1", [b.id]);
      const abierta = b.estado === "Activa" || b.estado === "En pausa";
      const d = abierta ? dias(b.fecha_inicio) : (b.fecha_inicio && b.fecha_cierre ? dias(b.fecha_inicio, b.fecha_cierre) : null);
      const filas = FUNNEL.map((e, i) => ({ e, n: ps.filter((p) => alcance(p) >= i).length }));
      const max = Math.max(1, filas[0].n);
      const presentados = ps.filter((p) => alcance(p) >= 3).sort((a, b2) => alcance(b2) - alcance(a));
      const etapaCli = (p) => (p.etapa === "Descartado" ? "No continúa" : p.etapa);
      let h = `<p class="muted">${esc(b.cliente)} · Recruiter: ${esc(b.recruiter || "Lemon Talent")}</p>
      <div class="kpis"><div class="kpi"><span>Estado</span><b>${esc(b.estado)}</b></div><div class="kpi"><span>Inicio</span><b>${fd(b.fecha_inicio)}</b></div>
      <div class="kpi"><span>${abierta ? "Días en curso" : "Duración"}</span><b>${d ?? "—"}</b></div><div class="kpi"><span>Candidatos presentados</span><b>${presentados.length}</b></div></div>`;
      if (l.resumen) h += `<h2>Estado de la búsqueda</h2><p>${esc(l.resumen).replace(/\n/g, "<br>")}</p>`;
      if (ps.length) h += `<h2>Avance del proceso</h2>${filas.map((x) => `<div class="bar"><span>${x.e === "Sourcing" ? "Perfiles evaluados" : x.e}</span><div class="track"><i style="width:${Math.max(2, (x.n / max) * 100)}%"></i></div><b>${x.n}</b></div>`).join("")}
        <p class="muted small">Cantidad de candidatos que llegaron a cada etapa.</p>`;
      if (l.mostrar_candidatos && presentados.length) h += `<h2>Candidatos presentados</h2><table><thead><tr><th>Candidato</th><th>Rol y empresa actual</th><th>Etapa</th></tr></thead><tbody>${presentados.map((p) => `<tr><td><b>${esc(p.nombre || "")}</b></td><td>${esc([p.rol_actual, p.empresa_actual].filter(Boolean).join(" · ") || "—")}</td><td>${esc(etapaCli(p))}</td></tr>`).join("")}</tbody></table>`;
      if (l.proximos) h += `<h2>Próximos pasos</h2><p>${esc(l.proximos).replace(/\n/g, "<br>")}</p>`;
      res.send(pagina(b.puesto, h));
    } catch (e) { next(e); }
  });
}

function pagina(titulo, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titulo)} · Lemon Talent</title><style>
  *{box-sizing:border-box}body{font:15px/1.55 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1b201b;background:#F4F5F1;margin:0}
  main{max-width:820px;margin:0 auto;padding:28px 16px 40px}.card{background:#fff;border:1px solid #DDE1D8;border-radius:12px;padding:22px 22px 26px}
  .brand{font-weight:700;font-size:14px}.brand i{display:inline-block;width:11px;height:11px;background:#EAD64A;border-radius:2px;margin-right:7px}
  h1{font-size:24px;margin:10px 0 2px}h2{font-size:16px;margin:26px 0 10px;padding-bottom:5px;border-bottom:2px solid #EAD64A}
  .muted{color:#626B60}.small{font-size:12.5px}p{margin:6px 0}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.kpi{border:1px solid #DDE1D8;border-radius:9px;padding:10px 12px}.kpi span{font-size:12px;color:#626B60}.kpi b{display:block;font-size:19px}
  .bar{display:grid;grid-template-columns:150px minmax(0,1fr) 36px;gap:10px;align-items:center;font-size:14px;margin:6px 0}.bar b{text-align:right}
  .track{height:11px;background:#ECEEE8;border-radius:6px;position:relative;overflow:hidden}.track i{position:absolute;inset:0 auto 0 0;background:#EAD64A;border-radius:6px}
  table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #E6E9E2;vertical-align:top}th{font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:#626B60}
  .foot{margin-top:18px;font-size:12px;color:#626B60;text-align:center}
  @media (max-width:520px){.bar{grid-template-columns:110px minmax(0,1fr) 30px}.card{padding:18px 14px}}
  </style></head><body><main><div class="card"><div class="brand"><i></i>Lemon Talent</div><h1>${esc(titulo)}</h1>${body}</div>
  <div class="foot">Información actualizada al ${fd(hoyBA())}. Link privado: no lo compartas fuera de tu equipo.</div></main></body></html>`;
}
