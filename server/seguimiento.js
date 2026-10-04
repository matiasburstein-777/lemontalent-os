// Seguimiento de búsquedas: historial de etapas de cada postulación y link privado de solo lectura para el cliente.
import crypto from "node:crypto";
import express from "express";

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
CREATE INDEX IF NOT EXISTS links_cliente_busq_idx ON links_cliente (busqueda_id);
ALTER TABLE links_cliente ALTER COLUMN busqueda_id DROP NOT NULL;
ALTER TABLE links_cliente ADD COLUMN IF NOT EXISTS cliente text;
ALTER TABLE links_cliente ADD COLUMN IF NOT EXISTS ocultar_descartados boolean DEFAULT true;
ALTER TABLE postulaciones ADD COLUMN IF NOT EXISTS comentario_cliente text;`;

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
const keyN = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const linkOut = (l) => l && { token: l.token, activo: l.activo, resumen: l.resumen, proximos: l.proximos, mostrarCandidatos: l.mostrar_candidatos, ocultarDescartados: l.ocultar_descartados !== false, cliente: l.cliente, creado: l.creado, vistas: l.vistas, ultimaVista: l.ultima_vista };

// Link de una búsqueda (busqueda_id) o de un cliente con todas sus búsquedas abiertas (cliente, busqueda_id vacío)
async function linkActivo(pool, alcance, b) {
  const q = alcance === "cliente"
    ? ["SELECT * FROM links_cliente WHERE busqueda_id IS NULL AND cliente IS NOT NULL AND activo ORDER BY creado DESC", []]
    : ["SELECT * FROM links_cliente WHERE busqueda_id = $1 AND activo ORDER BY creado DESC LIMIT 1", [b.id]];
  const { rows } = await pool.query(q[0], q[1]);
  return alcance === "cliente" ? rows.find((l) => keyN(l.cliente) === keyN(b.cliente)) : rows[0];
}

export function registerSeguimiento(app, { pool, auth, newId }) {
  // ---------- administración del link (cualquier usuario con acceso a búsquedas) ----------
  const busq = async (id) => (await pool.query("SELECT id, cliente FROM busquedas WHERE id = $1", [id])).rows[0];
  app.get("/api/links/:bid", auth(), async (req, res, next) => {
    try {
      const b = await busq(req.params.bid); if (!b) return res.status(404).json({ error: "No existe esa búsqueda." });
      res.json({ busqueda: linkOut(await linkActivo(pool, "busqueda", b)) || null, cliente: linkOut(await linkActivo(pool, "cliente", b)) || null });
    } catch (e) { next(e); }
  });
  app.post("/api/links/:bid", auth(), async (req, res, next) => {
    try {
      const b = await busq(req.params.bid); if (!b) return res.status(404).json({ error: "No existe esa búsqueda." });
      const alcance = req.body?.alcance === "cliente" ? "cliente" : "busqueda";
      const resumen = String(req.body?.resumen || ""), proximos = String(req.body?.proximos || ""), mostrar = req.body?.mostrarCandidatos !== false, ocultar = req.body?.ocultarDescartados !== false;
      const l = await linkActivo(pool, alcance, b);
      let token = l?.token;
      if (token) await pool.query("UPDATE links_cliente SET resumen = $1, proximos = $2, mostrar_candidatos = $3, ocultar_descartados = $4 WHERE token = $5", [resumen, proximos, mostrar, ocultar, token]);
      else {
        token = crypto.randomBytes(24).toString("base64url");
        await pool.query("INSERT INTO links_cliente (token, busqueda_id, cliente, resumen, proximos, mostrar_candidatos, ocultar_descartados, usuario_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [token, alcance === "cliente" ? null : b.id, alcance === "cliente" ? b.cliente : null, resumen, proximos, mostrar, ocultar, req.user.id]);
      }
      const { rows: out } = await pool.query("SELECT * FROM links_cliente WHERE token = $1", [token]);
      res.json(linkOut(out[0]));
    } catch (e) { next(e); }
  });
  app.delete("/api/links/:bid", auth(), async (req, res, next) => {
    try {
      const b = await busq(req.params.bid); if (!b) return res.status(404).json({ error: "No existe esa búsqueda." });
      const l = await linkActivo(pool, req.query.alcance === "cliente" ? "cliente" : "busqueda", b);
      if (l) await pool.query("UPDATE links_cliente SET activo = false WHERE token = $1", [l.token]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- página pública para el cliente (sin login, solo con el token) ----------
  async function cargar(token) {
    const { rows: ls } = await pool.query("SELECT * FROM links_cliente WHERE token = $1 AND activo", [String(token)]);
    const l = ls[0]; if (!l) return null;
    const cols = "id, puesto, cliente, recruiter, estado, fecha_inicio::text AS fecha_inicio, fecha_cierre::text AS fecha_cierre, actualizado::text AS actualizado";
    let bs;
    if (l.busqueda_id) bs = (await pool.query(`SELECT ${cols} FROM busquedas WHERE id = $1`, [l.busqueda_id])).rows;
    else bs = (await pool.query(`SELECT ${cols} FROM busquedas WHERE estado IN ('Activa','En pausa') ORDER BY fecha_inicio DESC`)).rows.filter((b) => keyN(b.cliente) === keyN(l.cliente));
    const ids = bs.map((b) => b.id);
    const { rows: ps } = ids.length ? await pool.query(
      `SELECT p.id, p.busqueda_id, p.etapa, p.etapas, p.fecha::text AS fecha, p.comentario_cliente, c.nombre, c.rol_actual, c.empresa_actual
         FROM postulaciones p LEFT JOIN candidatos c ON c.id = p.candidato_id WHERE p.busqueda_id = ANY($1)`, [ids]) : { rows: [] };
    // Última opinión del cliente sobre cada candidato (queda en la Bandeja de propuestas)
    const { rows: fb } = ps.length ? await pool.query("SELECT registro_id, datos, estado, creado FROM propuestas WHERE fuente = 'Cliente' AND registro_id = ANY($1) ORDER BY creado", [ps.map((p) => p.id)]) : { rows: [] };
    const op = {}; fb.forEach((f) => { op[f.registro_id] = f; });
    return { l, bs, ps, op };
  }

  app.get("/c/:token", async (req, res, next) => {
    try {
      res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
      const d = await cargar(req.params.token);
      if (!d || (d.l.busqueda_id && !d.bs.length)) return res.status(404).send(pagina("Link no disponible", `<p class="muted">Este link ya no está activo. Pedile uno nuevo a tu contacto en Lemon Talent.</p>`));
      const { l, bs, ps, op } = d;
      pool.query("UPDATE links_cliente SET vistas = vistas + 1, ultima_vista = now() WHERE token = $1", [l.token]).catch(() => {});
      const ok = req.query.ok ? `<div class="aviso">¡Gracias! Le llegó tu opinión al equipo de Lemon Talent.</div>` : "";
      const seccion = (b, sola) => {
        const psb = ps.filter((p) => p.busqueda_id === b.id);
        const abierta = b.estado === "Activa" || b.estado === "En pausa";
        const dd = abierta ? dias(b.fecha_inicio) : (b.fecha_inicio && b.fecha_cierre ? dias(b.fecha_inicio, b.fecha_cierre) : null);
        const filas = FUNNEL.map((e, i) => ({ e, n: psb.filter((p) => alcance(p) >= i).length }));
        const max = Math.max(1, filas[0].n);
        let pres = psb.filter((p) => alcance(p) >= 3);
        if (l.ocultar_descartados !== false) pres = pres.filter((p) => p.etapa !== "Descartado");
        pres.sort((a, c) => alcance(c) - alcance(a));
        const ult = [b.fecha_inicio, b.actualizado, ...psb.flatMap((p) => [p.fecha, ...(p.etapas || []).map((x) => x.fecha)])].filter(Boolean).sort().pop();
        const tarjeta = (p) => {
          const f = op[p.id], dec = f && f.datos && f.datos._decision;
          const puede = abierta && !["Descartado", "Contratado"].includes(p.etapa);
          return `<div class="cand" id="c-${esc(p.id)}"><div class="cand-top"><div><b>${esc(p.nombre || "Candidato")}</b><div class="muted small">${esc([p.rol_actual, p.empresa_actual].filter(Boolean).join(" · ") || "")}</div></div><span class="pill ${p.etapa === "Descartado" ? "off" : p.etapa === "Contratado" ? "ok" : ""}">${esc(p.etapa === "Descartado" ? "No continúa" : p.etapa)}</span></div>
            ${p.comentario_cliente ? `<p class="coment">${esc(p.comentario_cliente).replace(/\n/g, "<br>")}</p>` : ""}
            ${dec ? `<div class="muted small">Tu opinión: <b>${dec === "interesa" ? "Me interesa" : "No avanzar"}</b>${f.estado === "Pendiente" ? " · el equipo la está viendo" : ""}</div>` : ""}
            ${puede ? `<details class="opinar"><summary>${dec ? "Cambiar mi opinión" : "Dar mi opinión"}</summary><form method="post" action="/c/${esc(l.token)}/opinion"><input type="hidden" name="p" value="${esc(p.id)}"><textarea name="comentario" maxlength="1000" placeholder="Comentario (opcional)"></textarea><div class="btns"><button name="decision" value="interesa" class="si">Me interesa</button><button name="decision" value="no" class="no">No avanzar</button></div></form></details>` : ""}</div>`;
        };
        return `<section class="${sola ? "" : "busq"}">${sola ? "" : `<h2 class="bt">${esc(b.puesto)}</h2>`}
          <div class="kpis"><div class="kpi"><span>Estado</span><b>${esc(b.estado)}</b></div><div class="kpi"><span>${abierta ? "Días en curso" : "Duración"}</span><b>${dd ?? "—"}</b></div><div class="kpi"><span>Presentados</span><b>${psb.filter((p) => alcance(p) >= 3).length}</b></div><div class="kpi"><span>Última novedad</span><b>${fd(ult)}</b></div></div>
          ${psb.length ? `<h3>Avance del proceso</h3>${filas.map((x) => `<div class="bar"><span>${x.e === "Sourcing" ? "Evaluados" : x.e}</span><div class="track"><i style="width:${Math.max(2, (x.n / max) * 100)}%"></i></div><b>${x.n}</b></div>`).join("")}` : ""}
          ${l.mostrar_candidatos && pres.length ? `<h3>Candidatos presentados</h3><div class="cands">${pres.map(tarjeta).join("")}</div>` : ""}</section>`;
      };
      let h = ok + `<p class="muted">${l.busqueda_id ? `${esc(bs[0].cliente)} · Recruiter: ${esc(bs[0].recruiter || "Lemon Talent")}` : `${bs.length} ${bs.length === 1 ? "búsqueda abierta" : "búsquedas abiertas"}`}</p>`;
      if (l.resumen) h += `<h2>Estado</h2><p>${esc(l.resumen).replace(/\n/g, "<br>")}</p>`;
      h += l.busqueda_id ? seccion(bs[0], true) : (bs.length ? bs.map((b) => seccion(b, false)).join("") : `<p class="muted">No hay búsquedas abiertas en este momento.</p>`);
      if (l.proximos) h += `<h2>Próximos pasos</h2><p>${esc(l.proximos).replace(/\n/g, "<br>")}</p>`;
      res.send(pagina(l.busqueda_id ? bs[0].puesto : `${l.cliente} · Búsquedas`, h));
    } catch (e) { next(e); }
  });

  // Opinión del cliente sobre un candidato: entra a la Bandeja de propuestas para que el equipo la apruebe
  app.post("/c/:token/opinion", express.urlencoded({ extended: false, limit: "10kb" }), async (req, res, next) => {
    try {
      const d = await cargar(req.params.token);
      if (!d) return res.status(404).send(pagina("Link no disponible", `<p class="muted">Este link ya no está activo.</p>`));
      const p = d.ps.find((x) => x.id === String(req.body?.p || ""));
      const decision = req.body?.decision === "interesa" ? "interesa" : req.body?.decision === "no" ? "no" : null;
      if (!p || !decision || alcance(p) < 3 || ["Descartado", "Contratado"].includes(p.etapa)) return res.redirect(303, `/c/${encodeURIComponent(d.l.token)}`);
      const b = d.bs.find((x) => x.id === p.busqueda_id) || {};
      const comentario = String(req.body?.comentario || "").trim().slice(0, 1000);
      const datos = decision === "no"
        ? { etapa: "Descartado", motivo: "Rechazado por el cliente", motivoDetalle: comentario, fecha: hoyBA(), _decision: "no" }
        : (alcance(p) < 4 ? { etapa: "Entrevista cliente", fecha: hoyBA(), _decision: "interesa" } : { _decision: "interesa" });
      await pool.query("DELETE FROM propuestas WHERE fuente = 'Cliente' AND registro_id = $1 AND estado = 'Pendiente'", [p.id]);
      await pool.query(`INSERT INTO propuestas (id, ref, fuente, cuenta, fecha, resumen, evidencia, link, coleccion, registro_id, op, datos, estado)
        VALUES ($1,$2,'Cliente',$3,$4,$5,$6,$7,'postulaciones',$8,'actualizar',$9,'Pendiente')`,
        [newId("pr"), `cli-${p.id}-${Date.now()}`, b.cliente || d.l.cliente || "", new Date().toISOString(),
          `${b.cliente || "El cliente"} ${decision === "interesa" ? "quiere avanzar con" : "no quiere avanzar con"} ${p.nombre || "el candidato"} (${b.puesto || "búsqueda"})`,
          comentario || null, `/c/${d.l.token}`, p.id, JSON.stringify(datos)]);
      res.redirect(303, `/c/${encodeURIComponent(d.l.token)}?ok=1#c-${encodeURIComponent(p.id)}`);
    } catch (e) { next(e); }
  });
}

function pagina(titulo, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titulo)} · Lemon Talent</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&display=swap"><style>
  *{box-sizing:border-box}body{font:15px/1.55 "DM Sans",-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;background:#F9F9F9;margin:0}
  main{max-width:820px;margin:0 auto;padding:28px 16px 40px}.card{background:#fff;border:1px solid #E3E3E3;border-radius:14px;padding:22px 22px 26px}
  .brand{font-weight:700;font-size:15px;display:flex;align-items:center;gap:9px}.brand img{width:32px;height:32px}
  h1{font-size:25px;margin:12px 0 2px;letter-spacing:-.02em}h2{font-size:17px;margin:26px 0 10px;padding-bottom:5px;border-bottom:2px solid #D9E151}h3{font-size:14px;margin:18px 0 8px;color:#5E5E5E;text-transform:uppercase;letter-spacing:.05em}
  h2.bt{border:0;background:#F2F5C8;padding:8px 12px;border-radius:10px}.busq{margin-top:22px}
  .muted{color:#5E5E5E}.small{font-size:13px}p{margin:6px 0}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}.kpi{border:1px solid #E3E3E3;border-radius:10px;padding:10px 12px}.kpi span{font-size:12px;color:#5E5E5E}.kpi b{display:block;font-size:18px;white-space:nowrap}
  .bar{display:grid;grid-template-columns:130px minmax(0,1fr) 30px;gap:10px;align-items:center;font-size:14px;margin:6px 0}.bar b{text-align:right}
  .track{height:10px;background:#F1F1F1;border-radius:6px;position:relative;overflow:hidden}.track i{position:absolute;inset:0 auto 0 0;background:#D9E151;border-radius:6px}
  .cands{display:flex;flex-direction:column;gap:10px}.cand{border:1px solid #E3E3E3;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
  .cand-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.pill{white-space:nowrap;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;background:#ECE4FD;color:#3D1A8A}.pill.ok{background:#DDEFE3;color:#2F7A4B}.pill.off{background:#F1F1F1;color:#5E5E5E}
  .coment{background:#F9F9F9;border-radius:8px;padding:8px 10px;font-size:14px}
  details.opinar summary{cursor:pointer;font-weight:600;font-size:14px;text-decoration:underline;text-decoration-color:#D9E151;text-decoration-thickness:2px;text-underline-offset:3px}
  details.opinar form{display:flex;flex-direction:column;gap:8px;margin-top:8px}textarea{font:inherit;font-size:16px;border:1px solid #E3E3E3;border-radius:10px;padding:8px 10px;min-height:70px;width:100%}
  .btns{display:flex;gap:8px;flex-wrap:wrap}.btns button{font:inherit;font-weight:600;border-radius:999px;padding:9px 16px;border:1px solid #E3E3E3;background:#fff;cursor:pointer}.btns .si{background:#D9E151;border-color:#D9E151}
  .aviso{background:#DDEFE3;color:#2F7A4B;border-radius:10px;padding:10px 12px;margin:12px 0;font-weight:600}
  .foot{margin-top:18px;font-size:12px;color:#5E5E5E;text-align:center}
  @media (max-width:520px){.bar{grid-template-columns:118px minmax(0,1fr) 26px;font-size:13.5px}.card{padding:18px 14px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style></head><body><main><div class="card"><div class="brand"><img src="/logo.svg" alt="">Lemon Talent</div><h1>${esc(titulo)}</h1>${body}</div>
  <div class="foot">Link privado de Lemon Talent: no lo compartas fuera de tu equipo.</div></main></body></html>`;
}
