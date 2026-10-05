// Integridad de los vínculos por nombre: recruiter (Equipo) y cliente (Clientes).
// Al guardar, el nombre se reemplaza por el nombre exacto ya existente, así "maga" o "Magalí" no parten las métricas.
// Cada recruiter del Equipo queda ligada a su usuario (usuarioId) para que "Mi panel" no dependa del nombre.
export const keyN = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const primer = (s) => keyN(String(s || "").trim().split(/\s+/)[0]);

async function equipo(pool) {
  const { rows } = await pool.query("SELECT value FROM config WHERE key = 'equipo'");
  return (rows[0] && rows[0].value && rows[0].value.recruiters) || [];
}

// Nombre exacto del Equipo que corresponde a `nombre` (igual normalizado, o mismo primer nombre si es único).
export function canonRecruiter(recs, nombre) {
  if (!nombre) return nombre;
  const k = keyN(nombre), nombres = recs.map((r) => r.nombre).filter(Boolean);
  const igual = nombres.find((n) => keyN(n) === k);
  if (igual) return igual;
  const mismos = nombres.filter((n) => primer(n) === primer(nombre) && (primer(nombre) === k || primer(n) === keyN(n)));
  return mismos.length === 1 ? mismos[0] : nombre;
}

async function canonCliente(pool, nombre) {
  if (!nombre) return nombre;
  const k = keyN(nombre);
  const { rows } = await pool.query("SELECT nombre FROM clientes UNION SELECT DISTINCT cliente FROM busquedas WHERE cliente IS NOT NULL");
  const exacto = rows.find((r) => r.nombre === nombre);
  if (exacto) return nombre;
  const igual = rows.find((r) => keyN(r.nombre) === k);
  return igual ? igual.nombre : String(nombre).trim();
}

// Se llama antes de escribir búsquedas y facturas.
export async function normalizarVinculos(pool, recurso, vals) {
  if (!["busquedas", "facturas"].includes(recurso)) return;
  if (typeof vals.recruiter === "string" && vals.recruiter.trim()) vals.recruiter = canonRecruiter(await equipo(pool), vals.recruiter.trim());
  if (typeof vals.cliente === "string" && vals.cliente.trim()) vals.cliente = await canonCliente(pool, vals.cliente);
}

// Una vez por arranque: liga cada recruiter del Equipo a su usuario si todavía no lo está y el nombre coincide sin dudas.
export async function migrarIntegridad(pool) {
  const { rows } = await pool.query("SELECT value FROM config WHERE key = 'equipo'");
  const val = rows[0] && rows[0].value;
  if (!val || !Array.isArray(val.recruiters)) return;
  const { rows: users } = await pool.query("SELECT id, nombre FROM users WHERE activo");
  let cambios = 0;
  const recs = val.recruiters.map((r) => {
    if (r.usuarioId || !r.nombre) return r;
    const exactos = users.filter((u) => keyN(u.nombre) === keyN(r.nombre));
    const porPrimer = users.filter((u) => primer(u.nombre) === primer(r.nombre));
    const u = exactos.length === 1 ? exactos[0] : porPrimer.length === 1 ? porPrimer[0] : null;
    if (!u) return r;
    cambios++;
    return { ...r, usuarioId: u.id };
  });
  if (cambios) {
    await pool.query("UPDATE config SET value = $1 WHERE key = 'equipo'", [JSON.stringify({ ...val, recruiters: recs })]);
    console.log(`${cambios} recruiters ligadas a su usuario.`);
  }
}
