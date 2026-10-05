// Renombrar clientes y recruiters en cascada (los vínculos hoy son por nombre).
const key = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function registerConsistencia(app, { pool, auth, HX }) {
  pool.query("ALTER TABLE facturas ADD COLUMN IF NOT EXISTS fecha_pago_comision date").catch((e) => console.error("No se pudo agregar fecha_pago_comision:", e.message));
  async function cascada(req, res, tablas) {
    const de = String(req.body?.de || "").trim(), a = String(req.body?.a || "").trim();
    if (!de || !a) return res.status(400).json({ error: "Faltan los nombres." });
    const client = await pool.connect(); const cambios = {};
    try {
      await client.query("BEGIN");
      for (const [tabla, col, pk = "id"] of tablas) {
        const { rows } = await client.query(`SELECT ${pk} AS id, ${col} AS v FROM ${tabla} WHERE ${col} IS NOT NULL`);
        const ids = rows.filter((r) => key(r.v) === key(de) && r.v !== a).map((r) => r.id);
        if (ids.length) await client.query(`UPDATE ${tabla} SET ${col} = $1 WHERE ${pk} = ANY($2)`, [a, ids]);
        cambios[tabla] = ids.length;
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); client.release(); throw e; }
    client.release();
    return { de, a, cambios };
  }
  app.post("/api/clientes/renombrar", auth("admin"), async (req, res, next) => {
    try {
      const r = await cascada(req, res, [["busquedas", "cliente"], ["facturas", "cliente"], ["leads", "empresa"], ["links_cliente", "cliente", "token"]]); if (!r) return;
      await HX.registrar(req.user, "clientes", r.a, "editar", { nombre: r.de }, { nombre: r.a });
      res.json({ ok: true, ...r });
    } catch (e) { next(e); }
  });
  app.post("/api/equipo/renombrar", auth("admin"), async (req, res, next) => {
    try {
      const r = await cascada(req, res, [["busquedas", "recruiter"], ["facturas", "recruiter"]]); if (!r) return;
      res.json({ ok: true, ...r });
    } catch (e) { next(e); }
  });
}
