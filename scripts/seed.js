// Carga los datos migrados de las planillas (carpeta data/). Se puede correr más de una vez: no pisa lo existente.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool, clean } from "../server/db.js";
import * as S from "../shared/schema.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + ".json"), "utf8"));

async function insert(table, rows, label) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map((r) => clean(table, r));
    const res = await db.insert(table).values(chunk).onConflictDoNothing().returning();
    n += res.length;
  }
  console.log(`${label}: ${n} nuevos de ${rows.length}`);
}

const busq = load("busquedas").map((b) => ({
  ...b,
  actualizado: [...(b.bitacora || []).map((x) => x.fecha), b.fechaCierre || "", b.fechaInicio || ""].filter(Boolean).sort().pop() || null,
}));
await insert(S.busquedas, busq, "Búsquedas");
await insert(S.busquedasFin, load("busquedasFin").filter((f) => Object.keys(f).length > 1), "Finanzas por búsqueda");
await insert(S.candidatos, load("candidatos"), "Candidatos");
await insert(S.postulaciones, load("postulaciones"), "Postulaciones");
await insert(S.facturas, load("facturas"), "Facturas");
await insert(S.clientes, load("clientes"), "Clientes");
await insert(S.leads, load("leads"), "Leads");
const hist = load("historico");
await insert(S.meses, Object.entries(hist).map(([mes, v]) => ({ mes, tc: v.tc, ingresosARS: v.ingresosARS, ingresosUSD: v.ingresosUSD, gastos: v.gastos, historico: true })), "Meses (P&L histórico)");
const cfg = load("config");
for (const [key, value] of [["equipo", { recruiters: cfg.recruiters, icps: cfg.icps }], ["objetivos", cfg.objetivos]]) {
  await db.insert(S.config).values({ key, value }).onConflictDoNothing();
}
console.log("Config: equipo y objetivos listos");
await pool.end();
