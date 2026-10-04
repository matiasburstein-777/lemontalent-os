// Backup de la base: arma un JSON con todas las tablas y lo sube comprimido a una carpeta de Google Drive.
// Sin contenido de archivos adjuntos (CV) ni hashes de contraseña. Se guardan los últimos 30 días.
// Secretos: GOOGLE_SA_JSON, BACKUP_DRIVE_FOLDER_ID y, si la carpeta no está en una unidad compartida
// donde la cuenta de servicio es miembro, BACKUP_DRIVE_USER (usuario @lemontalent.com a impersonar).
import zlib from "node:zlib";
import { googleToken } from "./digest.js";

const EXCLUIR = new Set(["session"]); // sesiones de login: no sirven en un backup
const COLUMNAS_FUERA = { users: ["password_hash"], archivos: ["datos"] };
const DIAS = 30;
const PREFIJO = "lemon-talent-backup-";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

export async function armarBackup(pool) {
  const out = { generado: new Date().toISOString(), version: 2, tablas: {} };
  const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
  for (const { table_name: t } of rows) {
    if (EXCLUIR.has(t)) continue;
    const fuera = COLUMNAS_FUERA[t];
    let cols = "*";
    if (fuera) {
      const c = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [t]);
      cols = c.rows.map((r) => r.column_name).filter((n) => !fuera.includes(n)).map((n) => `"${n}"`).join(", ");
    }
    out.tablas[t] = (await pool.query(`SELECT ${cols} FROM "${t}"`)).rows;
  }
  return out;
}

// Fecha de Buenos Aires para el nombre del archivo (YYYY-MM-DD).
const fechaBA = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

async function dfetch(url, token, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { authorization: "Bearer " + token, ...(opts.headers || {}) } });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Drive: " + (j.error?.message || "HTTP " + r.status));
  return j;
}

export async function subirBackupADrive(pool) {
  if (!process.env.GOOGLE_SA_JSON) throw new Error("Falta GOOGLE_SA_JSON en Secrets.");
  const carpeta = process.env.BACKUP_DRIVE_FOLDER_ID;
  if (!carpeta) throw new Error("Falta BACKUP_DRIVE_FOLDER_ID en Secrets.");
  const sa = JSON.parse(process.env.GOOGLE_SA_JSON);
  const token = await googleToken(sa, process.env.BACKUP_DRIVE_USER || undefined, "https://www.googleapis.com/auth/drive");

  const b = await armarBackup(pool);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(b)));
  const nombre = `${PREFIJO}${fechaBA()}.json.gz`;

  // Subida multipart: metadatos + contenido.
  const limite = "lt" + Date.now().toString(36);
  const meta = { name: nombre, parents: [carpeta], mimeType: "application/gzip" };
  const cuerpo = Buffer.concat([
    Buffer.from(`--${limite}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${limite}\r\ncontent-type: application/gzip\r\n\r\n`),
    gz,
    Buffer.from(`\r\n--${limite}--`),
  ]);
  const subido = await dfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", token, {
    method: "POST", headers: { "content-type": `multipart/related; boundary=${limite}` }, body: cuerpo,
  });

  // Borra los backups de más de 30 días de esa carpeta.
  const corte = new Date(Date.now() - DIAS * 86400e3).toISOString();
  const q = `'${carpeta}' in parents and name contains '${PREFIJO}' and createdTime < '${corte}' and trashed = false`;
  const viejos = await dfetch(`${DRIVE}?${new URLSearchParams({ q, fields: "files(id,name)", pageSize: "200", supportsAllDrives: "true", includeItemsFromAllDrives: "true" })}`, token);
  let borrados = 0;
  for (const f of viejos.files || []) {
    await dfetch(`${DRIVE}/${f.id}?supportsAllDrives=true`, token, { method: "DELETE" });
    borrados++;
  }

  const tablas = Object.keys(b.tablas).length;
  const registros = Object.values(b.tablas).reduce((n, t) => n + t.length, 0);
  return { fecha: b.generado, archivo: subido.name, id: subido.id, tamano: gz.length, tablas, registros, borrados };
}

// Corre el backup y deja el resultado (ok o error) en config.backupDrive para mostrarlo en la app.
export async function backupDiario(pool) {
  let estado;
  try { estado = { ok: true, ...(await subirBackupADrive(pool)) }; }
  catch (e) { estado = { ok: false, fecha: new Date().toISOString(), error: e.message }; }
  await pool.query("INSERT INTO config (key, value) VALUES ('backupDrive', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(estado)]);
  return estado;
}
