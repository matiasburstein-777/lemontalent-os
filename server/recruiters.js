// Vista de recruiter: comisiones propias. Una recruiter solo recibe las suyas (sin montos de facturas);
// los admins pueden pedir las de cualquiera con ?recruiter=Nombre.
const keyN = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Nombre de recruiter (como figura en Equipo) que corresponde a un usuario: nombre igual, o mismo primer nombre si es único.
export async function recruiterDeUsuario(pool, user) {
  const { rows } = await pool.query("SELECT value FROM config WHERE key = 'equipo'");
  const recs = ((rows[0] && rows[0].value && rows[0].value.recruiters) || []).map((r) => r.nombre).filter(Boolean);
  const exacto = recs.find((n) => keyN(n) === keyN(user.nombre));
  if (exacto) return exacto;
  const primero = keyN(String(user.nombre || "").split(/\s+/)[0]);
  const mismos = recs.filter((n) => keyN(String(n).split(/\s+/)[0]) === primero);
  return mismos.length === 1 ? mismos[0] : user.nombre;
}

export function registerRecruiters(app, { pool, auth, rank, RANK }) {
  app.get("/api/recruiter/yo", auth(), async (req, res, next) => {
    try { res.json({ nombre: await recruiterDeUsuario(pool, req.user) }); } catch (e) { next(e); }
  });
  app.get("/api/recruiter/comisiones", auth(), async (req, res, next) => {
    try {
      const nombre = rank(req.user) >= RANK.admin && req.query.recruiter ? String(req.query.recruiter) : await recruiterDeUsuario(pool, req.user);
      const { rows } = await pool.query(
        `SELECT id, fecha_emision::text AS "fechaEmision", cliente, concepto, tipo, busqueda_id AS "busquedaId", comision, moneda_comision AS "monedaComision",
                coalesce(comision_pagada,false) AS "comisionPagada", fecha_pago_comision::text AS "fechaPagoComision", recruiter
           FROM facturas WHERE coalesce(comision,0) > 0 ORDER BY fecha_emision DESC NULLS LAST`);
      res.json({ recruiter: nombre, comisiones: rows.filter((r) => keyN(r.recruiter) === keyN(nombre)).map(({ recruiter, ...r }) => r) });
    } catch (e) { next(e); }
  });
}
