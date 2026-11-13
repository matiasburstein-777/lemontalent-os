import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import * as S from "../shared/schema.js";
import { mapArea, mapSeniority, mapSource, FUENTES_CANDIDATO } from "../shared/profile-options.js";

export const IMPORT_FILE_NAMES = [
  "busquedas_nuevas.json",
  "candidatos_nuevos.json",
  "postulaciones_nuevas.json",
  "candidatos_actualizar.json",
  "clientes_actualizar.json",
  "leads_nuevos.json",
];

const IGNORED_OBJECT_NAMES = new Set(["Revision_import_Lemon_OS.xlsx"]);

const EMPTY_COUNTS = () => ({
  busquedas: { inserted: 0, updated: 0, skipped: 0 },
  candidatos: { inserted: 0, updated: 0, skipped: 0 },
  postulaciones: { inserted: 0, updated: 0, skipped: 0 },
  clientes: { inserted: 0, updated: 0, skipped: 0 },
  leads: { inserted: 0, updated: 0, skipped: 0 },
});

function empty(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function asId(value) {
  if (value == null) return "";
  return String(value).trim();
}

function assertArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} debe contener un array JSON.`);
}

function ignoredNames(names) {
  const expected = new Set(IMPORT_FILE_NAMES);
  return names
    .filter((name) => name.startsWith("_")
      || IGNORED_OBJECT_NAMES.has(name)
      || (name.endsWith(".json") && !expected.has(name)))
    .sort();
}

function parseImportText(name, text) {
  if (!text.trim() && name === "leads_nuevos.json") return [];
  if (!text.trim()) throw new Error(`${name} está vacío; usá [] si no hay filas.`);
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`${name} no contiene JSON válido.`); }
  assertArray(parsed, name);
  return parsed;
}

async function assembleImportData(files, ignoredFiles, readText, sourceDescription) {
  const expected = new Set(IMPORT_FILE_NAMES);
  const missing = IMPORT_FILE_NAMES.filter((name) => name !== "leads_nuevos.json" && !files.has(name));
  if (missing.length) {
    throw new Error(`Faltan archivos requeridos en ${sourceDescription}: ${missing.join(", ")}`);
  }

  const data = {};
  for (const name of IMPORT_FILE_NAMES) {
    data[name.replace(".json", "")] = files.has(name)
      ? parseImportText(name, await readText(name))
      : [];
  }
  data.ignoredFiles = ignoredFiles.filter((name) => !expected.has(name));
  return data;
}

export async function loadImportData(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`No existe la carpeta ${directory}. Subí os-import/ a la raíz del proyecto antes de importar.`);
    }
    throw error;
  }

  const fileEntries = entries.filter((entry) => entry.isFile());
  const files = new Set(fileEntries.map((entry) => entry.name));
  return assembleImportData(
    files,
    ignoredNames(fileEntries.map((entry) => entry.name)),
    (name) => readFile(path.join(directory, name), "utf8"),
    "os-import/",
  );
}

export async function loadImportDataFromStorage(client) {
  const listing = await client.list({ maxResults: 1000 });
  if (!listing.ok) {
    throw new Error(`No se pudo listar Object Storage: ${listing.error?.message || "error desconocido"}`);
  }

  const rootNames = listing.value
    .map((object) => object.name)
    .filter((name) => !name.includes("/"));
  const files = new Set(rootNames);
  return assembleImportData(
    files,
    ignoredNames(rootNames),
    async (name) => {
      const result = await client.downloadAsBytes(name);
      if (!result.ok) {
        throw new Error(`No se pudo descargar ${name} de Object Storage: ${result.error?.message || "error desconocido"}`);
      }
      const [contents] = result.value;
      return Buffer.from(contents).toString("utf8");
    },
    "el bucket de Object Storage",
  );
}

function cleanRow(table, row) {
  const columns = getTableColumns(table);
  const values = {};
  for (const [key, column] of Object.entries(columns)) {
    if (!Object.hasOwn(row, key)) continue;
    let value = row[key];
    const isText = column.dataType === "string" && column.columnType !== "PgDateString";
    if (value === "" && !isText) value = null;
    if (value !== undefined) values[key] = value;
  }
  if (table === S.candidatos) {
    const notes = String(values.notas || "");
    const add = (text) => { if (text && !notes.includes(text)) values.notas = [values.notas, text].filter(Boolean).join("\n"); };
    if (values.area) {
      const mapped = mapArea(values.area);
      if (!mapped) { add(`Área original: ${values.area}`); values.area = null; }
      else values.area = mapped;
    }
    if (values.seniority) {
      const original = values.seniority;
      const mapped = mapSeniority(original);
      values.seniority = mapped.value;
      if (mapped.extra) add(`Detalle de seniority: ${mapped.extra}`);
      if (!mapped.value) add(`Seniority original: ${original}`);
    }
    if (values.fuente) {
      const mapped = mapSource(values.fuente);
      if (mapped) values.fuente = mapped;
      else if (!FUENTES_CANDIDATO.includes(values.fuente)) { add(`Fuente original: ${values.fuente}`); values.fuente = null; }
    }
  }
  return values;
}

function requireObject(value, file, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file}, fila ${index + 1}: cada fila debe ser un objeto JSON.`);
  }
  return value;
}

function requireId(value, file, index) {
  const id = asId(value.id);
  if (!id) throw new Error(`${file}, fila ${index + 1}: falta el campo id.`);
  return id;
}

function actualizadoComoSeed(busqueda) {
  return [
    ...(busqueda.bitacora || []).map((entry) => entry?.fecha),
    busqueda.fechaCierre || "",
    busqueda.fechaInicio || "",
  ].filter(Boolean).sort().pop() || null;
}

function unique(values) {
  return [...new Set(values.map(asId).filter(Boolean))];
}

function mapById(rows) {
  return new Map(rows.map((row) => [asId(row.id), row]));
}

function appendUniqueTags(existingTags, additions, id) {
  if (!Array.isArray(existingTags)) {
    if (!empty(existingTags)) throw new Error(`El candidato ${id} tiene tags que no son una lista.`);
    existingTags = [];
  }
  if (!Array.isArray(additions)) throw new Error(`tagsAgregar del candidato ${id} debe ser una lista.`);
  const result = [...existingTags];
  const seen = new Set(result.map((tag) => String(tag).trim().toLocaleLowerCase("es")));
  let added = false;
  for (const value of additions) {
    if (typeof value !== "string") throw new Error(`Cada elemento de tagsAgregar del candidato ${id} debe ser texto.`);
    const tag = value.trim();
    const key = tag.toLocaleLowerCase("es");
    if (!tag || seen.has(key)) continue;
    result.push(tag);
    seen.add(key);
    added = true;
  }
  return { result, added };
}

export function buildImportPlan(data, existing) {
  for (const name of IMPORT_FILE_NAMES) assertArray(data[name.replace(".json", "")] || [], name);

  const counts = EMPTY_COUNTS();
  const actions = [];
  const skipped = [];
  const inserts = { busquedas: [], candidatos: [], postulaciones: [], leads: [] };
  const updates = { candidatos: [], clientes: [] };
  const skip = (table, id, reason) => {
    counts[table].skipped++;
    const item = { action: "skip", table, id: id || "(sin id)", reason };
    actions.push(item);
    skipped.push(item);
  };
  const addInsert = (table, id, values) => {
    inserts[table].push({ id, values });
    counts[table].inserted++;
    actions.push({ action: "insert", table, id, fields: Object.keys(values) });
  };
  const addUpdate = (table, id, patch, beforeTags) => {
    updates[table].push({ id, patch, ...(beforeTags === undefined ? {} : { beforeTags }) });
    counts[table].updated++;
    actions.push({ action: "update", table, id, fields: Object.keys(patch) });
  };

  const busquedasById = mapById(existing.busquedas || []);
  for (const [index, raw] of (data.busquedas_nuevas || []).entries()) {
    const row = requireObject(raw, "busquedas_nuevas.json", index);
    const id = requireId(row, "busquedas_nuevas.json", index);
    if (empty(row.puesto)) throw new Error(`busquedas_nuevas.json, fila ${index + 1}: falta el puesto.`);
    if (busquedasById.has(id)) {
      skip("busquedas", id, "el id ya existe");
      continue;
    }
    const values = cleanRow(S.busquedas, { ...row, id, actualizado: actualizadoComoSeed(row) });
    addInsert("busquedas", id, values);
    busquedasById.set(id, values);
  }

  const candidatosById = mapById(existing.candidatos || []);
  for (const [index, raw] of (data.candidatos_nuevos || []).entries()) {
    const row = requireObject(raw, "candidatos_nuevos.json", index);
    const id = requireId(row, "candidatos_nuevos.json", index);
    if (empty(row.nombre)) throw new Error(`candidatos_nuevos.json, fila ${index + 1}: falta el nombre.`);
    if (candidatosById.has(id)) {
      skip("candidatos", id, "el id ya existe");
      continue;
    }
    const values = cleanRow(S.candidatos, { ...row, id });
    addInsert("candidatos", id, values);
    candidatosById.set(id, { tags: [], ...values });
  }

  const postulacionesById = mapById(existing.postulaciones || []);
  for (const [index, raw] of (data.postulaciones_nuevas || []).entries()) {
    const row = requireObject(raw, "postulaciones_nuevas.json", index);
    const id = asId(row.id);
    const busquedaId = asId(row.busquedaId);
    const candidatoId = asId(row.candidatoId);
    const missing = [];
    if (!busquedaId || !busquedasById.has(busquedaId)) missing.push(`búsqueda ${busquedaId || "(vacía)"}`);
    if (!candidatoId || !candidatosById.has(candidatoId)) missing.push(`candidato ${candidatoId || "(vacío)"}`);
    if (missing.length) {
      skip("postulaciones", id, `referencias inexistentes: ${missing.join(", ")}`);
      continue;
    }
    if (!id) {
      skip("postulaciones", id, "falta el id");
      continue;
    }
    if (postulacionesById.has(id)) {
      skip("postulaciones", id, "el id ya existe");
      continue;
    }
    const values = cleanRow(S.postulaciones, { ...row, id, busquedaId, candidatoId });
    addInsert("postulaciones", id, values);
    postulacionesById.set(id, values);
  }

  for (const [index, raw] of (data.candidatos_actualizar || []).entries()) {
    const row = requireObject(raw, "candidatos_actualizar.json", index);
    const id = asId(row.id);
    const candidate = candidatosById.get(id);
    if (!candidate) {
      skip("candidatos", id, id ? "no existe el candidato" : "falta el id");
      continue;
    }
    const patch = {};
    for (const key of ["linkedin", "email", "telefono", "empresaActual", "pretension", "ubicacion", "area"]) {
      if (Object.hasOwn(row, key) && empty(candidate[key]) && !empty(row[key])) patch[key] = row[key];
    }
    let nextTags = candidate.tags;
    if (Object.hasOwn(row, "tagsAgregar")) {
      const tags = appendUniqueTags(candidate.tags ?? [], row.tagsAgregar, id);
      if (tags.added) {
        patch.tags = tags.result;
        nextTags = tags.result;
      }
    }
    if (!Object.keys(patch).length) {
      skip("candidatos", id, "no hay campos vacíos para completar ni tags nuevos");
      continue;
    }
    addUpdate("candidatos", id, patch, Object.hasOwn(patch, "tags") ? candidate.tags ?? [] : undefined);
    candidatosById.set(id, { ...candidate, ...patch, tags: nextTags });
  }

  const clientesById = mapById(existing.clientes || []);
  for (const [index, raw] of (data.clientes_actualizar || []).entries()) {
    const row = requireObject(raw, "clientes_actualizar.json", index);
    const id = asId(row.id);
    const client = clientesById.get(id);
    if (!client) {
      skip("clientes", id, id ? "no existe el cliente" : "falta el id");
      continue;
    }
    const patch = {};
    for (const key of ["contactos", "icp"]) {
      if (Object.hasOwn(row, key) && empty(client[key]) && !empty(row[key])) patch[key] = row[key];
    }
    if (Object.hasOwn(row, "notas") && !empty(row.notas)) {
      if (typeof row.notas !== "string") throw new Error(`clientes_actualizar.json, fila ${index + 1}: notas debe ser texto.`);
      const oldNotes = typeof client.notas === "string" ? client.notas : "";
      if (!oldNotes.includes(row.notas)) patch.notas = oldNotes.trim() ? `${oldNotes.trimEnd()}\n${row.notas}` : row.notas;
    }
    if (!Object.keys(patch).length) {
      skip("clientes", id, "no hay campos vacíos para completar ni notas nuevas");
      continue;
    }
    addUpdate("clientes", id, patch);
    clientesById.set(id, { ...client, ...patch });
  }

  const leadsById = mapById(existing.leads || []);
  for (const [index, raw] of (data.leads_nuevos || []).entries()) {
    const row = requireObject(raw, "leads_nuevos.json", index);
    const id = requireId(row, "leads_nuevos.json", index);
    if (empty(row.empresa)) throw new Error(`leads_nuevos.json, fila ${index + 1}: falta la empresa.`);
    if (leadsById.has(id)) {
      skip("leads", id, "el id ya existe");
      continue;
    }
    const values = cleanRow(S.leads, { ...row, id });
    addInsert("leads", id, values);
    leadsById.set(id, values);
  }

  return { counts, actions, skipped, inserts, updates };
}

export function formatImportAction(item) {
  if (item.action === "skip") return `Omitir ${item.table}/${item.id}: ${item.reason}`;
  return `Prever ${item.action === "insert" ? "insertar" : "actualizar"} ${item.table}/${item.id} (${(item.fields || []).join(", ")})`;
}
