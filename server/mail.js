// Envío de mails con la cuenta de servicio de Google Workspace (la misma del digest y el backup).
// Secretos: GOOGLE_SA_JSON y MAIL_REMITENTE (una casilla @lemontalent.com desde la que salen los avisos).
// En Google Admin, la delegación de dominio de la cuenta de servicio tiene que incluir el permiso
// https://www.googleapis.com/auth/gmail.send además de los de lectura.
import { googleToken } from "./digest.js";
import { keyN } from "./integridad.js";

const APP_URL = () => (process.env.APP_URL || "https://lemontalent-os.replit.app").replace(/\/$/, "");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const mailConfigurado = () => !!(process.env.GOOGLE_SA_JSON && process.env.MAIL_REMITENTE);

export async function enviarMail({ para, asunto, html }) {
  const destinos = [...new Set((Array.isArray(para) ? para : [para]).filter(Boolean))];
  if (!destinos.length) return { ok: false, motivo: "sin destinatarios" };
  if (!mailConfigurado()) return { ok: false, motivo: "falta GOOGLE_SA_JSON o MAIL_REMITENTE en Secrets" };
  const remitente = process.env.MAIL_REMITENTE;
  const sa = JSON.parse(process.env.GOOGLE_SA_JSON);
  const token = await googleToken(sa, remitente, "https://www.googleapis.com/auth/gmail.send");
  const mime = [
    `From: Lemon Talent OS <${remitente}>`,
    `To: ${destinos.join(", ")}`,
    `Subject: =?UTF-8?B?${b64(asunto)}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
  ].join("\r\n");
  const raw = Buffer.from(mime, "utf8").toString("base64url");
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(remitente)}/messages/send`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }),
  });
  if (!r.ok) return { ok: false, motivo: `Gmail respondió ${r.status}: ${(await r.text()).slice(0, 200)}` };
  return { ok: true };
}

// Plantilla simple con la marca: título, párrafos y un botón.
export function plantilla({ titulo, lineas = [], boton, link }) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <div style="border-top:4px solid #D9E151;padding:20px 0 4px"><b style="font-size:13px;color:#3D1A8A">LEMON TALENT OS</b></div>
  <h2 style="font-size:20px;margin:8px 0 12px">${esc(titulo)}</h2>
  ${lineas.map((l) => `<p style="font-size:15px;line-height:1.5;margin:0 0 10px">${l}</p>`).join("")}
  ${boton ? `<p style="margin:18px 0"><a href="${esc(link || APP_URL())}" style="background:#D9E151;color:#1a1a1a;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:bold;font-size:14px">${esc(boton)}</a></p>` : ""}
  <p style="font-size:12px;color:#777;margin-top:24px">Aviso automático de Lemon Talent OS.</p></div>`;
}

// Emails de los admins activos y del usuario ligado a la recruiter de una búsqueda.
export async function destinatariosBusqueda(pool, recruiter) {
  const { rows: users } = await pool.query("SELECT id, email, nombre, rol FROM users WHERE activo");
  const out = users.filter((u) => u.rol === "admin").map((u) => u.email);
  if (recruiter) {
    const { rows } = await pool.query("SELECT value FROM config WHERE key = 'equipo'");
    const rec = ((rows[0] && rows[0].value && rows[0].value.recruiters) || []).find((r) => keyN(r.nombre) === keyN(recruiter));
    const u = (rec && rec.usuarioId && users.find((x) => x.id === rec.usuarioId)) || users.find((x) => keyN(x.nombre) === keyN(recruiter));
    if (u) out.push(u.email);
  }
  return [...new Set(out)];
}

export { APP_URL, esc as escHtml };

export function registerMail(app, { auth }) {
  app.get("/api/mail/estado", auth("admin"), (req, res) => res.json({ configurado: mailConfigurado(), remitente: process.env.MAIL_REMITENTE || null }));
  // Manda un mail de prueba al admin que lo pide, para verificar la configuración
  app.post("/api/mail/prueba", auth("admin"), async (req, res) => {
    let r;
    try {
      r = await enviarMail({ para: req.user.email, asunto: "Prueba de avisos de Lemon Talent OS",
        html: plantilla({ titulo: "Los avisos por mail funcionan", lineas: ["Si te llegó este mail, el sistema ya puede avisarte cuando un cliente opina sobre un candidato."], boton: "Abrir Lemon Talent OS" }) });
    } catch (e) { r = { ok: false, motivo: e.message }; } // por ejemplo, falta el permiso gmail.send en Google Admin
    res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: "No se pudo enviar: " + r.motivo });
  });
}
