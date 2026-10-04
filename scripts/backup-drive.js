// Backup diario a Google Drive. Pensado para un Scheduled Deployment de Replit:
//   comando: node scripts/backup-drive.js   ·   horario: todos los días 3:00 (Buenos Aires)
// Sale con código 1 si falla, así Replit marca la corrida como fallida.
import { pool } from "../server/db.js";
import { backupDiario } from "../server/backup.js";

const r = await backupDiario(pool);
await pool.end();
if (r.ok) console.log(`Backup subido: ${r.archivo} (${Math.round(r.tamano / 1024)} KB, ${r.tablas} tablas, ${r.registros} registros, ${r.borrados} viejos borrados)`);
else { console.error("Backup falló:", r.error); process.exit(1); }
