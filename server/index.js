import express from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, getTableColumns } from "drizzle-orm";
import { db, pool, clean } from "./db.js";
import * as S from "../shared/schema.js";
import { registerDigest } from "./digest.js";
import { registerUnipile } from "./unipile.js";
import { registerExtras } from "./extras.js";
import { registerComercial } from "./comercial.js";
import { registerConsistencia } from "./consistencia.js";
import { registerContratos } from "./contratos.js";
import { registerSeguimiento, migrarSeguimiento, conEtapas } from "./seguimiento.js";
import { registerGastos, migrarGastos } from "./gastos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "12mb" }));

// ---------- sesión ----------
const PgStore = connectPg(session);
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "cambiar-este-secreto",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 1000 * 60 * 60 * 24 * 30 },
}));

const newId = (p) => p + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
const publicUser = (u) => u && ({ id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, activo: u.activo });

async function currentUser(req) {
  if (!req.session.userId) return null;
  const [u] = await db.select().from(S.users).where(eq(S.users.id, req.session.userId));
  return u && u.activo ? u : null;
}
// Jerarquía de roles: recruiter < admin (Administradora) < socio
const RANK = { recruiter: 0, admin: 1, socio: 2 };
const rank = (u) => RANK[u && u.rol] ?? 0;
const auth = (rol) => async (req, res, next) => {
  try {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: "Iniciá sesión para continuar." });
    if (rol && rank(u) < RANK[rol]) return res.status(403).json({ error: rol === "socio" ? "Solo socios pueden ver o cambiar esto." : "No tenés permiso para ver o cambiar esto." });
    req.user = u; next();
  } catch (e) { next(e); }
};

// ---------- login ----------
app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const [u] = await db.select().from(S.users).where(eq(S.users.email, email));
  if (!u || !u.activo || !(await bcrypt.compare(String(req.body.password || ""), u.passwordHash)))
    return res.status(401).json({ error: "Email o contraseña incorrectos." });
  req.session.userId = u.id;
  res.json(publicUser(u));
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", auth(), (req, res) => res.json(publicUser(req.user)));
app.post("/api/me/password", auth(), async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!nueva || String(nueva).length < 8) return res.status(400).json({ error: "La contraseña nueva necesita al menos 8 caracteres." });
  if (!(await bcrypt.compare(String(actual || ""), req.user.passwordHash))) return res.status(400).json({ error: "La contraseña actual no coincide." });
  await db.update(S.users).set({ passwordHash: await bcrypt.hash(String(nueva), 10) }).where(eq(S.users.id, req.user.id));
  res.json({ ok: true });
});

// ---------- usuarios ----------
app.get("/api/users/names", auth(), async (req, res) => {
  const rows = await db.select({ id: S.users.id, nombre: S.users.nombre }).from(S.users);
  res.json(Object.fromEntries(rows.map((r) => [r.id, r.nombre])));
});
app.get("/api/users", auth("admin"), async (req, res) => res.json((await db.select().from(S.users)).map(publicUser)));
app.post("/api/users", auth("admin"), async (req, res) => {
  const { email, nombre, rol, password } = req.body || {};
  if (!email || !nombre || !password || String(password).length < 8) return res.status(400).json({ error: "Completá nombre, email y una contraseña de al menos 8 caracteres." });
  // Una administradora solo crea recruiters; un socio elige cualquier rol.
  if (req.user.rol !== "socio" && rol != null && rol !== "recruiter")
    return res.status(403).json({ error: "Una administradora solo puede crear usuarios Recruiter." });
  if (req.user.rol === "socio" && rol != null && RANK[rol] === undefined)
    return res.status(400).json({ error: "Rol inválido." });
  const rolFinal = req.user.rol === "socio" ? (rol || "recruiter") : "recruiter";
  const u = { id: newId("u"), email: String(email).trim().toLowerCase(), nombre: String(nombre).trim(), rol: rolFinal, passwordHash: await bcrypt.hash(String(password), 10), activo: true };
  try { await db.insert(S.users).values(u); } catch { return res.status(400).json({ error: "Ya existe un usuario con ese email." }); }
  res.json(publicUser(u));
});
app.patch("/api/users/:id", auth("admin"), async (req, res) => {
  const [target] = await db.select().from(S.users).where(eq(S.users.id, req.params.id));
  if (!target) return res.status(404).json({ error: "No existe ese usuario." });
  if (req.user.rol !== "socio" && (target.rol !== "recruiter" || Object.hasOwn(req.body, "rol"))) return res.status(403).json({ error: "Solo un socio puede cambiar roles o editar socios y administradoras." });
  const set = {};
  if (req.body.rol) { if (RANK[req.body.rol] === undefined) return res.status(400).json({ error: "Rol inválido." }); set.rol = req.body.rol; }
  if (typeof req.body.activo === "boolean") set.activo = req.body.activo;
  if (req.body.nombre) set.nombre = String(req.body.nombre);
  if (req.body.email && req.user.rol === "socio") set.email = String(req.body.email).trim().toLowerCase();
  if (req.body.password) {
    if (String(req.body.password).length < 8) return res.status(400).json({ error: "La contraseña necesita al menos 8 caracteres." });
    set.passwordHash = await bcrypt.hash(String(req.body.password), 10);
  }
  if (req.params.id === req.user.id && (set.activo === false || (set.rol && set.rol !== "socio"))) return res.status(400).json({ error: "No podés quitarte el acceso de socio a vos mismo." });
  await db.update(S.users).set(set).where(eq(S.users.id, req.params.id));
  res.json({ ok: true });
});

// ---------- config (equipo visible para todos, objetivos solo socios) ----------
app.get("/api/config/:key", auth(), async (req, res) => {
  if (req.params.key !== "equipo" && rank(req.user) < RANK.admin) return res.status(403).json({ error: "No tenés permiso para ver esto." });
  const [row] = await db.select().from(S.config).where(eq(S.config.key, req.params.key));
  res.json(row ? row.value : null);
});
app.put("/api/config/:key", auth("admin"), async (req, res) => {
  await db.insert(S.config).values({ key: req.params.key, value: req.body }).onConflictDoUpdate({ target: S.config.key, set: { value: req.body } });
  res.json({ ok: true });
});

// ---------- recursos genéricos ----------
// min: rol mínimo para leer y escribir. write: rol mínimo para escribir (si es más alto). del: quién puede borrar.
const R = {
  busquedas: { t: S.busquedas, min: "recruiter", del: "socio" },
  candidatos: { t: S.candidatos, min: "recruiter", del: "socio" },
  postulaciones: { t: S.postulaciones, min: "recruiter", del: "todos" },
  feedback: { t: S.feedback, min: "recruiter", del: "socio" },
  busquedasFin: { t: S.busquedasFin, min: "admin" },
  facturas: { t: S.facturas, min: "admin" },
  clientes: { t: S.clientes, min: "admin" },
  leads: { t: S.leads, min: "admin" },
  // meses: la administradora ve ingresos y TC, nunca los gastos (se quitan en el GET). Solo socios escriben.
  meses: { t: S.meses, min: "admin", write: "socio", pk: "mes" },
  // gastos: la Administradora los carga y marca pagos; los totales y el resultado solo los muestra el frontend a socios.
  gastos: { t: S.gastos, min: "admin", del: "todos" },
  gastosRecurrentes: { t: S.gastosRecurrentes, min: "admin" },
};
function resource(req, res, escritura = false) {
  const r = R[req.params.res];
  if (!r) { res.status(404).json({ error: "Recurso desconocido." }); return null; }
  const need = escritura && r.write ? r.write : r.min;
  if (rank(req.user) < RANK[need]) { res.status(403).json({ error: need === "socio" ? "Solo socios pueden ver o cambiar esto." : "No tenés permiso para ver o cambiar esto." }); return null; }
  return { ...r, pk: r.pk || "id" };
}
const withId = (r, row) => (r.pk === "id" ? row : { ...row, id: row[r.pk] });

// Digest automático y Bandeja de propuestas (ver server/digest.js)
registerDigest(app, { db, pool, S, auth, rank, RANK, R, clean, newId, getTableColumns });
registerUnipile(app, { db, S, auth, rank, RANK });
const HX = registerExtras(app, { db, pool, S, auth, rank, RANK, R, newId });
registerComercial(app, { pool, auth, HX });
registerConsistencia(app, { pool, auth, HX });
registerContratos(app, { pool, auth });
registerSeguimiento(app, { pool, auth });
registerGastos(app, { pool, auth });

// Costos unitarios por año, solo ratios (nunca totales): para socios y administradoras.
app.get("/api/unit-costs", auth("admin"), async (req, res, next) => {
  try {
    const meses = await db.select().from(S.meses);
    const facts = await db.select().from(S.facturas);
    const busq = await db.select().from(S.busquedas);
    const tcDe = {}; let last = null;
    for (const m of [...meses].sort((a, b) => (a.mes < b.mes ? -1 : 1))) { if (m.tc) last = m.tc; tcDe[m.mes] = m.tc || last; }
    const tc = (k) => tcDe[k] || last || 1500;
    const costo = {};
    for (const m of meses) {
      const y = m.mes.slice(0, 4);
      let c = (m.gastos || []).reduce((s, g) => s + (g.moneda === "USD" ? Number(g.monto) || 0 : (Number(g.monto) || 0) / tc(m.mes)), 0);
      if (!m.historico) for (const f of facts) {
        if ((f.fechaEmision || "").slice(0, 7) === m.mes && f.comision)
          c += f.monedaComision === "USD" ? f.comision : f.comision / tc(m.mes);
      }
      costo[y] = (costo[y] || 0) + c;
    }
    const out = {};
    for (const y of Object.keys(costo)) {
      const cerradas = busq.filter((b) => b.estado === "Cerrada" && String(b.fechaCierre || "").startsWith(y)).length;
      const iniciadas = busq.filter((b) => String(b.fechaInicio || "").startsWith(y)).length;
      out[y] = {
        costoPorBusquedaCerradaUSD: cerradas ? costo[y] / cerradas : null,
        costoPorBusquedaIniciadaUSD: iniciadas ? costo[y] / iniciadas : null,
      };
    }
    res.json(out);
  } catch (e) { next(e); }
});

app.get("/api/:res", auth(), async (req, res, next) => {
  try {
    const r = resource(req, res); if (!r) return;
    let rows = (await db.select().from(r.t)).map((x) => withId(r, x));
    if (req.params.res === "meses" && req.user.rol !== "socio")
      rows = rows.map(({ mes, tc, ingresosARS, ingresosUSD, historico }) => ({ mes, tc, ingresosARS, ingresosUSD, historico }));
    res.json(rows);
  } catch (e) { next(e); }
});
app.put("/api/:res/:id", auth(), async (req, res, next) => {
  try {
    const r = resource(req, res, true); if (!r) return;
    const cols = getTableColumns(r.t);
    const vals = clean(r.t, req.body || {}); delete vals[r.pk];
    if (req.params.res === "feedback" && !vals.autorId) vals.autorId = req.user.id;
    const antes = await HX.leer(r, req.params.id);
    if (req.params.res === "postulaciones") conEtapas(vals, antes, req.user);
    const row = { ...vals, [r.pk]: req.params.id };
    const q = db.insert(r.t).values(row);
    await (Object.keys(vals).length ? q.onConflictDoUpdate({ target: cols[r.pk], set: vals }) : q.onConflictDoNothing());
    await HX.registrar(req.user, req.params.res, req.params.id, antes ? "editar" : "crear", antes, antes ? vals : {});
    res.json({ ok: true, id: req.params.id });
  } catch (e) { next(e); }
});
app.patch("/api/:res/:id", auth(), async (req, res, next) => {
  try {
    const r = resource(req, res, true); if (!r) return;
    const cols = getTableColumns(r.t);
    const vals = clean(r.t, req.body || {}); delete vals[r.pk];
    if (req.params.res === "postulaciones") delete vals.etapas;
    if (!Object.keys(vals).length) return res.json({ ok: true });
    const antes = await HX.leer(r, req.params.id);
    if (req.params.res === "postulaciones" && antes) conEtapas(vals, antes, req.user);
    const out = await db.update(r.t).set(vals).where(eq(cols[r.pk], req.params.id)).returning();
    if (out.length) await HX.registrar(req.user, req.params.res, req.params.id, "editar", antes, vals);
    if (!out.length) return res.status(404).json({ error: "No existe ese registro." });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.delete("/api/:res/:id", auth(), async (req, res, next) => {
  try {
    const r = resource(req, res, true); if (!r) return;
    if ((r.del || "socio") === "socio" && req.user.rol !== "socio") return res.status(403).json({ error: "Solo socios pueden eliminar." });
    const cols = getTableColumns(r.t);
    const antes = await HX.leer(r, req.params.id);
    await HX.aPapelera(req.user, req.params.res, req.params.id, antes);
    await db.delete(r.t).where(eq(cols[r.pk], req.params.id));
    if (antes) await HX.registrar(req.user, req.params.res, req.params.id, "borrar", antes, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- front ----------
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error del servidor. Probá de nuevo." });
});

// ---------- primer usuario ----------
async function bootstrapAdmin() {
  const any = await db.select({ id: S.users.id }).from(S.users).limit(1);
  if (any.length) return;
  const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD;
  if (!email || !pass) { console.warn("No hay usuarios. Definí ADMIN_EMAIL y ADMIN_PASSWORD en Secrets y reiniciá."); return; }
  await db.insert(S.users).values({ id: newId("u"), email: email.toLowerCase(), nombre: process.env.ADMIN_NOMBRE || "Socio", rol: "socio", passwordHash: await bcrypt.hash(pass, 10), activo: true });
  console.log("Usuario socio creado:", email);
}

const PORT = process.env.PORT || 5000;
migrarSeguimiento(pool).catch((e) => console.error("No se pudo preparar el seguimiento de etapas:", e.message))
  .then(() => migrarGastos(pool)).catch((e) => console.error("No se pudieron preparar los gastos:", e.message))
  .then(bootstrapAdmin).catch((e) => console.error("No se pudo crear el usuario inicial:", e.message))
  .finally(() => app.listen(PORT, "0.0.0.0", () => console.log(`Lemon Talent OS en puerto ${PORT}`)));
