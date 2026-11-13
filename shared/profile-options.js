export const AREAS = [
  "Comercial / Ventas", "Marketing / Growth", "Finanzas", "Operaciones / Supply Chain",
  "Compras", "Diseño / Creatividad", "Personas / RRHH", "Tecnología", "Producto",
  "Legal", "Administración", "Otra",
];
export const SENIORITIES = [
  "Trainee / Pasante", "Junior", "Semi Senior", "Senior", "Líder / Manager",
  "Head / Director", "C-Level",
];
export const FUENTES_CANDIDATO = [
  "LinkedIn – sourcing", "Postulación", "Referido", "Entrevista LT", "Pool Lemonx",
  "Histórico", "Búsqueda anterior",
];
export const ESTADOS_RELACION = ["No contactado", "Contactado", "Entrevistado LT"];

export const keyCatalogo = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const areaAliases = new Map([
  ["comercial", AREAS[0]], ["ventas", AREAS[0]], ["sales", AREAS[0]],
  ["marketing", AREAS[1]], ["growth", AREAS[1]],
  ["finanzas", AREAS[2]], ["finance", AREAS[2]],
  ["operaciones", AREAS[3]], ["supplychain", AREAS[3]], ["ingind", AREAS[3]],
  ["ingenieriaindustrial", AREAS[3]], ["industrialengineering", AREAS[3]],
  ["compras", AREAS[4]], ["procurement", AREAS[4]],
  ["diseno", AREAS[5]], ["creatividad", AREAS[5]], ["redactorcreativo", AREAS[5]],
  ["personas", AREAS[6]], ["rrhh", AREAS[6]], ["recursoshumanos", AREAS[6]], ["people", AREAS[6]],
  ["tecnologia", AREAS[7]], ["it", AREAS[7]], ["ia", AREAS[7]],
  ["producto", AREAS[8]], ["product", AREAS[8]],
  ["legal", AREAS[9]], ["administracion", AREAS[10]], ["otra", AREAS[11]],
]);
const seniorityAliases = new Map([
  ["trainee", SENIORITIES[0]], ["pasante", SENIORITIES[0]], ["intern", SENIORITIES[0]],
  ["junior", SENIORITIES[1]], ["jr", SENIORITIES[1]],
  ["semisenior", SENIORITIES[2]], ["ssr", SENIORITIES[2]], ["semi", SENIORITIES[2]],
  ["senior", SENIORITIES[3]], ["sr", SENIORITIES[3]],
  ["lider", SENIORITIES[4]], ["manager", SENIORITIES[4]],
  ["head", SENIORITIES[5]], ["director", SENIORITIES[5]],
  ["clevel", SENIORITIES[6]], ["ceo", SENIORITIES[6]], ["cfo", SENIORITIES[6]], ["cto", SENIORITIES[6]],
]);

export function mapArea(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (AREAS.includes(raw)) return raw;
  const k = keyCatalogo(raw);
  if (areaAliases.has(k)) return areaAliases.get(k);
  if (/operaciones.*finanzas|finanzas.*operaciones/.test(k)) return AREAS[3];
  if (/supplychain|ing(ind|enieriaindustrial)|operaciones/.test(k)) return AREAS[3];
  if (/marketing|growth/.test(k)) return AREAS[1];
  if (/redactorcreativo|creativ|diseno/.test(k)) return AREAS[5];
  return null;
}

export function mapSeniority(value) {
  const raw = String(value || "").trim();
  if (!raw) return { value: null, extra: "" };
  if (SENIORITIES.includes(raw)) return { value: raw, extra: "" };
  const first = raw.split(/[([]/, 1)[0].trim();
  const k = keyCatalogo(first);
  if (seniorityAliases.has(k)) return { value: seniorityAliases.get(k), extra: raw.slice(first.length).replace(/^[\s([]+|[\s)\]]+$/g, "").trim() };
  return { value: null, extra: raw };
}

export function mapSource(value) {
  const k = keyCatalogo(value);
  if (k === "linkedin" || k === "linkedinsourcing") return FUENTES_CANDIDATO[0];
  if (k === "referidouma" || k === "referido") return FUENTES_CANDIDATO[2];
  if (k === "pipelinelemonx" || k === "poollemonx") return FUENTES_CANDIDATO[4];
  if (k === "historico" || k === "busquedaanterior") return k === "historico" ? "Histórico" : "Búsqueda anterior";
  return null;
}
