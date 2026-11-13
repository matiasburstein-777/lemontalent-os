import crypto from "node:crypto";

const MARCADOR = "startupLimpiezaFalsosPerfiles20261022";
const APLICACIONES = [
  { id: "p1286", busquedaId: "b0028", candidatoId: "c1283", etapa: "Sourcing" },
  { id: "p1311", busquedaId: "b0028", candidatoId: "c1308", etapa: "Sourcing" },
  { id: "p1280", busquedaId: "b0028", candidatoId: "c1277", etapa: "Sourcing" },
];
const CANDIDATOS = [
  { id: "c1283", nombre: "IA - Tecnología" },
  { id: "c1308", nombre: "Ssr" },
  { id: "c1277", nombre: "Reapertura 13/2/2026" },
  { id: "c2557", nombre: "Postulados UB - encontrar CV en mail - hiring room" },
];

export async function ejecutarLimpiezaUnicaProduccion(pool) {
  // Replit define esta marca solo en Deployments; no corre en el workspace de desarrollo.
  if (process.env.REPLIT_DEPLOYMENT !== "1") return;
  let tx;
  let resumen;
  try {
    tx = await pool.connect();
    await tx.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await tx.query("SELECT pg_advisory_xact_lock(526021,20261022)");
    const marker = await tx.query("SELECT 1 FROM config WHERE key=$1", [MARCADOR]);
    if (marker.rowCount) {
      await tx.query("COMMIT");
      console.info("[limpieza puntual producción] ya ejecutada; sin cambios.");
      return;
    }

    // Respaldo completo de candidatos en el config existente, antes de borrar.
    const { rows: candidatosAntes } = await tx.query("SELECT * FROM candidatos ORDER BY id");
    const backupKey = `normalizarBaseBackup:${new Date().toISOString()}`;
    const backup = {
      generado: new Date().toISOString(),
      tabla: "candidatos",
      motivo: "respaldo previo a limpieza puntual de perfiles falsos",
      total: candidatosAntes.length,
      registros: candidatosAntes,
    };
    await tx.query("INSERT INTO config(key,value) VALUES($1,$2::jsonb)", [backupKey, JSON.stringify(backup)]);

    const borradasPostulaciones = [];
    const postulacionesOmitidas = [];
    for (const esperado of APLICACIONES) {
      const { rows } = await tx.query("SELECT id,busqueda_id,candidato_id,etapa FROM postulaciones WHERE id=$1 FOR UPDATE", [esperado.id]);
      if (!rows.length) {
        postulacionesOmitidas.push({ id: esperado.id, motivo: "ya no existe" });
        continue;
      }
      const p = rows[0];
      if (p.busqueda_id !== esperado.busquedaId || p.candidato_id !== esperado.candidatoId || p.etapa !== esperado.etapa) {
        postulacionesOmitidas.push({ id: esperado.id, motivo: "no coincide búsqueda, candidato o etapa" });
        continue;
      }
      const { rowCount } = await tx.query(
        "DELETE FROM postulaciones WHERE id=$1 AND busqueda_id=$2 AND candidato_id=$3 AND etapa=$4",
        [esperado.id, esperado.busquedaId, esperado.candidatoId, esperado.etapa],
      );
      if (rowCount) borradasPostulaciones.push(esperado.id);
    }

    const borradosCandidatos = [];
    const candidatosOmitidos = [];
    for (const esperado of CANDIDATOS) {
      const { rows } = await tx.query("SELECT id,nombre FROM candidatos WHERE id=$1 FOR UPDATE", [esperado.id]);
      if (!rows.length) {
        candidatosOmitidos.push({ id: esperado.id, motivo: "ya no existe" });
        continue;
      }
      if (rows[0].nombre !== esperado.nombre) {
        candidatosOmitidos.push({ id: esperado.id, motivo: "el nombre no coincide exactamente" });
        continue;
      }
      const { rows: restantes } = await tx.query("SELECT count(*)::int AS total FROM postulaciones WHERE candidato_id=$1", [esperado.id]);
      if (restantes[0].total !== 0) {
        candidatosOmitidos.push({ id: esperado.id, nombre: esperado.nombre, motivo: `conservado: quedan ${restantes[0].total} postulaciones` });
        continue;
      }
      const { rows: full } = await tx.query("SELECT * FROM candidatos WHERE id=$1", [esperado.id]);
      await tx.query(
        "INSERT INTO papelera(id,usuario_id,coleccion,registro_id,datos) VALUES($1,NULL,'candidatos',$2,$3::jsonb)",
        ["pp" + crypto.randomUUID().replace(/-/g, ""), esperado.id, JSON.stringify(full[0])],
      );
      const { rowCount } = await tx.query("DELETE FROM candidatos WHERE id=$1 AND nombre=$2", [esperado.id, esperado.nombre]);
      if (rowCount) borradosCandidatos.push({ id: esperado.id, nombre: esperado.nombre });
      else candidatosOmitidos.push({ id: esperado.id, nombre: esperado.nombre, motivo: "el registro cambió durante la limpieza" });
    }

    resumen = { backupKey, borradasPostulaciones, postulacionesOmitidas, borradosCandidatos, candidatosOmitidos };
    await tx.query("INSERT INTO config(key,value) VALUES($1,$2::jsonb)", [MARCADOR, JSON.stringify({ ejecutada: new Date().toISOString(), ...resumen })]);
    await tx.query("COMMIT");
    console.info("[limpieza puntual producción] resultado:", JSON.stringify(resumen));
  } catch (error) {
    await tx?.query("ROLLBACK").catch(() => {});
    console.error("[limpieza puntual producción] falló; transacción revertida:", error.message);
  } finally {
    tx?.release();
  }
}
