// Gastos del negocio: puntuales y recurrentes (se cargan solos cada mes con su monto, ajustable por mes).
// Socios y Administradora cargan y marcan pagos; los totales, el resultado y el margen solo los ve un socio (en el frontend).
// Solo se cargan gastos desde el primer mes que no viene de la planilla Economics (meses.historico).
import { hoyBA } from "./seguimiento.js";

const SQL = `
CREATE TABLE IF NOT EXISTS gastos (
  id text PRIMARY KEY,
  mes text NOT NULL,
  concepto text NOT NULL,
  categoria text,
  moneda text DEFAULT 'ARS',
  monto double precision,
  recurrente_id text,
  omitido boolean DEFAULT false,
  pagado boolean DEFAULT false,
  fecha_pago date,
  notas text,
  creado date
);
CREATE INDEX IF NOT EXISTS gastos_mes_idx ON gastos (mes);
CREATE TABLE IF NOT EXISTS gastos_recurrentes (
  id text PRIMARY KEY,
  concepto text NOT NULL,
  categoria text,
  moneda text DEFAULT 'ARS',
  monto double precision,
  desde text NOT NULL,
  hasta text,
  notas text,
  activo boolean DEFAULT true
);`;

const mesBA = () => hoyBA().slice(0, 7);
const sigMes = (k) => { const [y, m] = k.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
async function primerMesSistema(pool) {
  // El siguiente al último mes de la planilla que trae gastos (un mes de planilla sin gastos se carga acá)
  const { rows } = await pool.query("SELECT max(mes) AS m FROM meses WHERE historico AND jsonb_array_length(coalesce(gastos,'[]'::jsonb)) > 0");
  return rows[0]?.m ? sigMes(rows[0].m) : "2000-01";
}

// Crea la fila del mes para cada recurrente que corresponda, hasta el mes actual. Nunca pisa filas existentes.
export async function aplicarRecurrentes(pool) {
  const hasta = mesBA(), min = await primerMesSistema(pool);
  const { rows: recs } = await pool.query("SELECT * FROM gastos_recurrentes WHERE activo");
  for (const r of recs) {
    let m = r.desde > min ? r.desde : min;
    const fin = r.hasta && r.hasta < hasta ? r.hasta : hasta;
    for (let i = 0; m <= fin && i < 240; i++, m = sigMes(m)) {
      await pool.query(
        `INSERT INTO gastos (id, mes, concepto, categoria, moneda, monto, recurrente_id, creado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [`gr-${r.id}-${m}`, m, r.concepto, r.categoria, r.moneda, r.monto, r.id, hoyBA()]);
    }
  }
}

// Una sola vez: los gastos que se cargaban como líneas dentro de cada mes (meses.gastos) pasan a la tabla nueva.
async function migrarGastosDeMeses(pool) {
  const { rows } = await pool.query("SELECT mes, gastos FROM meses WHERE NOT coalesce(historico,false) AND jsonb_array_length(coalesce(gastos,'[]'::jsonb)) > 0");
  const actual = mesBA();
  for (const m of rows) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      for (const [i, g] of (m.gastos || []).entries()) {
        if (!g || !g.concepto || !g.monto) continue;
        await c.query(`INSERT INTO gastos (id, mes, concepto, categoria, moneda, monto, pagado, notas, creado) VALUES ($1,$2,$3,'Otros',$4,$5,$6,'Migrado de la carga mensual anterior',$7) ON CONFLICT (id) DO NOTHING`,
          [`gm-${m.mes}-${i}`, m.mes, g.concepto, g.moneda || "ARS", Number(g.monto) || 0, m.mes < actual, hoyBA()]);
      }
      await c.query("UPDATE meses SET gastos = '[]'::jsonb WHERE mes = $1", [m.mes]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  if (rows.length) console.log(`Gastos migrados de ${rows.length} meses a la tabla de gastos.`);
}

export async function migrarGastos(pool) {
  await pool.query(SQL);
  await migrarGastosDeMeses(pool);
  await aplicarRecurrentes(pool);
}

export function registerGastos(app, { pool, auth }) {
  // Carga los recurrentes del mes (si cambió el mes desde la última vez). Lo llama el frontend al abrir Gastos.
  app.post("/api/gastos-recurrentes/aplicar", auth("admin"), async (req, res, next) => {
    try { await aplicarRecurrentes(pool); res.json({ ok: true, primerMes: await primerMesSistema(pool) }); } catch (e) { next(e); }
  });
  // Después de editar un recurrente: actualiza los meses desde `desde` que todavía no se pagaron y quita los que quedan después de `hasta`.
  app.post("/api/gastos-recurrentes/:id/propagar", auth("admin"), async (req, res, next) => {
    try {
      const { rows } = await pool.query("SELECT * FROM gastos_recurrentes WHERE id = $1", [req.params.id]);
      const r = rows[0]; if (!r) return res.status(404).json({ error: "No existe ese gasto recurrente." });
      const desde = /^\d{4}-\d{2}$/.test(req.body?.desde || "") ? req.body.desde : mesBA();
      await pool.query("UPDATE gastos SET concepto=$2, categoria=$3, moneda=$4, monto=$5 WHERE recurrente_id=$1 AND mes >= $6 AND NOT coalesce(pagado,false)",
        [r.id, r.concepto, r.categoria, r.moneda, r.monto, desde]);
      if (r.hasta) await pool.query("DELETE FROM gastos WHERE recurrente_id=$1 AND mes > $2 AND NOT coalesce(pagado,false)", [r.id, r.hasta]);
      if (!r.activo) await pool.query("DELETE FROM gastos WHERE recurrente_id=$1 AND mes >= $2 AND NOT coalesce(pagado,false)", [r.id, desde]);
      await aplicarRecurrentes(pool);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}
