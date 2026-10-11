// A profile moved as a file (05, "Profile file"): exported from one data root and imported into
// another — its runs, events, cards, settings and recordings as they were, its API keys left out —,
// and every file that is not one refused with nothing left behind.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** A file imported into a data root from a device signed in to nothing. */
const importInto = (api: Awaited<ReturnType<typeof setup>>, body: Uint8Array) =>
  api.app.request("/api/profiles/import", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", ...CLIENT_HEADERS },
    body,
  });

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
  expect(ready.leftOut).toEqual({ apiKeys: ["openrouter"] });
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
    leftOut: { apiKeys: ["openrouter"] },
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
  expect(result.leftOut).toEqual({ apiKeys: ["openrouter"] });
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
  const full = (root: string) => profileTransferFiles(root, { free: () => 1000 });
  const a = await studied();
  const { bytes } = await exported(a);
  const tight = await setup({ transfers: full });
  const refused = await tight.send("POST", "/api/profile/export", {});
  expect([refused.status, await read(refused)]).toEqual([507, { error: "not_enough_space" }]);
  expect(readdirSync(join(tight.root, "profiles", ".transfers"))).toEqual([]);
  // Announced too large for the disk before it is received.
  const res = await importInto(tight, bytes);
  expect([res.status, await read(res)]).toEqual([507, { error: "not_enough_space" }]);
  await nothingLeft(tight);

  // The disk filling up while the file is unpacked.
  const filling = await setup({
    transfers: (root): TransferFiles => {
      const real = profileTransferFiles(root);
      return {
        ...real,
        async unpack(id, file) {
          await real.unpack(id, file);
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

test("importing needs registration open, a file within the limit; downloading, the export's own profile", async () => {
  const a = await studied();
  const { bytes } = await exported(a);
  const b = await setup();
  await b.sendJson("POST", "/api/profiles", { name: "Other" });
  const { profileAdmin } = await import("../src/index.ts");
  profileAdmin(b.root).setRegistration(false);
  const closed = await importInto(b, bytes);
  expect([closed.status, await read(closed)]).toEqual([403, { error: "registration_closed" }]);
  profileAdmin(b.root).setRegistration(true);
  const large = await b.app.request("/api/profiles/import", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": "5000000000",
      ...CLIENT_HEADERS,
    },
    body: bytes,
  });
  expect([large.status, await read(large)]).toEqual([413, { error: "profile_file_too_large" }]);
  // A prepared export is downloaded only by its profile, and needs a session.
  const ready = await read(a.send("POST", "/api/profile/export", {}));
  expect((await a.anonymous("GET", `/api/profile/export/${ready.id}`)).status).toBe(401);
  expect((await a.get(`/api/profile/export/${ulid().toLowerCase()}`)).status).toBe(400);
  expect((await a.get(`/api/profile/export/${crypto.randomUUID()}`)).status).toBe(404);
});
