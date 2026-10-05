// Tests de la API contra una base de prueba: permisos por rol, link del cliente, login y vínculos.
// Uso: TEST_DATABASE_URL=postgres://... npm test   (la base se vacía; nunca apuntar a producción)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import bcrypt from "bcryptjs";

const URL_DB = process.env.TEST_DATABASE_URL;
if (!URL_DB) { console.error("Definí TEST_DATABASE_URL (una base de prueba, se vacía)."); process.exit(1); }
if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(URL_DB) && !process.env.CI) { console.error("TEST_DATABASE_URL no parece local: no se corre para no tocar datos reales."); process.exit(1); }

const PORT = 5600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const PASS = "clave-de-prueba";
let srv, pool;

async function login(email, password = PASS) {
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  return { status: r.status, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
const get = (cookie, path) => fetch(BASE + path, { headers: { cookie } });
const send = (cookie, method, path, body) => fetch(BASE + path, { method, headers: { cookie, "content-type": "application/json" }, body: body && JSON.stringify(body) });

before(async () => {
  pool = new pg.Pool({ connectionString: URL_DB });
  // Primero arranca el servidor una vez para que cree sus tablas propias, después se cargan los datos de prueba.
  srv = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, DATABASE_URL: URL_DB, PORT: String(PORT), SESSION_SECRET: "test" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100 && !log.includes("Lemon Talent OS en puerto"); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes("Lemon Talent OS en puerto"), "El servidor no arrancó:\n" + log);

  const h = await bcrypt.hash(PASS, 4);
  await pool.query(`TRUNCATE users, busquedas, busquedas_fin, candidatos, postulaciones, facturas, clientes, leads, propuestas, links_cliente, accesos, gastos`);
  await pool.query(`INSERT INTO users (id, email, nombre, rol, password_hash, activo) VALUES
    ('uA','admin@test.com','Admin Test','admin',$1,true), ('uR','rec@test.com','Maga','recruiter',$1,true), ('uB','bloq@test.com','Bloq','recruiter',$1,true)`, [h]);
  await pool.query(`INSERT INTO config (key, value) VALUES ('equipo', '{"recruiters":[{"nombre":"Maga","activa":true,"capacidad":5,"comisionPct":25,"usuarioId":"uR"}]}'::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await pool.query(`INSERT INTO clientes (id, nombre) VALUES ('cl1','Andes Foods')`);
  await pool.query(`INSERT INTO busquedas (id, puesto, cliente, recruiter, estado, fecha_inicio) VALUES ('b1','Head of Sales','Andes Foods','Maga','Activa','2026-09-01')`);
  await pool.query(`INSERT INTO busquedas_fin (id, sueldo_bruto_ars, fee_estimado_ars) VALUES ('b1', 4321987, 6482980)`);
  await pool.query(`INSERT INTO candidatos (id, nombre) VALUES ('c1','Ana Prueba')`);
  await pool.query(`INSERT INTO postulaciones (id, busqueda_id, candidato_id, etapa, fecha) VALUES ('p1','b1','c1','Presentado','2026-09-20')`);
  await pool.query(`INSERT INTO facturas (id, cliente, recruiter, monto, moneda, comision) VALUES ('f1','Andes Foods','Maga', 6482980, 'ARS', 1620745)`);
  await pool.query(`INSERT INTO links_cliente (token, cliente, activo, mostrar_candidatos, ocultar_descartados) VALUES ('tok-test-123','Andes Foods',true,true,true)`);
});

after(async () => { srv?.kill(); await pool?.end(); });

test("sin sesión, la API pide login", async () => {
  assert.equal((await get("", "/api/busquedas")).status, 401);
});

test("headers de seguridad presentes", async () => {
  const r = await get("", "/");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "same-origin");
});

test("un recruiter nunca recibe datos de plata ni de administración", async () => {
  const { cookie } = await login("rec@test.com");
  for (const p of ["/api/facturas", "/api/busquedasFin", "/api/meses", "/api/gastos", "/api/gastosRecurrentes", "/api/clientes", "/api/leads",
    "/api/users", "/api/papelera", "/api/backup", "/api/accesos", "/api/config/objetivos", "/api/unit-costs", "/api/propuestas"]) {
    assert.equal((await get(cookie, p)).status, 403, `${p} debería dar 403 a un recruiter`);
  }
});

test("un recruiter ve búsquedas y candidatos, pero no puede borrar ni cambiar roles", async () => {
  const { cookie } = await login("rec@test.com");
  assert.equal((await get(cookie, "/api/busquedas")).status, 200);
  assert.equal((await get(cookie, "/api/candidatos")).status, 200);
  assert.equal((await send(cookie, "DELETE", "/api/busquedas/b1")).status, 403);
  assert.equal((await send(cookie, "PATCH", "/api/users/uR", { rol: "admin" })).status, 403);
});

test("un recruiter solo ve sus comisiones, sin montos de facturas", async () => {
  const { cookie } = await login("rec@test.com");
  const j = await (await get(cookie, "/api/recruiter/comisiones")).json();
  assert.equal(j.recruiter, "Maga");
  assert.equal(j.comisiones.length, 1);
  assert.equal(j.comisiones[0].monto, undefined);
});

test("un admin accede a finanzas y usuarios", async () => {
  const { cookie } = await login("admin@test.com");
  for (const p of ["/api/facturas", "/api/busquedasFin", "/api/users", "/api/accesos", "/api/papelera"]) assert.equal((await get(cookie, p)).status, 200, p);
});

test("el rol socio ya no existe", async () => {
  const { cookie } = await login("admin@test.com");
  assert.equal((await send(cookie, "PATCH", "/api/users/uR", { rol: "socio" })).status, 400);
});

test("la página del cliente muestra candidatos y nunca montos", async () => {
  const html = await (await get("", "/c/tok-test-123")).text();
  assert.ok(html.includes("Ana Prueba"));
  for (const n of ["4321987", "4.321.987", "6482980", "6.482.980", "1620745"]) assert.ok(!html.includes(n), "La página del cliente muestra un monto: " + n);
});

test("la opinión del cliente entra a la Bandeja sin cambiar la etapa", async () => {
  const r = await fetch(BASE + "/c/tok-test-123/opinion", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "p=p1&decision=interesa&comentario=Nos+gusta" });
  assert.equal(r.status, 303);
  const { rows } = await pool.query("SELECT estado, datos FROM propuestas WHERE fuente = 'Cliente' AND registro_id = 'p1'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].estado, "Pendiente");
  assert.equal(rows[0].datos._decision, "interesa");
  const { rows: [p] } = await pool.query("SELECT etapa FROM postulaciones WHERE id = 'p1'");
  assert.equal(p.etapa, "Presentado");
});

test("un link desactivado no muestra nada", async () => {
  await pool.query("UPDATE links_cliente SET activo = false WHERE token = 'tok-test-123'");
  assert.equal((await get("", "/c/tok-test-123")).status, 404);
  await pool.query("UPDATE links_cliente SET activo = true WHERE token = 'tok-test-123'");
});

test("al guardar, recruiter y cliente toman el nombre exacto existente", async () => {
  const { cookie } = await login("admin@test.com");
  assert.equal((await send(cookie, "PUT", "/api/busquedas/b2", { puesto: "CFO", cliente: "andes  FOODS", recruiter: "maga", estado: "Activa" })).status, 200);
  const { rows: [b] } = await pool.query("SELECT cliente, recruiter FROM busquedas WHERE id = 'b2'");
  assert.equal(b.cliente, "Andes Foods");
  assert.equal(b.recruiter, "Maga");
});

test("después de 5 intentos fallidos el login se bloquea", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login("bloq@test.com", "mala")).status, 401);
  assert.equal((await login("bloq@test.com")).status, 429);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM accesos WHERE email = 'bloq@test.com' AND NOT ok");
  assert.ok(rows[0].n >= 6);
});

test("desactivar a un usuario lo saca de sus sesiones", async () => {
  const rec = await login("rec@test.com");
  assert.equal((await get(rec.cookie, "/api/busquedas")).status, 200);
  const adm = await login("admin@test.com");
  assert.equal((await send(adm.cookie, "PATCH", "/api/users/uR", { activo: false })).status, 200);
  assert.equal((await get(rec.cookie, "/api/busquedas")).status, 401);
  await send(adm.cookie, "PATCH", "/api/users/uR", { activo: true });
});
