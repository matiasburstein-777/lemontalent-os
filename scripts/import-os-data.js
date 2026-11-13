import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@replit/object-storage";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../server/db.js";
import * as S from "../shared/schema.js";
import { buildImportPlan, formatImportAction, loadImportDataFromStorage } from "./os-import-core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_DIR = path.join(ROOT, "backups");
const INSERT_ORDER = ["busquedas", "candidatos", "postulaciones", "leads"];
const BATCH_SIZE = 100;

function idsFrom(rows, key = "id") {
  return [...new Set(rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => row[key])
    .filter((value) => value != null && String(value).trim() !== "")
    .map((value) => String(value).trim()))];
}

async function selectIds(queryable, table, ids, lockRows) {
  if (!ids.length) return [];
  let query = queryable.select().from(table).where(inArray(table.id, ids));
  if (lockRows) query = query.for("update");
  return query;
}

async function loadExisting(queryable, data, lockRows = false) {
  const incomingPosts = data.postulaciones_nuevas || [];
  const searchIds = [...new Set([
    ...idsFrom(data.busquedas_nuevas || []),
    ...idsFrom(incomingPosts, "busquedaId"),
  ])];
  const candidateIds = [...new Set([
    ...idsFrom(data.candidatos_nuevos || []),
    ...idsFrom(data.candidatos_actualizar || []),
    ...idsFrom(incomingPosts, "candidatoId"),
  ])];
  const postulationIds = idsFrom(incomingPosts);
  const clientIds = idsFrom(data.clientes_actualizar || []);
  const leadIds = idsFrom(data.leads_nuevos || []);
  return {
    busquedas: await selectIds(queryable, S.busquedas, searchIds, lockRows),
    candidatos: await selectIds(queryable, S.candidatos, candidateIds, lockRows),
    postulaciones: await selectIds(queryable, S.postulaciones, postulationIds, lockRows),
    clientes: await selectIds(queryable, S.clientes, clientIds, lockRows),
    leads: await selectIds(queryable, S.leads, leadIds, lockRows),
  };
}

async function savePreImportBackup(tx) {
  const tablas = {
    candidatos: await tx.select().from(S.candidatos),
    postulaciones: await tx.select().from(S.postulaciones),
    busquedas: await tx.select().from(S.busquedas),
    clientes: await tx.select().from(S.clientes),
  };
  await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(BACKUP_DIR, `os-import-pre-${stamp}.json`);
  const contents = JSON.stringify({ generado: new Date().toISOString(), tablas }, null, 2);
  await writeFile(file, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return path.relative(ROOT, file);
}

function copyCounts(counts) {
  return Object.fromEntries(Object.entries(counts).map(([table, value]) => [table, { ...value }]));
}

function recordLateSkip(counts, skips, table, id, reason) {
  counts[table].skipped++;
  skips.push({ table, id: id || "(sin id)", reason });
}

async function applyInsertions(tx, plan, counts, skips) {
  for (const tableName of INSERT_ORDER) {
    const table = S[tableName];
    const operations = plan.inserts[tableName];
    for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
      const batch = operations.slice(offset, offset + BATCH_SIZE);
      const inserted = await tx.insert(table)
        .values(batch.map((operation) => operation.values))
        .onConflictDoNothing()
        .returning({ id: table.id });
      const insertedIds = new Set(inserted.map((row) => String(row.id)));
      for (const operation of batch) {
        if (insertedIds.has(operation.id)) continue;
        counts[tableName].inserted--;
        recordLateSkip(counts, skips, tableName, operation.id, "el id ya existía al insertar");
      }
    }
  }
}

async function applyUpdates(tx, plan, counts, skips) {
  for (const tableName of ["candidatos", "clientes"]) {
    const table = S[tableName];
    for (const operation of plan.updates[tableName]) {
      const updated = await tx.update(table)
        .set(operation.patch)
        .where(eq(table.id, operation.id))
        .returning({ id: table.id });
      if (updated.length) continue;
      counts[tableName].updated--;
      recordLateSkip(counts, skips, tableName, operation.id, "el registro ya no existe al actualizar");
    }
  }
}

function printCounts(counts, mode) {
  console.log(`\n${mode}`);
  for (const [table, value] of Object.entries(counts)) {
    console.log(`${table}: insertados ${value.inserted}, actualizados ${value.updated}, omitidos ${value.skipped}`);
  }
}

function printSkipped(skips) {
  for (const item of skips) {
    console.log(`Omitir ${item.table}/${item.id}: ${item.reason}`);
  }
}

function parseMode(args) {
  const allowed = new Set(["--apply", "--dry-run"]);
  const unknown = args.filter((arg) => !allowed.has(arg));
  if (unknown.length) throw new Error(`Opción desconocida: ${unknown.join(", ")}. Usá --dry-run o --apply.`);
  if (args.includes("--apply") && args.includes("--dry-run")) {
    throw new Error("Elegí un solo modo: --dry-run o --apply.");
  }
  return args.includes("--apply") ? "apply" : "dry-run";
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const storage = new Client();
  const data = await loadImportDataFromStorage(storage);
  console.log("Fuente de datos: Object Storage (bucket predeterminado, Lemon-export).");
  if (data.ignoredFiles.length) {
    console.log(`Archivos ignorados: ${data.ignoredFiles.join(", ")}`);
  }

  if (mode === "dry-run") {
    const existing = await loadExisting(db, data);
    const plan = buildImportPlan(data, existing);
    console.log("Vista previa; no se escribirá en la base ni se generará un respaldo.");
    for (const action of plan.actions) console.log(formatImportAction(action));
    printCounts(plan.counts, "Totales previstos");
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(2026100501)`);
    const backupPath = await savePreImportBackup(tx);
    const existing = await loadExisting(tx, data, true);
    const plan = buildImportPlan(data, existing);
    const counts = copyCounts(plan.counts);
    const skips = [...plan.skipped];
    await applyInsertions(tx, plan, counts, skips);
    await applyUpdates(tx, plan, counts, skips);
    return { backupPath, counts, skips };
  });

  console.log(`Respaldo previo: ${result.backupPath}`);
  printSkipped(result.skips);
  printCounts(result.counts, "Importación aplicada");
}

try {
  await main();
} catch (error) {
  console.error(`Error en la importación: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
