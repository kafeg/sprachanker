// A profile moved as a file (05, "Profile file"): exported from one data root and imported into
// another — its runs, events, cards, settings and recordings as they were, its API keys left out —,
// and every file that is not one refused with nothing left behind.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { ulid } from "ulid";
import { profileTransferFiles } from "../src/runtime/profile-transfer.ts";
import type { TransferFiles } from "../src/services/profile-transfer.ts";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const COURSE = "sprachanker.fixture/demo";
const TABLES = ["runs", "events", "cards", "card_state", "settings", "llm_routes"];
// biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
const read = async (res: Response | Promise<Response>): Promise<any> => (await res).json();
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A profile studied a little: a lesson answered, its words' cards with one rated, a setting, a
 *  recording, an API key and a model. */
async function studied() {
  const api = await setup();
  const { sendJson, send, app, cookie } = api;
  const { run } = await sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
  });
  await sendJson("POST", `/api/runs/${run.id}/events`, {
    events: [
      { id: ulid(), type: "page_shown", payload: { pageIndex: 0 } },
      {
        id: ulid(),
        type: "answered",
        itemKey: `${LESSON}/ex-01#1`,
        payload: { answer: { optionId: "a" }, attempt: 1, ms: 900 },
      },
    ],
  });
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
  });
  const study = await api.getJson(
    `/api/cards/study?scope=${encodeURIComponent(`course:${COURSE}`)}`,
  );
  await sendJson("POST", `/api/cards/${study.current.cardId}/review`, {
    id: ulid(),
    reps: 0,
    face: study.current.face,
    rating: 3,
  });
  await send("PUT", "/api/settings", { key: "srs.newPerDay", value: 7 });
  await sendJson("PUT", "/api/llm/providers/openrouter", { apiKey: "sk-or-secret" });
  await sendJson("PUT", "/api/llm/route", { provider: "openrouter", model: "some/model" });
  const audio = new Uint8Array(3000).map((_, i) => (i * 7) % 256);
  const saved = await app.request("/api/recordings", {
    method: "POST",
    headers: { cookie, "content-type": "audio/webm", ...CLIENT_HEADERS },
    body: audio,
  });
  expect(saved.status).toBe(200);
  return api;
}

/** The signed-in profile exported: what the export said, and the file. */
async function exported(api: Awaited<ReturnType<typeof setup>>) {
  const ready = await read(api.send("POST", "/api/profile/export", {}));
  const res = await api.get(`/api/profile/export/${ready.id}`);
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { ready, res, bytes };
}

/** A file imported into a data root from a device signed in to nothing, its length told (as the web
 *  client's upload tells it). */
const importInto = (api: Awaited<ReturnType<typeof setup>>, body: Uint8Array) =>
  api.app.request("/api/profiles/import", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
      ...CLIENT_HEADERS,
    },
    body,
  });

/** A body that notes whether anything read it. */
function watched(bytes: Uint8Array) {
  const seen = { read: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.read = true;
        controller.enqueue(bytes);
        controller.close();
      },
    },
    // Nothing pulled before a read asks.
    { highWaterMark: 0 },
  );
  return { body, seen };
}

/** Rows of a profile database's tables, as stored. */
function rowsOf(file: string, tables = TABLES) {
  const db = new Database(file, { readonly: true });
  try {
    return Object.fromEntries(
      tables.map((t) => [t, db.query(`SELECT * FROM ${t} ORDER BY 1, 2`).all()]),
    );
  } finally {
    db.close();
  }
}

/** A profile file changed: its files (a database changed through `sql`), its manifest, the hashes
 *  listed made right again unless `keepHashes`. */
function repack(
  bytes: Uint8Array,
  change: {
    sql?: string;
    files?: (files: Record<string, Uint8Array>) => void;
    // biome-ignore lint/suspicious/noExplicitAny: a manifest changed at will.
    manifest?: (manifest: any) => void;
    keepHashes?: boolean;
  },
) {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(files["manifest.json"] as Uint8Array));
  delete files["manifest.json"];
  if (change.sql) {
    const file = join(mkdtempSync(join(tmpdir(), "sprachanker-repack-")), "profile.sqlite");
    writeFileSync(file, files["profile.sqlite"] as Uint8Array);
    const db = new Database(file);
    db.exec(change.sql);
    db.close();
    files["profile.sqlite"] = new Uint8Array(readFileSync(file));
  }
  change.files?.(files);
  change.manifest?.(manifest);
  if (!change.keepHashes)
    manifest.files = manifest.files.map((f: { path: string }) => {
      const data = files[f.path] as Uint8Array;
      return { path: f.path, size: data.length, sha256: sha256(data) };
    });
  return zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), ...files }, { level: 0 });
}

/** A zip of stored entries made by hand: the records written one after another (`data` as given),
 *  the directory naming entries by name, offset and size — an entry may point into another's data —,
 *  `padding` bytes added to the directory's end. */
function handZip(
  records: Array<{ name: string; data: Uint8Array }>,
  directory: (offsets: Map<string, number>) => Array<{ name: string; at: number; size: number }>,
  padding = 0,
) {
  const parts: Uint8Array[] = [];
  const offsets = new Map<string, number>();
  let length = 0;
  const push = (part: Uint8Array) => {
    parts.push(part);
    length += part.length;
  };
  for (const r of records) {
    offsets.set(r.name, length);
    push(localHeader(r.name, r.data.length));
    push(r.data);
  }
  const dirAt = length;
  const entries = directory(offsets);
  for (const e of entries) {
    const name = strToU8(e.name);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt32LE(e.size, 20);
    head.writeUInt32LE(e.size, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(e.at, 42);
    push(head);
    push(name);
  }
  push(new Uint8Array(padding));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(length - dirAt, 12);
  end.writeUInt32LE(dirAt, 16);
  push(end);
  return new Uint8Array(Buffer.concat(parts));
}

/** A stored entry's local header, its name after it. */
function localHeader(fileName: string, size: number) {
  const name = strToU8(fileName);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt32LE(size, 18);
  head.writeUInt32LE(size, 22);
  head.writeUInt16LE(name.length, 26);
  return Buffer.concat([head, name]);
}

/** Nothing of a failed import left: no profile but the first, no folder, no transfer. */
async function nothingLeft(api: Awaited<ReturnType<typeof setup>>) {
  expect(
    (await read(api.anonymous("GET", "/api/profiles"))).profiles.map((p: { id: string }) => p.id),
  ).toEqual(["local"]);
  expect(readdirSync(join(api.root, "profiles")).filter((n) => n !== ".transfers")).toEqual([
    "local",
  ]);
  const transfers = join(api.root, "profiles", ".transfers");
  expect(existsSync(transfers) ? readdirSync(transfers) : []).toEqual([]);
}

test("a profile exported and imported into another data root: its data as it was, its API keys left out", async () => {
  const a = await studied();
  const { ready, res, bytes } = await exported(a);
  expect(ready.fileName).toBe("Test-1970-01-01.sprachanker-profile");
  expect(ready.leftOut).toEqual({ apiKeys: ["openrouter"], endpointLogins: [] });
  // Streamed with its length known, as a download; once only.
  expect(Number(res.headers.get("content-length"))).toBe(bytes.length);
  expect(ready.bytes).toBe(bytes.length);
  expect(res.headers.get("content-disposition")).toContain(
    'attachment; filename="Test-1970-01-01.sprachanker-profile"',
  );
  expect((await a.get(`/api/profile/export/${ready.id}`)).status).toBe(404);
  expect(readdirSync(join(a.root, "profiles", ".transfers"))).toEqual([]);

  // The manifest: what the file holds and what it was made from.
  const files = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(files["manifest.json"] as Uint8Array));
  expect(manifest).toMatchObject({
    format: "sprachanker-profile",
    version: 1,
    appVersion: "test",
    profile: { name: "Test", colour: "amber" },
    migrations: ["0000_init", "0001_deck_source_keys"],
    content: { courses: [{ key: COURSE, editions: ["ru-de"] }], exams: [], decks: [] },
    leftOut: { apiKeys: ["openrouter"], endpointLogins: [] },
  });
  expect(manifest.content.courses[0].title).toBeString();
  expect(Object.keys(files).sort()).toEqual(
    ["manifest.json", ...manifest.files.map((f: { path: string }) => f.path)].sort(),
  );
  for (const f of manifest.files)
    expect([f.size, f.sha256]).toEqual([
      files[f.path]?.length,
      sha256(files[f.path] as Uint8Array),
    ]);
  // The secrets are not in the file at all: the database's pages hold no sealed key.
  expect(Buffer.from(files["profile.sqlite"] as Uint8Array).includes("openrouter")).toBe(true);
  const sealed = new Database(join(a.root, "profiles/local/profile.sqlite"), { readonly: true })
    .query<{ value_encrypted: string }, []>("SELECT value_encrypted FROM secrets")
    .all()[0]?.value_encrypted as string;
  expect(Buffer.from(files["profile.sqlite"] as Uint8Array).includes(sealed)).toBe(false);

  // Imported where another profile has its name: a new one, "Test (2)", onboarded, signed in nowhere.
  const b = await setup();
  const imported = await importInto(b, bytes);
  expect(imported.status).toBe(200);
  const result = await read(imported);
  expect(result.profile).toMatchObject({ name: "Test (2)", colour: "amber", onboarded: true });
  expect(result.leftOut).toEqual({ apiKeys: ["openrouter"], endpointLogins: [] });
  expect(result.missing).toEqual({ courses: [], exams: [], decks: [] });
  const id = result.profile.id;
  const mine = join(a.root, "profiles/local");
  const theirs = join(b.root, "profiles", id);
  expect(rowsOf(join(theirs, "profile.sqlite"))).toEqual(rowsOf(join(mine, "profile.sqlite")));
  expect(rowsOf(join(theirs, "profile.sqlite"), ["secrets"])).toEqual({ secrets: [] });
  expect(readdirSync(join(theirs, "recordings"))).toEqual(readdirSync(join(mine, "recordings")));
  for (const name of readdirSync(join(mine, "recordings")))
    expect(readFileSync(join(theirs, "recordings", name))).toEqual(
      readFileSync(join(mine, "recordings", name)),
    );
  const devices = new Database(join(b.root, "server.sqlite"), { readonly: true })
    .query("SELECT * FROM devices WHERE profile_id = ?")
    .all(id);
  expect(devices).toEqual([]);
  expect(readdirSync(join(b.root, "profiles", ".transfers"))).toEqual([]);

  // Studied on: signed in, its words and progress are there; the model needs its key again.
  const signedIn = await b.anonymous("POST", "/api/session", { profile: id });
  const cookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const as = (path: string) => read(b.app.request(path, { headers: { cookie } }));
  expect(await as("/api/cards")).toEqual(await a.getJson("/api/cards"));
  expect(await as("/api/notebook")).toEqual(await a.getJson("/api/notebook"));
  expect(await as("/api/recordings")).toEqual(await a.getJson("/api/recordings"));
  const llm = await as("/api/llm");
  expect([
    llm.provider,
    llm.providers.find((p: { id: string }) => p.id === "openrouter").hasKey,
  ]).toEqual(["openrouter", false]);
  const again = await read(importInto(b, bytes));
  expect(again.profile.name).toBe("Test (3)");
});

test("endpoints: a user name and password left out of the file; one a provider may not have dropped on import", async () => {
  const a = await studied();
  const endpoints = (root: string, id: string) => {
    const db = new Database(join(root, "profiles", id, "profile.sqlite"), { readonly: true });
    try {
      const row = db
        .query<{ value_json: string }, []>(
          "SELECT value_json FROM settings WHERE key = 'llm.endpoints'",
        )
        .get();
      return row ? JSON.parse(row.value_json) : undefined;
    } finally {
      db.close();
    }
  };
  await a.sendJson("PUT", "/api/llm/providers/custom", { baseUrl: "http://192.168.1.5:8080/v1" });
  // As an older app stored them: a login in the address, an address for a fixed provider.
  const db = new Database(join(a.root, "profiles/local/profile.sqlite"));
  db.run("UPDATE settings SET value_json = ? WHERE key = 'llm.endpoints'", [
    JSON.stringify({
      custom: "http://me:hunter2@192.168.1.5:8080/v1",
      openrouter: "https://elsewhere.example/v1",
    }),
  ]);
  db.close();
  const { ready, bytes } = await exported(a);
  expect(ready.leftOut).toEqual({ apiKeys: ["openrouter"], endpointLogins: ["custom"] });
  expect(Buffer.from(bytes).includes("hunter2")).toBe(false);
  const b = await setup();
  const result = await read(importInto(b, bytes));
  expect(result.leftOut).toEqual({ apiKeys: ["openrouter"], endpointLogins: ["custom"] });
  expect(endpoints(b.root, result.profile.id)).toEqual({ custom: "http://192.168.1.5:8080/v1" });
  // The profile exported still has its own as they were.
  expect(endpoints(a.root, "local").custom).toBe("http://me:hunter2@192.168.1.5:8080/v1");
});

test("content not installed here is named; the profile is imported all the same", async () => {
  const { bytes } = await exported(await studied());
  const b = await setup({ editLibrary: (library) => rmSync(library, { recursive: true }) });
  const result = await read(importInto(b, bytes));
  expect(result.missing.courses).toEqual([
    { key: COURSE, title: expect.any(String), editions: ["ru-de"] },
  ]);
  expect(result.profile.name).toBe("Test (2)");
});

test("a file that is no profile file, or one changed after it was made, is refused: nothing left", async () => {
  const { bytes } = await exported(await studied());
  const b = await setup();
  const refused = async (body: Uint8Array, error: string) => {
    const res = await importInto(b, body);
    expect([res.status, await read(res)]).toEqual([422, { error }]);
    await nothingLeft(b);
  };
  await refused(new Uint8Array(5000).fill(3), "not_a_profile_file");
  await refused(zipSync({ "notes.txt": strToU8("hello") }, { level: 0 }), "not_a_profile_file");
  // Compressed entries are none of ours.
  await refused(zipSync(unzipSync(bytes), { level: 6 }), "not_a_profile_file");
  // A recording changed, its hash as it was.
  await refused(
    repack(bytes, {
      files: (files) => {
        const name = Object.keys(files).find((n) => n.startsWith("recordings/")) as string;
        const data = files[name] as Uint8Array;
        data[10] = (data[10] ?? 0) ^ 0xff;
      },
      keepHashes: true,
    }),
    "profile_file_damaged",
  );
  // A file the manifest does not list; one it lists missing.
  await refused(
    repack(bytes, {
      files: (files) => {
        files[`recordings/${ulid()}.webm`] = new Uint8Array(4);
      },
      keepHashes: true,
    }),
    "profile_file_damaged",
  );
  await refused(
    repack(bytes, {
      files: (files) => {
        for (const name of Object.keys(files))
          if (name.startsWith("recordings/")) delete files[name];
      },
      keepHashes: true,
    }),
    "profile_file_damaged",
  );
  // A path outside the profile.
  await refused(
    zipSync({ ...unzipSync(bytes), "../escape.txt": strToU8("x") }, { level: 0 }),
    "not_a_profile_file",
  );
  // The database given a trigger, its hash made right: not this app's schema.
  await refused(
    repack(bytes, {
      sql: "CREATE TRIGGER sneaky AFTER INSERT ON events BEGIN DELETE FROM cards; END;",
    }),
    "profile_file_damaged",
  );
  await refused(
    repack(bytes, {
      files: (files) => {
        files["profile.sqlite"] = strToU8("not a database");
      },
    }),
    "profile_file_damaged",
  );
});

test("a zip's directory is believed only as far as it is checked: entries overlapping, a directory larger than its entries", async () => {
  const { bytes } = await exported(await studied());
  const b = await setup();
  const files = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(files["manifest.json"] as Uint8Array));
  const database = files["profile.sqlite"] as Uint8Array;
  const [a, inner] = [`recordings/${ulid()}.webm`, `recordings/${ulid()}.webm`];
  const innerData = new Uint8Array(2000).map((_, i) => (i * 13) % 256);
  // The first recording's data holds the second whole, local header and all.
  const outerData = new Uint8Array(
    Buffer.concat([localHeader(inner, innerData.length), innerData]),
  );
  const fileOf = (file: string, data: Uint8Array) => ({
    path: file,
    size: data.length,
    sha256: sha256(data),
  });
  const listed: Array<[string, Uint8Array]> = [
    ["profile.sqlite", database],
    [a, outerData],
    [inner, innerData],
  ];
  const text = JSON.stringify({ ...manifest, files: listed.map(([n, d]) => fileOf(n, d)) });
  /** The records written, each named in the directory where it is; the inner one also, `overlap`,
   *  inside the first recording's data. */
  const zipOf = (records: typeof listed, overlap: boolean, padding = 0) => {
    const all = [["manifest.json", strToU8(text)] as [string, Uint8Array], ...records];
    return handZip(
      all.map(([name, data]) => ({ name, data })),
      (offsets) => {
        const at = (name: string) => offsets.get(name) as number;
        const entries = all.map(([name, data]) => ({ name, at: at(name), size: data.length }));
        const insideA = at(a) + localHeader(a, 0).length + outerData.length - innerData.length;
        const innerAt = insideA - localHeader(inner, 0).length;
        return overlap
          ? [...entries, { name: inner, at: innerAt, size: innerData.length }]
          : entries;
      },
      padding,
    );
  };
  const refused = async (body: Uint8Array) => {
    const res = await importInto(b, body);
    expect([res.status, await read(res)]).toEqual([422, { error: "not_a_profile_file" }]);
    await nothingLeft(b);
  };
  // The directory with room for more than its entries need.
  await refused(zipOf(listed, false, 100_000));
  // An entry inside another's data: each as listed, yet overlapping.
  await refused(
    zipOf(
      listed.filter(([name]) => name !== inner),
      true,
    ),
  );
  // Made by hand as fflate makes it, nothing overlapping: imported.
  expect((await importInto(b, zipOf(listed, false))).status).toBe(200);
});

test("a database with SQL of its own is refused before any of it runs: a view, triggers, an indexed expression, statistics", async () => {
  const { bytes } = await exported(await studied());
  // Each import's database as it was left once settled, before its transfer goes.
  const after: Array<{ fired: unknown[]; secrets: number; copies: string[] }> = [];
  const b = await setup({
    transfers: (root): TransferFiles => {
      const real = profileTransferFiles(root);
      return {
        ...real,
        async settle(id, endpoints) {
          const settled = await real.settle(id, endpoints);
          const folder = join(root, "profiles", ".transfers", id, "profile");
          const db = new Database(join(folder, "profile.sqlite"), { readonly: true });
          try {
            const has = (table: string) =>
              !!db.query("SELECT 1 FROM sqlite_master WHERE name = ?").get(table);
            after.push({
              fired: has("fired") ? db.query("SELECT * FROM fired").all() : [],
              secrets: has("secrets") ? db.query("SELECT * FROM secrets").all().length : 0,
              copies: readdirSync(folder).filter((n) => n.includes(".bak-")),
            });
          } finally {
            db.close();
          }
          return settled;
        },
      };
    },
  });
  const refused = async (body: Uint8Array) => {
    const started = Date.now();
    const res = await importInto(b, body);
    expect([res.status, await read(res)]).toEqual([422, { error: "profile_file_damaged" }]);
    expect(Date.now() - started).toBeLessThan(3000);
    await nothingLeft(b);
  };
  // A view in the migrations' place that never ends when read.
  await refused(
    repack(bytes, {
      sql: `DROP TABLE _migrations;
        CREATE VIEW _migrations AS WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n)
        SELECT '0000_init' AS tag, 0 AS applied_at FROM n WHERE x = 0;`,
    }),
  );
  // Triggers that a migration and emptying the secrets would fire: neither ran.
  await refused(
    repack(bytes, {
      sql: `INSERT INTO secrets (provider_id, value_encrypted) VALUES ('openrouter', 'sealed');
        CREATE TABLE fired (what TEXT);
        CREATE TRIGGER on_secrets BEFORE DELETE ON secrets BEGIN INSERT INTO fired VALUES ('secrets'); END;
        CREATE TRIGGER on_migrations AFTER INSERT ON _migrations BEGIN INSERT INTO fired VALUES ('migrated'); END;
        DELETE FROM _migrations WHERE tag = '0001_deck_source_keys';`,
      manifest: (m) => {
        m.migrations = ["0000_init"];
      },
    }),
  );
  expect(after.at(-1)).toEqual({ fired: [], secrets: 1, copies: [] });
  // An index on an expression, all else as it was: the schema alone refuses it.
  await refused(repack(bytes, { sql: "CREATE INDEX cards_abs ON cards (abs(suspended))" }));
  // The statistics ANALYZE leaves (sqlite_stat1).
  const analysed = repack(bytes, { sql: "ANALYZE" });
  const stat = join(mkdtempSync(join(tmpdir(), "sprachanker-stat-")), "profile.sqlite");
  writeFileSync(stat, unzipSync(analysed)["profile.sqlite"] as Uint8Array);
  expect(
    new Database(stat, { readonly: true })
      .query("SELECT name FROM sqlite_master WHERE name = 'sqlite_stat1'")
      .all(),
  ).toEqual([{ name: "sqlite_stat1" }]);
  await refused(analysed);
});

test("a database made ready for too long is refused", async () => {
  const { bytes } = await exported(await studied());
  const slow = await setup({ transfers: (root) => profileTransferFiles(root, { settleMs: 1 }) });
  const res = await importInto(slow, bytes);
  expect([res.status, await read(res)]).toEqual([422, { error: "profile_file_damaged" }]);
  await nothingLeft(slow);
});

test("a profile from a newer app is refused; one from an older app is migrated forward with a copy", async () => {
  const { bytes } = await exported(await studied());
  const b = await setup();
  const future = repack(bytes, {
    sql: "INSERT INTO _migrations (tag, applied_at) VALUES ('9999_future', 1)",
    manifest: (m) => m.migrations.push("9999_future"),
  });
  const res = await importInto(b, future);
  expect([res.status, await read(res)]).toEqual([422, { error: "profile_from_newer_app" }]);
  // The database alone newer than its manifest says: refused all the same.
  const hidden = await importInto(
    b,
    repack(bytes, { sql: "INSERT INTO _migrations (tag, applied_at) VALUES ('9999_future', 1)" }),
  );
  expect(await read(hidden)).toEqual({ error: "profile_from_newer_app" });
  const version = await importInto(
    b,
    repack(bytes, {
      manifest: (m) => {
        m.version = 2;
      },
    }),
  );
  expect(await read(version)).toEqual({ error: "profile_from_newer_app" });
  await nothingLeft(b);

  const older = repack(bytes, {
    sql: "DELETE FROM _migrations WHERE tag = '0001_deck_source_keys'",
    manifest: (m) => {
      m.migrations = ["0000_init"];
    },
  });
  const result = await read(importInto(b, older));
  const folder = join(b.root, "profiles", result.profile.id);
  const tags = new Database(join(folder, "profile.sqlite"), { readonly: true })
    .query<{ tag: string }, []>("SELECT tag FROM _migrations ORDER BY rowid")
    .all()
    .map((r) => r.tag);
  expect(tags).toEqual(["0000_init", "0001_deck_source_keys"]);
  expect(readdirSync(folder).some((n) => n.startsWith("profile.sqlite.bak-"))).toBe(true);
});

test("a full disk: the export and the import say so and leave nothing behind", async () => {
  const GB = 1024 ** 3;
  const a = await studied();
  const { bytes } = await exported(a);
  // Room is what a transfer writes and a margin: the larger of 1 GB and 5 % of the disk.
  for (const disk of [
    { free: 1000, size: 10 * GB },
    { free: 0.99 * GB, size: 10 * GB },
    { free: 4.9 * GB, size: 100 * GB },
  ]) {
    const tight = await setup({
      transfers: (root) => profileTransferFiles(root, { disk: () => disk }),
    });
    const refused = await tight.send("POST", "/api/profile/export", {});
    expect([refused.status, await read(refused)]).toEqual([507, { error: "not_enough_space" }]);
    expect(readdirSync(join(tight.root, "profiles", ".transfers"))).toEqual([]);
    // Announced too large for the disk before it is received.
    const res = await importInto(tight, bytes);
    expect([res.status, await read(res)]).toEqual([507, { error: "not_enough_space" }]);
    await nothingLeft(tight);
  }
  const roomy = await setup({
    transfers: (root) =>
      profileTransferFiles(root, { disk: () => ({ free: 5.1 * GB, size: 100 * GB }) }),
  });
  expect((await roomy.send("POST", "/api/profile/export", {})).status).toBe(200);
  expect((await importInto(roomy, bytes)).status).toBe(200);

  // The disk filling up while the file is unpacked.
  const filling = await setup({
    transfers: (root): TransferFiles => {
      const real = profileTransferFiles(root);
      return {
        ...real,
        async unpack(id, listed, file) {
          await real.unpack(id, listed, file);
          throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
            code: "ENOSPC",
          });
        },
      };
    },
  });
  const cut = await importInto(filling, bytes);
  expect([cut.status, await read(cut)]).toEqual([507, { error: "not_enough_space" }]);
  await nothingLeft(filling);
});

test("one import at a time; one export a profile, a new one replacing the one not downloaded", async () => {
  const a = await studied();
  const { bytes } = await exported(a);
  const b = await setup();
  // An import still receiving its file.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = b.app.request("/api/profiles/import", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.length),
      ...CLIENT_HEADERS,
    },
    body: new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(bytes.subarray(0, 100));
        await held;
        controller.enqueue(bytes.subarray(100));
        controller.close();
      },
    }),
  });
  await Bun.sleep(50);
  const beside = await importInto(b, bytes);
  expect([beside.status, await read(beside)]).toEqual([409, { error: "profile_import_busy" }]);
  release();
  expect((await slow).status).toBe(200);
  expect((await importInto(b, bytes)).status).toBe(200);

  const first = await read(a.send("POST", "/api/profile/export", {}));
  const second = await read(a.send("POST", "/api/profile/export", {}));
  expect(readdirSync(join(a.root, "profiles", ".transfers"))).toEqual([second.id]);
  expect((await a.get(`/api/profile/export/${first.id}`)).status).toBe(404);
  expect((await a.get(`/api/profile/export/${second.id}`)).status).toBe(200);

  // Asked again while its copy is being made: made once.
  let snapshots = 0;
  let copied = () => {};
  const copying = new Promise<void>((resolve) => {
    copied = resolve;
  });
  const c = await setup({
    transfers: (root): TransferFiles => {
      const real = profileTransferFiles(root);
      return {
        ...real,
        async snapshot(profileId) {
          snapshots++;
          await copying;
          return real.snapshot(profileId);
        },
      };
    },
  });
  const asked = [
    c.send("POST", "/api/profile/export", {}),
    c.send("POST", "/api/profile/export", {}),
  ];
  await Bun.sleep(50);
  copied();
  const [one, two] = await Promise.all(asked.map((res) => read(res)));
  expect([snapshots, one.id]).toEqual([1, two.id]);
});

test("a transfer in use is never swept: an export not yet downloaded, one downloading", async () => {
  const a = await studied();
  const transfers = join(a.root, "profiles", ".transfers");
  const age = (id: string, hours: number) => {
    const then = new Date(Date.now() - hours * 3_600_000);
    utimesSync(join(transfers, id), then, then);
  };
  const ready = await read(a.send("POST", "/api/profile/export", {}));
  // Its folder an hour old (a slow download, a clock moved on); and one a stopped server left.
  age(ready.id, 2);
  const stopped = crypto.randomUUID();
  mkdirSync(join(transfers, stopped));
  age(stopped, 2);
  // A sweep (an import begins with one): the export is this server's, in use.
  await importInto(a, new Uint8Array(10));
  expect(readdirSync(transfers)).toEqual([ready.id]);
  // Another process's sweep goes by the folder's time: a download starting marks it.
  const res = await a.get(`/api/profile/export/${ready.id}`);
  profileTransferFiles(a.root).sweep();
  expect(readdirSync(transfers)).toEqual([ready.id]);
  expect((await res.arrayBuffer()).byteLength).toBe(ready.bytes);
  expect(readdirSync(transfers)).toEqual([]);
});

test("a profile moved into place but not made (its row failed): moved back, nothing left", async () => {
  const { bytes } = await exported(await studied());
  const failing = await setup({
    transfers: (root): TransferFiles => {
      const real = profileTransferFiles(root);
      return {
        ...real,
        adopt: (id, profileId) =>
          real.adopt(id, profileId, () => {
            throw new Error("the server database is locked");
          }),
      };
    },
  });
  const error = console.error;
  console.error = () => {};
  try {
    expect((await importInto(failing, bytes)).status).toBe(500);
  } finally {
    console.error = error;
  }
  await nothingLeft(failing);
});

test("importing needs registration open, a file within the limit; downloading, the export's own profile", async () => {
  const a = await studied();
  const { bytes } = await exported(a);
  const b = await setup();
  await b.sendJson("POST", "/api/profiles", { name: "Other" });
  const { profileAdmin } = await import("../src/index.ts");
  profileAdmin(b.root).setRegistration(false);
  // Refused before a byte of it is read, its length told or not.
  const send = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
    b.app.request("/api/profiles/import", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", ...CLIENT_HEADERS, ...headers },
      body,
    });
  const unasked = watched(bytes);
  const closed = await send(unasked.body);
  expect([closed.status, await read(closed)]).toEqual([403, { error: "registration_closed" }]);
  expect(unasked.seen.read).toBe(false);
  profileAdmin(b.root).setRegistration(true);
  // Sent in chunks without its length: never held to be counted, refused at once.
  for (const headers of [{}, { "transfer-encoding": "chunked", "content-length": "10" }] as Array<
    Record<string, string>
  >) {
    const chunked = watched(bytes);
    const res = await send(chunked.body, headers);
    expect([res.status, await read(res)]).toEqual([411, { error: "length_required" }]);
    expect(chunked.seen.read).toBe(false);
  }
  const large = watched(bytes);
  const tooLarge = await send(large.body, { "content-length": "5000000000" });
  expect([tooLarge.status, await read(tooLarge)]).toEqual([
    413,
    { error: "profile_file_too_large" },
  ]);
  expect(large.seen.read).toBe(false);
  // More than it announced: refused once past it.
  const longer = await send(watched(bytes).body, { "content-length": String(bytes.length - 1) });
  expect([longer.status, await read(longer)]).toEqual([413, { error: "profile_file_too_large" }]);
  await expect(read(importInto(b, bytes))).resolves.toMatchObject({
    profile: { name: "Test (2)" },
  });
  // A prepared export is downloaded only by its profile, and needs a session.
  const ready = await read(a.send("POST", "/api/profile/export", {}));
  expect((await a.anonymous("GET", `/api/profile/export/${ready.id}`)).status).toBe(401);
  expect((await a.get(`/api/profile/export/${ulid().toLowerCase()}`)).status).toBe(400);
  expect((await a.get(`/api/profile/export/${crypto.randomUUID()}`)).status).toBe(404);
});
