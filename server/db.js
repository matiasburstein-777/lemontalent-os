import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../shared/schema.js";

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL. En Replit: abrí la pestaña Database y creá una base PostgreSQL.");
  process.exit(1);
}

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 10 });
export const db = drizzle(pool, { schema });

// Deja solo las columnas que existen en la tabla y convierte "" a null en campos no-texto.
export function clean(table, body) {
  const cols = getTableColumns(table);
  const out = {};
  for (const [k, col] of Object.entries(cols)) {
    if (!(k in body)) continue;
    let v = body[k];
    const isText = col.dataType === "string" && col.columnType !== "PgDateString";
    if (v === "" && !isText) v = null;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}
