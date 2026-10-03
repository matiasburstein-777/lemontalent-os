// WhatsApp y LinkedIn vía Unipile (solo lectura).
// Secrets: UNIPILE_DSN (ej. https://api8.unipile.com:13851) y UNIPILE_API_KEY.
// Cada persona conecta su cuenta desde la pantalla "Conexiones" (link de Unipile: QR de WhatsApp o login de LinkedIn).
// Filtro por cuenta: "base" = solo chats con contactos que están en el sistema; "todo" = todos los chats 1 a 1.
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

const dsn = () => String(process.env.UNIPILE_DSN || "").replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "https://");
const listo = () => !!(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY);
async function up(pathq, opts = {}) {
  const r = await fetch(dsn() + "/api/v1" + pathq, {
    ...opts, headers: { "X-API-KEY": process.env.UNIPILE_API_KEY, accept: "application/json", "content-type": "application/json", ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.title || j.detail || j.message || "Unipile HTTP " + r.status);
  return j;
}
const digits = (s) => String(s || "").replace(/\D/g, "");
const tail = (s) => digits(s).slice(-8);

export function registerUnipile(app, { db, S, auth, rank, RANK }) {
  const ingest = (req, res, next) => {
    const tok = process.env.INGEST_TOKEN || "";
    const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (tok.length < 20) return res.status(503).json({ error: "Falta configurar INGEST_TOKEN en Secrets." });
    const a = Buffer.from(tok), b = Buffer.from(got);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Token inválido." });
    next();
  };
  const firma = () => crypto.createHmac("sha256", process.env.INGEST_TOKEN || process.env.SESSION_SECRET || "lt").update("unipile").digest("hex").slice(0, 32);
  async function getCfg() {
    const [row] = await db.select().from(S.config).where(eq(S.config.key, "unipile"));
    return row?.value || { cuentas: {} };
  }
  async function setCfg(value) {
    await db.insert(S.config).values({ key: "unipile", value }).onConflictDoUpdate({ target: S.config.key, set: { value } });
  }
  const base = (req) => `${req.protocol}://${req.get("host")}`;

  // Link para conectar WhatsApp o LinkedIn (cada usuario conecta las suyas).
  app.post("/api/unipile/link", auth(), async (req, res, next) => {
    try {
      if (!listo()) return res.status(503).json({ error: "Falta configurar UNIPILE_DSN y UNIPILE_API_KEY en Secrets." });
      const prov = req.body?.proveedor === "LINKEDIN" ? "LINKEDIN" : "WHATSAPP";
      const j = await up("/hosted/accounts/link", {
        method: "POST",
        body: JSON.stringify({
          type: "create", providers: [prov], api_url: dsn(), name: req.user.id,
          expiresOn: new Date(Date.now() + 2 * 3600e3).toISOString(),
          notify_url: `${base(req)}/api/unipile/notify?k=${firma()}`,
          success_redirect_url: `${base(req)}/#conexiones`, failure_redirect_url: `${base(req)}/#conexiones`,
        }),
      });
      res.json({ url: j.url });
    } catch (e) { next(e); }
  });

  // Aviso de Unipile cuando una cuenta se conecta: guarda a quién pertenece.
  app.post("/api/unipile/notify", async (req, res, next) => {
    try {
      if (req.query.k !== firma()) return res.status(401).json({ error: "Firma inválida." });
      const { account_id, name, status } = req.body || {};
      if (account_id && name && /SUCCESS/i.test(String(status || ""))) {
        const cfg = await getCfg();
        cfg.cuentas[account_id] = { ...(cfg.cuentas[account_id] || {}), usuarioId: name, conectada: new Date().toISOString() };
        await setCfg(cfg);
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Cuentas conectadas: cada uno ve las suyas; socios y administradora ven todas.
  app.get("/api/unipile/cuentas", auth(), async (req, res, next) => {
    try {
      if (!listo()) return res.json({ configurado: false, cuentas: [] });
      const cfg = await getCfg();
      const j = await up("/accounts?limit=100");
      const users = Object.fromEntries((await db.select().from(S.users)).map((u) => [u.id, u.nombre]));
      let cuentas = (j.items || []).map((a) => {
        const c = cfg.cuentas[a.id] || {};
        return {
          id: a.id, tipo: a.type, nombre: a.name || a.connection_params?.im?.username || a.connection_params?.im?.phone_number || "",
          estado: (a.sources || []).map((s) => s.status).join(", ") || "OK",
          usuarioId: c.usuarioId || null, usuario: users[c.usuarioId] || null,
          filtro: c.filtro || (a.type === "WHATSAPP" ? "base" : "todo"),
        };
      });
      if (rank(req.user) < RANK.admin) cuentas = cuentas.filter((c) => c.usuarioId === req.user.id);
      res.json({ configurado: true, cuentas });
    } catch (e) { next(e); }
  });

  // Cambiar filtro (el dueño de la cuenta o un socio/administradora).
  app.patch("/api/unipile/cuentas/:id", auth(), async (req, res, next) => {
    try {
      const cfg = await getCfg(); const c = cfg.cuentas[req.params.id] || {};
      if (c.usuarioId !== req.user.id && rank(req.user) < RANK.admin) return res.status(403).json({ error: "Esta cuenta no es tuya." });
      if (req.body?.filtro) c.filtro = req.body.filtro === "todo" ? "todo" : "base";
      if (req.body?.usuarioId && rank(req.user) >= RANK.admin) c.usuarioId = String(req.body.usuarioId);
      cfg.cuentas[req.params.id] = c; await setCfg(cfg);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Desconectar (borra la cuenta en Unipile).
  app.delete("/api/unipile/cuentas/:id", auth(), async (req, res, next) => {
    try {
      const cfg = await getCfg(); const c = cfg.cuentas[req.params.id] || {};
      if (c.usuarioId !== req.user.id && rank(req.user) < RANK.socio) return res.status(403).json({ error: "Esta cuenta no es tuya." });
      await up("/accounts/" + encodeURIComponent(req.params.id), { method: "DELETE" });
      delete cfg.cuentas[req.params.id]; await setCfg(cfg);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Mensajes nuevos para el digest, agrupados por chat. Aplica el filtro de cada cuenta.
  app.get("/api/ingest/mensajes", ingest, async (req, res, next) => {
    try {
      if (!listo()) return res.status(503).json({ error: "Falta configurar UNIPILE_DSN y UNIPILE_API_KEY en Secrets." });
      const desde = new Date(req.query.desde || Date.now() - 2 * 3600e3);
      if (isNaN(desde)) return res.status(400).json({ error: "Parámetro desde inválido." });
      const cfg = await getCfg();
      const users = Object.fromEntries((await db.select().from(S.users)).map((u) => [u.id, u.nombre]));
      // Teléfonos conocidos (candidatos y contactos de clientes) para el filtro "base".
      const tels = new Set();
      for (const c of await db.select().from(S.candidatos)) if (tail(c.telefono).length === 8) tels.add(tail(c.telefono));
      for (const c of await db.select().from(S.clientes)) for (const m of String(c.contactos || "").match(/[\d\s()+-]{8,}/g) || []) if (tail(m).length === 8) tels.add(tail(m));
      const nombres = new Set((await db.select().from(S.candidatos)).map((c) => String(c.nombre || "").toLowerCase().trim()).filter((n) => n.length > 4));

      const accounts = (await up("/accounts?limit=100")).items || [];
      const out = [];
      for (const a of accounts) {
        const c = cfg.cuentas[a.id] || {};
        const filtro = c.filtro || (a.type === "WHATSAPP" ? "base" : "todo");
        const msgs = [];
        let cursor = null;
        for (let page = 0; page < 4; page++) {
          const q = new URLSearchParams({ account_id: a.id, after: desde.toISOString(), limit: "250" });
          if (cursor) q.set("cursor", cursor);
          const j = await up("/messages?" + q);
          msgs.push(...(j.items || []));
          cursor = j.cursor; if (!cursor) break;
        }
        const porChat = {};
        for (const m of msgs) (porChat[m.chat_id] ||= []).push(m);
        for (const [chatId, list] of Object.entries(porChat)) {
          let chat = {};
          try { chat = await up("/chats/" + encodeURIComponent(chatId)); } catch {}
          const grupo = Number(chat.type) === 1 || /@g\.us$/.test(String(chat.provider_id || ""));
          const ident = String(chat.attendee_provider_id || chat.provider_id || "");
          const nombre = chat.name || "";
          if (grupo) continue; // los grupos no se procesan
          if (filtro === "base") {
            const okTel = a.type === "WHATSAPP" && tels.has(tail(ident));
            const okNom = nombres.has(nombre.toLowerCase().trim());
            if (!okTel && !okNom) continue;
          }
          out.push({
            cuenta: users[c.usuarioId] || a.name || a.id, proveedor: a.type, chatId, contacto: nombre,
            telefono: a.type === "WHATSAPP" ? digits(ident.split("@")[0]) : null,
            perfil: a.type === "LINKEDIN" ? ident : null,
            mensajes: list.sort((x, y) => String(x.timestamp).localeCompare(String(y.timestamp))).map((m) => ({
              ref: "unipile:" + m.id, fecha: m.timestamp, deMi: !!Number(m.is_sender), texto: String(m.text || "").slice(0, 1500),
              adjuntos: (m.attachments || []).length || 0,
            })),
          });
        }
      }
      res.json({ desde: desde.toISOString(), hasta: new Date().toISOString(), chats: out });
    } catch (e) { next(e); }
  });
}
