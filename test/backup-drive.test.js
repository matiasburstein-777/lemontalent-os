import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { esHoraBackupDiario, nombreBackupDiario, subirBackupADrive } from "../server/backup.js";
import { registerExtras } from "../server/extras.js";

const secretKeys = ["GOOGLE_SA_JSON", "BACKUP_DRIVE_USER", "BACKUP_DRIVE_FOLDER", "INGEST_TOKEN"];

function saveEnv() {
  return Object.fromEntries(secretKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previous) {
  for (const key of secretKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

function mockBackupPool() {
  return {
    async query(sql) {
      if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "users" }] };
      if (sql.includes("information_schema.columns")) {
        return { rows: [{ column_name: "id" }, { column_name: "nombre" }, { column_name: "password_hash" }] };
      }
      if (sql.includes('FROM "users"')) return { rows: [{ id: "u-test", nombre: "Persona de prueba" }] };
      throw new Error(`Consulta inesperada en prueba: ${sql}`);
    },
  };
}

test("el nombre diario y el horario usan Buenos Aires", () => {
  assert.equal(nombreBackupDiario(new Date("2026-10-05T05:00:00.000Z")), "lemon-talent-backup-2026-10-05.json");
  assert.equal(esHoraBackupDiario(new Date("2026-10-05T05:30:00.000Z")), true);
  assert.equal(esHoraBackupDiario(new Date("2026-10-05T05:29:00.000Z")), false);
});

test("actualiza el JSON del día y manda a papelera solo el backup más viejo al rotar", async () => {
  const previous = saveEnv();
  process.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: "test@example.invalid", private_key: "not-used-by-test" });
  process.env.BACKUP_DRIVE_USER = "backup@example.invalid";
  process.env.BACKUP_DRIVE_FOLDER = "folder-test";

  const now = new Date("2026-10-05T12:00:00.000Z");
  const files = Array.from({ length: 31 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 5 + index)).toISOString().slice(0, 10);
    return {
      id: `backup-${date}`,
      name: `lemon-talent-backup-${date}.json`,
      mimeType: "application/json",
      createdTime: `${date}T03:00:00.000Z`,
      modifiedTime: `${date}T03:00:00.000Z`,
    };
  });
  files.push(
    { id: "keep-unrelated", name: "other-file.json", mimeType: "application/json" },
    { id: "keep-invalid-date", name: "lemon-talent-backup-2026-13-40.json", mimeType: "application/json" },
  );
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), ...options });
    if (String(url).startsWith("https://www.googleapis.com/drive/v3/files?")) {
      return new Response(JSON.stringify({ files }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("/upload/drive/v3/files/backup-2026-10-05")) {
      return new Response(JSON.stringify({
        id: "backup-2026-10-05",
        name: "lemon-talent-backup-2026-10-05.json",
        mimeType: "application/json",
        createdTime: "2026-10-05T03:00:00.000Z",
        modifiedTime: now.toISOString(),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("/drive/v3/files/backup-2026-09-05")) {
      return new Response(JSON.stringify({ id: "backup-2026-09-05", trashed: true }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`URL de Drive inesperada en prueba: ${url}`);
  };

  try {
    const result = await subirBackupADrive(mockBackupPool(), {
      now,
      fetcher,
      getToken: async (_sa, user, scope) => {
        assert.equal(user, "backup@example.invalid");
        assert.equal(scope, "https://www.googleapis.com/auth/drive");
        return "unit-test-token";
      },
    });
    assert.deepEqual(Object.keys(result).sort(), ["bytes", "fileId", "nombre", "ok", "rotados"]);
    assert.equal(result.ok, true);
    assert.equal(result.fileId, "backup-2026-10-05");
    assert.equal(result.nombre, "lemon-talent-backup-2026-10-05.json");
    assert.equal(result.rotados, 1);
    assert.ok(Number.isInteger(result.bytes) && result.bytes > 0);

    const upload = calls.find((call) => call.url.includes("/upload/drive/v3/files/backup-2026-10-05"));
    assert.equal(upload.method, "PATCH");
    assert.match(upload.headers["content-type"], /^multipart\/related; boundary=/);
    const body = upload.body.toString("utf8");
    assert.match(body, /"mimeType":"application\/json"/);
    assert.match(body, /"generado"/);
    assert.match(body, /"version":2/);
    assert.match(body, /"tablas"/);

    const trashed = calls.filter((call) => call.method === "PATCH" && String(call.url).startsWith("https://www.googleapis.com/drive/v3/files/backup-"));
    assert.equal(trashed.length, 1);
    assert.match(trashed[0].url, /backup-2026-09-05/);
    assert.deepEqual(JSON.parse(trashed[0].body), { trashed: true });
    assert.equal(calls.some((call) => call.method === "DELETE"), false);
    assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/upload/drive/")), false);
  } finally {
    restoreEnv(previous);
  }
});

test("crea el archivo JSON dentro de la carpeta cuando todavía no existe", async () => {
  const previous = saveEnv();
  process.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: "test@example.invalid", private_key: "not-used-by-test" });
  process.env.BACKUP_DRIVE_USER = "backup@example.invalid";
  process.env.BACKUP_DRIVE_FOLDER = "folder-test";
  const now = new Date("2026-10-05T12:00:00.000Z");
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), ...options });
    if (String(url).startsWith("https://www.googleapis.com/drive/v3/files?")) {
      return new Response(JSON.stringify({ files: [{ id: "unrelated", name: "notes.json", mimeType: "application/json" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (String(url).startsWith("https://www.googleapis.com/upload/drive/v3/files?")) {
      return new Response(JSON.stringify({
        id: "new-backup",
        name: "lemon-talent-backup-2026-10-05.json",
        mimeType: "application/json",
        modifiedTime: now.toISOString(),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`URL de Drive inesperada en prueba: ${url}`);
  };

  try {
    const result = await subirBackupADrive(mockBackupPool(), {
      now,
      fetcher,
      getToken: async () => "unit-test-token",
    });
    assert.equal(result.fileId, "new-backup");
    assert.equal(result.rotados, 0);
    const upload = calls.find((call) => call.method === "POST");
    const body = upload.body.toString("utf8");
    assert.match(body, /"name":"lemon-talent-backup-2026-10-05\.json"/);
    assert.match(body, /"mimeType":"application\/json"/);
    assert.match(body, /"parents":\["folder-test"\]/);
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
  } finally {
    restoreEnv(previous);
  }
});

test("el endpoint de ingesta devuelve 503 y el nombre del secreto faltante", async (t) => {
  const previous = saveEnv();
  delete process.env.GOOGLE_SA_JSON;
  process.env.BACKUP_DRIVE_USER = "backup@example.invalid";
  process.env.BACKUP_DRIVE_FOLDER = "folder-test";
  process.env.INGEST_TOKEN = "unit-test-ingest-token-long-enough";

  const pool = { query: async () => ({ rows: [] }) };
  const app = express();
  registerExtras(app, {
    db: {},
    pool,
    S: {},
    auth: () => (_req, _res, next) => next(),
    rank: () => 0,
    RANK: {},
    R: {},
    newId: () => "test",
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const url = `http://127.0.0.1:${server.address().port}/api/ingest/backup/drive`;
    const unauthorized = await fetch(url, { method: "POST" });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.INGEST_TOKEN}` },
    });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(result.missingSecret, "GOOGLE_SA_JSON");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreEnv(previous);
  }
});
