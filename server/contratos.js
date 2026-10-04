// Propuesta comercial / contrato por cliente: etiqueta en archivos y resumen de qué clientes lo tienen.
export function registerContratos(app, { pool, auth }) {
  let listo = false;
  (async () => {
    for (let i = 0; i < 10 && !listo; i++) {
      try { await pool.query("ALTER TABLE archivos ADD COLUMN IF NOT EXISTS etiqueta text"); listo = true; }
      catch (e) { await new Promise((r) => setTimeout(r, 2000)); }
    }
    if (!listo) console.error("No se pudo agregar la etiqueta a archivos.");
  })();
  const RANKS = { recruiter: 1, admin: 3 };
  app.get("/api/archivos-resumen", auth(), async (req, res, next) => {
    try {
      const col = String(req.query.coleccion || "clientes");
      const { rows } = await pool.query(`SELECT id, registro_id, nombre, ${listo ? "etiqueta" : "NULL AS etiqueta"}, fecha::text AS fecha, usuario_id FROM archivos WHERE coleccion=$1 ORDER BY fecha DESC`, [col]);
      const full = (RANKS[req.user.rol] || 0) >= RANKS.admin;
      res.json(rows.map((r) => full ? { id: r.id, registroId: r.registro_id, nombre: r.nombre, etiqueta: r.etiqueta, fecha: r.fecha, usuarioId: r.usuario_id } : { registroId: r.registro_id, etiqueta: r.etiqueta }));
    } catch (e) { next(e); }
  });
  app.patch("/api/archivos/:id/etiqueta", auth("admin"), async (req, res, next) => {
    try {
      const et = String(req.body?.etiqueta || "").slice(0, 40) || null;
      await pool.query("UPDATE archivos SET etiqueta=$1 WHERE id=$2", [et, req.params.id]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}
