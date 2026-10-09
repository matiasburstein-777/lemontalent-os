// Servidor MCP para usar Lemon Talent OS desde Claude (Desktop / claude.ai) como "conector personalizado".
// Cada usuario genera su token en Configuración › Conexiones y pega la URL /mcp/<token> en Claude.
// Las herramientas pasan por las mismas `ops` que la API: mismos permisos por rol, historial y vínculos.
// Protocolo: MCP "Streamable HTTP" sin estado (JSON-RPC por POST, respuesta JSON).
import crypto from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import { ETAPAS, hoyBA } from "./seguimiento.js";
import { keyN } from "./integridad.js";

const VERSIONES = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const PREFIJO = { busquedas: "b", candidatos: "c", postulaciones: "p", feedback: "fb", facturas: "f", clientes: "cl", leads: "l", gastos: "g", gastosRecurrentes: "r" };
const DESCRIPCION = {
  busquedas: "Procesos de búsqueda: puesto, cliente, recruiter, estado, fechas, bitácora y minutas.",
  candidatos: "Base de talento reutilizable.",
  postulaciones: "Candidato × búsqueda (pipeline). El historial de etapas lo arma el servidor.",
  feedback: "Pedidos de mejora del equipo.",
  busquedasFin: "Sueldo, fee y comisión de cada búsqueda (id = id de la búsqueda).",
  facturas: "Facturas: monto, moneda, emisor, tipo, cobrada y comisión.",
  clientes: "Clientes (CRM).",
  leads: "Leads comerciales (CRM).",
  meses: "P&L mensual: TC y gastos fijos (id = 'YYYY-MM').",
  gastos: "Gastos del negocio por mes.",
  gastosRecurrentes: "Gastos que se cargan solos cada mes.",
};
const VALORES = {
  "busquedas.estado": ["Activa", "En pausa", "Cerrada", "Cancelada"],
  "postulaciones.etapa": ETAPAS,
  "facturas.moneda": ["ARS", "USD"],
  "facturas.emisor": ["MATI", "PAU", "Invoice"],
  "facturas.tipo": ["Inicio y avance", "Cierre", "50% anticipo", "Cancelación"],
  "feedback.estado": ["Pendiente", "En curso", "Hecho", "Descartado"],
  "feedback.tipo": ["Error", "Mejora", "Idea"],
};

const INSTRUCCIONES = `Lemon Talent OS: sistema interno de Lemon Talent (consultora de recruiting en Argentina).
- Respondé en español rioplatense. Fechas en formato YYYY-MM-DD, hora de Buenos Aires.
- Empezá con "describir_datos" para ver qué colecciones y campos podés usar con tu rol.
- Los montos se guardan en su moneda original (ARS o USD); no conviertas sin decirlo.
- Para registrar avances de una búsqueda usá "sumar_a_bitacora" en vez de pisar la bitácora entera.
- Para cambiar la etapa de un candidato en una búsqueda, actualizá "etapa" en postulaciones (si es Descartado, cargá "motivo").
- Antes de crear o modificar datos, mostrale a la persona qué vas a guardar y pedile confirmación.
- No inventes ids: buscalos con "listar" o "ficha_busqueda".`;

export async function migrarMcp(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS tokens_mcp (
    id text PRIMARY KEY,
    usuario_id text NOT NULL,
    nombre text,
    hash text NOT NULL UNIQUE,
    creado timestamptz DEFAULT now(),
    ultimo_uso timestamptz,
    activo boolean NOT NULL DEFAULT true
  )`);
}

const hashDe = (tok) => crypto.createHash("sha256").update(tok).digest("hex");
const texto = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

// Filtro: { campo: valor } compara sin mayúsculas ni acentos; { campo: [a, b] } = cualquiera; { campo: { desde, hasta } } = rango.
function cumple(row, filtros) {
  for (const [k, f] of Object.entries(filtros || {})) {
    const v = row[k];
    if (f && typeof f === "object" && !Array.isArray(f)) {
      if (f.desde != null && !(v != null && String(v) >= String(f.desde))) return false;
      if (f.hasta != null && !(v != null && String(v) <= String(f.hasta))) return false;
    } else {
      const opciones = (Array.isArray(f) ? f : [f]).map((x) => (typeof x === "string" ? keyN(x) : x));
      const val = typeof v === "string" ? keyN(v) : v;
      if (!opciones.some((o) => o === val || (o === null && v == null))) return false;
    }
  }
  return true;
}
const contiene = (row, q) => { const k = keyN(q); return Object.values(row).some((v) => v != null && keyN(typeof v === "string" ? v : JSON.stringify(v)).includes(k)); };

export function registerMcp(app, { pool, R, RANK, rank, ops, ErrorApi, newId, publicUser, auth }) {
  const visibles = (user) => Object.keys(R).filter((k) => rank(user) >= RANK[R[k].min]);
  const escribibles = (user) => Object.keys(R).filter((k) => rank(user) >= RANK[R[k].write || R[k].min]);

  // ---------- herramientas ----------
  const HERRAMIENTAS = [
    {
      name: "describir_datos",
      description: "Lista las colecciones que podés ver y modificar con tu rol, sus campos y los valores válidos de estados y etapas. Usala primero.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async run(user) {
        const col = (k) => ({
          descripcion: DESCRIPCION[k],
          campos: Object.fromEntries(Object.entries(getTableColumns(R[k].t)).map(([n, c]) => [n, c.columnType === "PgDateString" ? "fecha YYYY-MM-DD" : c.dataType])),
          valores: Object.fromEntries(Object.entries(VALORES).filter(([n]) => n.startsWith(k + ".")).map(([n, v]) => [n.split(".")[1], v])),
          puedeEscribir: escribibles(user).includes(k),
        });
        return { usuario: publicUser(user), hoy: hoyBA(), colecciones: Object.fromEntries(visibles(user).map((k) => [k, col(k)])) };
      },
    },
    {
      name: "listar",
      description: "Consulta registros de una colección con filtros. filtros: {campo: valor} (sin importar mayúsculas/acentos), {campo: [v1, v2]} o {campo: {desde, hasta}} para fechas. texto: busca en todos los campos.",
      inputSchema: {
        type: "object",
        properties: {
          coleccion: { type: "string" },
          filtros: { type: "object", description: "Ej: {\"estado\": \"Activa\", \"recruiter\": \"Maga\", \"fechaInicio\": {\"desde\": \"2026-01-01\"}}" },
          texto: { type: "string", description: "Texto a buscar en cualquier campo" },
          campos: { type: "array", items: { type: "string" }, description: "Devolver solo estos campos (además de id)" },
          orden: { type: "string", description: "Campo por el que ordenar" },
          descendente: { type: "boolean" },
          limite: { type: "integer", description: "Máximo de filas (por defecto 50, tope 500)" },
        },
        required: ["coleccion"],
      },
      annotations: { readOnlyHint: true },
      async run(user, a) {
        let rows = (await ops.listar(user, a.coleccion)).filter((r) => cumple(r, a.filtros) && (!a.texto || contiene(r, a.texto)));
        if (a.orden) rows.sort((x, y) => (x[a.orden] ?? "") < (y[a.orden] ?? "") ? -1 : (x[a.orden] ?? "") > (y[a.orden] ?? "") ? 1 : 0);
        if (a.descendente) rows.reverse();
        const total = rows.length, lim = Math.min(Math.max(Number(a.limite) || 50, 1), 500);
        rows = rows.slice(0, lim);
        if (Array.isArray(a.campos) && a.campos.length) rows = rows.map((r) => Object.fromEntries(["id", ...a.campos].filter((k) => k in r).map((k) => [k, r[k]])));
        return { total, devueltas: rows.length, filas: rows };
      },
    },
    {
      name: "obtener",
      description: "Trae un registro completo por id.",
      inputSchema: { type: "object", properties: { coleccion: { type: "string" }, id: { type: "string" } }, required: ["coleccion", "id"] },
      annotations: { readOnlyHint: true },
      async run(user, a) {
        const row = await ops.leer(user, a.coleccion, a.id);
        if (!row) throw new ErrorApi(404, "No existe ese registro.");
        return row;
      },
    },
    {
      name: "ficha_busqueda",
      description: "Búsqueda completa con su pipeline (postulaciones con nombre del candidato) y, para admins, sus datos de dinero.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: true },
      async run(user, a) {
        const b = await ops.leer(user, "busquedas", a.id);
        if (!b) throw new ErrorApi(404, "No existe esa búsqueda.");
        const cand = Object.fromEntries((await ops.listar(user, "candidatos")).map((c) => [c.id, c]));
        const pipeline = (await ops.listar(user, "postulaciones")).filter((p) => p.busquedaId === a.id)
          .map((p) => ({ ...p, candidato: cand[p.candidatoId] ? { nombre: cand[p.candidatoId].nombre, rolActual: cand[p.candidatoId].rolActual, empresaActual: cand[p.candidatoId].empresaActual, linkedin: cand[p.candidatoId].linkedin } : null }));
        const fin = visibles(user).includes("busquedasFin") ? await ops.leer(user, "busquedasFin", a.id) : undefined;
        return { busqueda: b, pipeline, ...(fin !== undefined ? { finanzas: fin } : {}) };
      },
    },
    {
      name: "crear",
      description: "Crea un registro nuevo. Para busquedasFin el id es el de la búsqueda; para meses, 'YYYY-MM'. En el resto el id se genera solo. Confirmá con la persona antes de usarla.",
      inputSchema: {
        type: "object",
        properties: { coleccion: { type: "string" }, datos: { type: "object" }, id: { type: "string", description: "Solo para busquedasFin y meses" } },
        required: ["coleccion", "datos"],
      },
      async run(user, a) {
        const id = a.id || (PREFIJO[a.coleccion] ? newId(PREFIJO[a.coleccion]) : null);
        if (!id) throw new ErrorApi(400, "Para esta colección pasá el id.");
        if (await ops.leer(user, a.coleccion, id)) throw new ErrorApi(409, "Ya existe ese registro: usá 'actualizar'.");
        const datos = { ...(a.datos || {}) };
        if (a.coleccion === "busquedas") { datos.estado ??= "Activa"; datos.fechaInicio ??= hoyBA(); datos.actualizado ??= hoyBA(); }
        if (a.coleccion === "postulaciones") datos.fecha ??= hoyBA();
        if (a.coleccion === "candidatos") datos.creado ??= hoyBA();
        await ops.guardar(user, a.coleccion, id, datos);
        return { ok: true, id, registro: await ops.leer(user, a.coleccion, id) };
      },
    },
    {
      name: "actualizar",
      description: "Cambia solo los campos indicados de un registro existente. Confirmá con la persona antes de usarla.",
      inputSchema: {
        type: "object",
        properties: { coleccion: { type: "string" }, id: { type: "string" }, cambios: { type: "object" } },
        required: ["coleccion", "id", "cambios"],
      },
      async run(user, a) {
        const cambios = { ...(a.cambios || {}) };
        if (a.coleccion === "busquedas") cambios.actualizado ??= hoyBA();
        await ops.actualizar(user, a.coleccion, a.id, cambios);
        return { ok: true, registro: await ops.leer(user, a.coleccion, a.id) };
      },
    },
    {
      name: "sumar_a_bitacora",
      description: "Agrega una entrada a la bitácora semanal de una búsqueda (sin pisar las anteriores).",
      inputSchema: {
        type: "object",
        properties: { busquedaId: { type: "string" }, texto: { type: "string" }, fecha: { type: "string", description: "YYYY-MM-DD; por defecto hoy" } },
        required: ["busquedaId", "texto"],
      },
      async run(user, a) {
        const b = await ops.leer(user, "busquedas", a.busquedaId);
        if (!b) throw new ErrorApi(404, "No existe esa búsqueda.");
        const entrada = { fecha: a.fecha || hoyBA(), texto: String(a.texto).trim(), autor: user.id };
        await ops.actualizar(user, "busquedas", a.busquedaId, { bitacora: [...(b.bitacora || []), entrada], actualizado: hoyBA() });
        return { ok: true, entrada };
      },
    },
    {
      name: "ver_config",
      description: "Lee la configuración: 'equipo' (recruiters, capacidad, comisión) u 'objetivos' (solo admins).",
      inputSchema: { type: "object", properties: { clave: { type: "string", enum: ["equipo", "objetivos"] } }, required: ["clave"] },
      annotations: { readOnlyHint: true },
      async run(user, a) {
        if (!["equipo", "objetivos"].includes(a.clave)) throw new ErrorApi(400, "Clave inválida.");
        if (a.clave !== "equipo" && rank(user) < RANK.admin) throw new ErrorApi(403, "No tenés permiso para ver esto.");
        const { rows } = await pool.query("SELECT value FROM config WHERE key = $1", [a.clave]);
        return rows[0]?.value ?? {};
      },
    },
  ];
  const porNombre = Object.fromEntries(HERRAMIENTAS.map((h) => [h.name, h]));

  async function responder(user, msg) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Pedido inválido." } };
    const { id, method, params } = msg;
    if (id === undefined) return null; // notificación
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize":
        return ok({
          protocolVersion: VERSIONES.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONES[0],
          capabilities: { tools: {} },
          serverInfo: { name: "lemon-talent-os", title: "Lemon Talent OS", version: "1.0.0" },
          instructions: INSTRUCCIONES,
        });
      case "ping": return ok({});
      case "tools/list":
        return ok({ tools: HERRAMIENTAS.map(({ run, ...h }) => h) });
      case "tools/call": {
        const h = porNombre[params?.name];
        if (!h) return { jsonrpc: "2.0", id, error: { code: -32602, message: "Herramienta desconocida: " + params?.name } };
        try { return ok(texto(await h.run(user, params.arguments || {}))); }
        catch (e) {
          if (!(e instanceof ErrorApi)) console.error("mcp:", e);
          return ok({ ...texto(e instanceof ErrorApi ? e.message : "Error del servidor. Probá de nuevo."), isError: true });
        }
      }
      default: return { jsonrpc: "2.0", id, error: { code: -32601, message: "Método no soportado: " + method } };
    }
  }

  async function usuarioDelToken(tok) {
    if (!tok || tok.length < 20) return null;
    const { rows } = await pool.query(
      `SELECT u.*, t.id AS token_id FROM tokens_mcp t JOIN users u ON u.id = t.usuario_id WHERE t.hash = $1 AND t.activo AND u.activo`, [hashDe(tok)]);
    if (!rows[0]) return null;
    pool.query("UPDATE tokens_mcp SET ultimo_uso = now() WHERE id = $1", [rows[0].token_id]).catch(() => {});
    const { password_hash, token_id, ...u } = rows[0];
    return u;
  }

  const endpoint = async (req, res, next) => {
    try {
      const tok = req.params.token || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const user = await usuarioDelToken(tok);
      if (!user) return res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Token inválido o revocado. Generá uno nuevo en Configuración › Conexiones." } });
      const body = req.body;
      const salida = Array.isArray(body) ? (await Promise.all(body.map((m) => responder(user, m)))).filter(Boolean) : await responder(user, body);
      if (!salida || (Array.isArray(salida) && !salida.length)) return res.status(202).end();
      res.json(salida);
    } catch (e) { next(e); }
  };
  app.post("/mcp", endpoint);
  app.post("/mcp/:token", endpoint);
  // Sin stream de eventos del servidor ni sesiones: GET y DELETE no aplican.
  app.all(["/mcp", "/mcp/:token"], (req, res) => res.set("Allow", "POST").status(405).json({ error: "Usá POST." }));
  // Que Claude no busque OAuth (si no, recibe el index.html del front)
  app.get(/^\/\.well-known\/(oauth-|openid-)/, (req, res) => res.status(404).json({ error: "No hay OAuth: la URL ya trae el token." }));

  // ---------- tokens (Configuración › Conexiones) ----------
  app.get("/api/mcp/tokens", auth(), async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, nombre, to_char(creado AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') AS creado,
                to_char(ultimo_uso AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') AS "ultimoUso"
           FROM tokens_mcp WHERE usuario_id = $1 AND activo ORDER BY creado DESC`, [req.user.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });
  app.post("/api/mcp/tokens", auth(), async (req, res, next) => {
    try {
      const tok = "lt_" + crypto.randomBytes(32).toString("base64url");
      const id = newId("tk");
      const nombre = String(req.body?.nombre || "Claude").slice(0, 60);
      await pool.query("INSERT INTO tokens_mcp (id, usuario_id, nombre, hash) VALUES ($1,$2,$3,$4)", [id, req.user.id, nombre, hashDe(tok)]);
      res.json({ id, nombre, url: `${req.protocol}://${req.get("host")}/mcp/${tok}` });
    } catch (e) { next(e); }
  });
  app.delete("/api/mcp/tokens/:id", auth(), async (req, res, next) => {
    try {
      const { rowCount } = await pool.query("UPDATE tokens_mcp SET activo = false WHERE id = $1 AND usuario_id = $2", [req.params.id, req.user.id]);
      if (!rowCount) return res.status(404).json({ error: "No existe esa conexión." });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}
