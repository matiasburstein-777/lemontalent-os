// Tests del sitio público: búsquedas publicadas y postulación sin login.
// Uso: TEST_DATABASE_URL=postgres://... npm test   (la base se vacía; nunca apuntar a producción)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import pg from "pg";

const URL_DB = process.env.TEST_DATABASE_URL;
if (!URL_DB) { console.error("Definí TEST_DATABASE_URL (una base de prueba, se vacía)."); process.exit(1); }
if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(URL_DB) && !process.env.CI) { console.error("TEST_DATABASE_URL no parece local: no se corre para no tocar datos reales."); process.exit(1); }

const PORT = 5900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let srv, pool;

const postular = (body) => fetch(BASE + "/api/publico/postular", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const base = { nombre: "Lucía Web", email: "lucia@ejemplo.com", linkedin: "https://www.linkedin.com/in/lucia-web/", ubicacion: "CABA, Argentina", acepta: true };
const PDF = Buffer.from("%PDF-1.4\n%prueba\n").toString("base64");
const conHost = (host, path) => new Promise((ok, ko) => {
  http.get({ host: "127.0.0.1", port: PORT, path, headers: { host } }, (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => ok({ status: r.statusCode, body: b })); }).on("error", ko);
});

before(async () => {
  pool = new pg.Pool({ connectionString: URL_DB });
  srv = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, DATABASE_URL: URL_DB, PORT: String(PORT), SESSION_SECRET: "test" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100 && !log.includes("Lemon Talent OS en puerto"); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes("Lemon Talent OS en puerto"), "El servidor no arrancó:\n" + log);
  await pool.query("TRUNCATE busquedas, busquedas_fin, candidatos, postulaciones, archivos");
  await pool.query(`INSERT INTO busquedas (id, puesto, cliente, recruiter, estado, fecha_inicio, publicar_web, mostrar_cliente_web, rubro_web, ubicacion_web, descripcion_web, nota, job_description, area, link_empresa_web) VALUES
    ('w1','Head of Growth','Cliente Secreto','Maga','Activa','2026-11-01', true, false, 'Fintech en crecimiento', 'CABA · Híbrido', 'Liderar adquisición.', 'nota interna', 'JD interna', 'Marketing / Growth', 'https://secreto.com'),
    ('w2','SDR','Otro','Maga','Activa','2026-11-02', false, false, null, null, null, null, null, null, null),
    ('w3','CFO','Otro','Maga','Cancelada','2026-10-01', true, true, null, null, null, null, null, null, null),
    ('w4','Account Executive','Payana','Maga','Activa','2026-11-03', true, true, 'Fintech', 'Remoto', null, null, null, null, 'https://www.payana.la')`);
  await pool.query("INSERT INTO busquedas_fin (id, sueldo_bruto_ars) VALUES ('w1', 9999999)");
});

after(async () => { srv?.kill(); await pool?.end(); });

test("el listado público muestra solo búsquedas activas publicadas, sin datos internos", async () => {
  const r = await fetch(BASE + "/api/publico/busquedas");
  assert.equal(r.status, 200);
  const { busquedas } = await r.json();
  assert.deepEqual(busquedas.map((b) => b.id).sort(), ["w1", "w4"]);
  for (const b of busquedas) assert.deepEqual(Object.keys(b).sort(), ["area", "descripcion", "empresa", "id", "link", "puesto", "rubro", "seniority", "ubicacion"]);
  const w1 = busquedas.find((b) => b.id === "w1"), w4 = busquedas.find((b) => b.id === "w4");
  assert.equal(w1.empresa, "Fintech en crecimiento");
  assert.equal(w4.empresa, "Payana");
  assert.equal(w4.rubro, "Fintech");
  assert.equal(w4.link, "https://www.payana.la");
  assert.equal(w1.link, null, "con el cliente oculto no se publica el link");
  assert.equal(w1.rubro, null);
  const txt = JSON.stringify(busquedas);
  for (const prohibido of ["Cliente Secreto", "secreto.com", "Maga", "nota interna", "JD interna", "9999999"]) assert.ok(!txt.includes(prohibido), prohibido);
});

test("el honeypot responde ok sin guardar nada", async () => {
  const r = await postular({ ...base, busquedaId: "w1", web: "http://spam" });
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM candidatos")).rows[0].n, 0);
});

test("valida los datos, el CV y que la búsqueda esté publicada", async () => {
  assert.equal((await postular({ ...base, linkedin: "" })).status, 400);
  assert.equal((await postular({ ...base, ubicacion: "" })).status, 400, "ciudad y país es obligatorio");
  assert.equal((await postular({ ...base, linkedin: "https://twitter.com/x" })).status, 400);
  assert.equal((await postular({ ...base, acepta: false })).status, 400);
  assert.equal((await postular({ ...base, busquedaId: "w2" })).status, 400);
  assert.equal((await postular({ ...base, busquedaId: "w3" })).status, 400);
  const sinPdf = await postular({ ...base, busquedaId: "w1", cv: { nombre: "cv.pdf", base64: Buffer.from("hola").toString("base64") } });
  assert.equal(sinPdf.status, 400);
  const en = await (await postular({ ...base, email: "mal", idioma: "en" })).json();
  assert.match(en.error, /email/i);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM candidatos")).rows[0].n, 0);
});

test("una postulación crea el candidato, lo suma en Sourcing y guarda el CV", async () => {
  const r = await postular({ ...base, busquedaId: "w1", telefono: "+54 11 5555 5555", mensaje: "Me interesa mucho", cv: { nombre: "Lucia.pdf", base64: PDF } });
  assert.deepEqual(await r.json(), { ok: true });
  const { rows: cs } = await pool.query("SELECT id, fuente, estado_relacion, consentimiento_web, notas, ubicacion FROM candidatos");
  assert.equal(cs.length, 1);
  assert.equal(cs[0].fuente, "Postulación");
  assert.equal(cs[0].estado_relacion, "No contactado");
  assert.ok(cs[0].consentimiento_web);
  assert.match(cs[0].notas, /Me interesa mucho/);
  assert.equal(cs[0].ubicacion, "CABA, Argentina");
  const { rows: ps } = await pool.query("SELECT busqueda_id, etapa, etapas FROM postulaciones WHERE candidato_id = $1", [cs[0].id]);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].busqueda_id, "w1");
  assert.equal(ps[0].etapa, "Sourcing");
  assert.equal(ps[0].etapas[0].etapa, "Sourcing");
  const { rows: ar } = await pool.query("SELECT nombre, tipo FROM archivos WHERE coleccion = 'candidatos' AND registro_id = $1", [cs[0].id]);
  assert.deepEqual(ar, [{ nombre: "Lucia.pdf", tipo: "application/pdf" }]);
});

test("no duplica candidatos (mismo LinkedIn con otro formato) ni postulaciones", async () => {
  await postular({ ...base, email: "otro@ejemplo.com", linkedin: "linkedin.com/in/lucia-web?utm=x", busquedaId: "w4" });
  await postular({ ...base, busquedaId: "w1" });
  const { rows: cs } = await pool.query("SELECT id, email FROM candidatos");
  assert.equal(cs.length, 1);
  assert.equal(cs[0].email, "lucia@ejemplo.com"); // no pisa el email que ya tenía
  const { rows: ps } = await pool.query("SELECT busqueda_id FROM postulaciones ORDER BY busqueda_id");
  assert.deepEqual(ps.map((p) => p.busqueda_id), ["w1", "w4"]);
});

test("perfil general sin búsqueda y límite de postulaciones por IP", async () => {
  const r = await postular({ ...base, nombre: "Pedro", email: "pedro@ejemplo.com", linkedin: "https://linkedin.com/in/pedro" });
  assert.equal(r.status, 200);
  const { rows } = await pool.query("SELECT c.id FROM candidatos c LEFT JOIN postulaciones p ON p.candidato_id = c.id WHERE c.email = 'pedro@ejemplo.com' AND p.id IS NULL");
  assert.equal(rows.length, 1);
  assert.equal((await postular({ ...base, nombre: "Ana", email: "ana@ejemplo.com", linkedin: "https://linkedin.com/in/ana" })).status, 200);
  assert.equal((await postular({ ...base, nombre: "Eva", email: "eva@ejemplo.com", linkedin: "https://linkedin.com/in/eva" })).status, 429);
});

test("en el dominio del sitio, / muestra la web; en el del OS, sigue el OS", async () => {
  const sitio = await conHost("lemontalent.com", "/");
  assert.equal(sitio.status, 200);
  assert.ok(sitio.body.includes('id="busquedas"'));
  const asset = await conHost("www.lemontalent.com", "/assets/logo_violet.png");
  assert.equal(asset.status, 200);
  const os = await conHost("lemontalent-os.replit.app", "/");
  assert.ok(!os.body.includes('id="busquedas"'));
  const ruta = await fetch(BASE + "/sitio/");
  assert.equal(ruta.status, 200);
  assert.ok((await ruta.text()).includes('id="busquedas"'));
});
