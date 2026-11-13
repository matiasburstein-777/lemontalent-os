import assert from "node:assert/strict";
import test from "node:test";
import { IMPORT_FILE_NAMES, loadImportDataFromStorage } from "../scripts/os-import-core.js";

function storageClient(objects) {
  const downloaded = [];
  return {
    downloaded,
    async list() {
      return { ok: true, value: Object.keys(objects).map((name) => ({ name })) };
    },
    async downloadAsBytes(name) {
      downloaded.push(name);
      return { ok: true, value: [Buffer.from(objects[name], "utf8")] };
    },
  };
}

test("loads only required root JSON objects and ignores spreadsheet and underscore files", async () => {
  const objects = Object.fromEntries(IMPORT_FILE_NAMES.map((name) => [name, "[]"]));
  objects["Revision_import_Lemon_OS.xlsx"] = "ignored";
  objects["_mapeo_pipelines.json"] = "ignored";
  objects["nested/candidatos_nuevos.json"] = "[]";
  const client = storageClient(objects);

  const data = await loadImportDataFromStorage(client);

  assert.deepEqual(data.candidatos_nuevos, []);
  assert.deepEqual(data.ignoredFiles, ["Revision_import_Lemon_OS.xlsx", "_mapeo_pipelines.json"]);
  assert.deepEqual(client.downloaded.sort(), IMPORT_FILE_NAMES.slice().sort());
});

test("fails clearly when a required JSON object is missing", async () => {
  const objects = Object.fromEntries(IMPORT_FILE_NAMES
    .filter((name) => name !== "postulaciones_nuevas.json")
    .map((name) => [name, "[]"]));

  await assert.rejects(
    loadImportDataFromStorage(storageClient(objects)),
    /postulaciones_nuevas\.json/,
  );
});
