// Seguridad del acceso: límite de intentos de login, registro de accesos, cierre de sesiones y headers.
const MAX_FALLOS = 5;              // intentos fallidos permitidos por email + IP
const VENTANA_MS = 15 * 60 * 1000; // en 15 minutos; después se bloquea 15 minutos
const fallos = new Map();          // `${ip}|${email}` -> { n, desde, hasta }

const ipDe = (req) => String(req.ip || req.headers["x-forwarded-for"] || "").split(",")[0].trim();

export async function migrarSeguridad(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS accesos (
    id bigserial PRIMARY KEY,
    fecha timestamptz DEFAULT now(),
    usuario_id text,
    email text,
    ok boolean NOT NULL,
    motivo text,
    ip text,
    agente text
  );
  CREATE INDEX IF NOT EXISTS accesos_fecha_idx ON accesos (fecha DESC);`);
  // Se guardan 180 días de accesos
  await pool.query("DELETE FROM accesos WHERE fecha < now() - interval '180 days'");
}

// Devuelve los minutos que faltan si ese email + IP está bloqueado; null si puede intentar.
export function bloqueado(req, email) {
  const k = ipDe(req) + "|" + email, f = fallos.get(k), ahora = Date.now();
  if (!f) return null;
  if (f.hasta && f.hasta > ahora) return Math.ceil((f.hasta - ahora) / 60000);
  if (f.hasta && f.hasta <= ahora) fallos.delete(k);
  return null;
}
export function anotarFallo(req, email) {
  const k = ipDe(req) + "|" + email, ahora = Date.now();
  const f = fallos.get(k);
  const n = f && ahora - f.desde < VENTANA_MS ? f.n + 1 : 1;
  fallos.set(k, { n, desde: n === 1 ? ahora : f.desde, hasta: n >= MAX_FALLOS ? ahora + VENTANA_MS : null });
  if (fallos.size > 5000) for (const [key, v] of fallos) if (!v.hasta && ahora - v.desde > VENTANA_MS) fallos.delete(key);
}
export const limpiarFallos = (req, email) => fallos.delete(ipDe(req) + "|" + email);

export async function registrarAcceso(pool, req, { usuarioId = null, email, ok, motivo = null }) {
  try {
    await pool.query("INSERT INTO accesos (usuario_id, email, ok, motivo, ip, agente) VALUES ($1,$2,$3,$4,$5,$6)",
      [usuarioId, email || null, ok, motivo, ipDe(req), String(req.headers["user-agent"] || "").slice(0, 200)]);
  } catch (e) { console.error("No se pudo registrar el acceso:", e.message); }
}

// Cierra todas las sesiones de un usuario (menos `salvoSid`, si se pasa).
export async function cerrarSesiones(pool, usuarioId, salvoSid = null) {
  try {
    const { rowCount } = await pool.query("DELETE FROM session WHERE sess->>'userId' = $1 AND ($2::text IS NULL OR sid <> $2)", [usuarioId, salvoSid]);
    return rowCount;
  } catch (e) { console.error("No se pudieron cerrar las sesiones:", e.message); return 0; }
}

// Headers básicos: sin sniffing de tipos, sin iframes de otros sitios y sin mandar la URL (con el token del cliente) a terceros.
export function headersSeguridad(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

export function registerSeguridad(app, { pool, auth }) {
  // Últimos accesos (exitosos y fallidos), para admins
  app.get("/api/accesos", auth("admin"), async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT a.id, to_char(a.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') AS fecha, a.email, a.ok, a.motivo, a.ip, a.agente, u.nombre
           FROM accesos a LEFT JOIN users u ON u.id = a.usuario_id ORDER BY a.fecha DESC LIMIT 100`);
      res.json(rows);
    } catch (e) { next(e); }
  });
  // Cerrar la sesión en todos los demás dispositivos
  app.post("/api/sesiones/cerrar-otras", auth(), async (req, res, next) => {
    try { res.json({ ok: true, cerradas: await cerrarSesiones(pool, req.user.id, req.sessionID) }); } catch (e) { next(e); }
  });
}
