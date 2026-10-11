// Synthetic .apkg files for tests (never a third-party deck): a collection made with bun:sqlite in
// Anki's older schema (`collection.anki2`, a JSON media list) or its newest (`collection.anki21b` and
// the media zstd-compressed, the list a protobuf); and the Bun runtime that reads them.
import { Database } from "bun:sqlite";
import { strToU8, zipSync } from "fflate";
import type { ApkgRuntime } from "../src/apkg.ts";

export interface ApkgSpec {
  deck: string;
  model?: string;
  fields: string[];
  notes: Array<{ guid: string; fields: string[]; tags?: string[] }>;
  /** Media files by name. */
  media?: Record<string, Uint8Array>;
  format?: "anki2" | "anki21b";
}

export const bunApkgRuntime: ApkgRuntime = {
  openSqlite(bytes) {
    const db = Database.deserialize(bytes, { readonly: true });
    return { all: (sql) => db.query(sql).all() as Array<Record<string, unknown>> };
  },
  zstd: (bytes) => new Uint8Array(Bun.zstdDecompressSync(bytes)),
};

const MODEL_ID = 1700000000001;
const DECK_ID = 1700000000002;

export function buildApkg(spec: ApkgSpec): Uint8Array {
  const latest = spec.format === "anki21b";
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE col (id INTEGER PRIMARY KEY, models TEXT, decks TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, flds TEXT, tags TEXT);
    CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER);`);
  const model = spec.model ?? "Basic";
  if (latest) {
    db.exec(`CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT);
      CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT);`);
    db.run("INSERT INTO col (id, models, decks) VALUES (1, '', '')");
    db.run("INSERT INTO notetypes VALUES (?, ?)", [MODEL_ID, model]);
    spec.fields.forEach((name, ord) => {
      db.run("INSERT INTO fields VALUES (?, ?, ?)", [MODEL_ID, ord, name]);
    });
    db.run("INSERT INTO decks VALUES (1, 'Default'), (?, ?)", [
      DECK_ID,
      spec.deck.split("::").join("\x1f"),
    ]);
  } else {
    const models = {
      [MODEL_ID]: { name: model, flds: spec.fields.map((name, ord) => ({ name, ord })) },
    };
    const decks = { 1: { name: "Default" }, [DECK_ID]: { name: spec.deck } };
    db.run("INSERT INTO col VALUES (1, ?, ?)", [JSON.stringify(models), JSON.stringify(decks)]);
  }
  spec.notes.forEach((note, i) => {
    db.run("INSERT INTO notes VALUES (?, ?, ?, ?, ?)", [
      i + 1,
      note.guid,
      MODEL_ID,
      note.fields.join("\x1f"),
      ` ${(note.tags ?? []).join(" ")} `,
    ]);
    db.run("INSERT INTO cards VALUES (?, ?, ?)", [i + 1, i + 1, DECK_ID]);
  });
  const collection = new Uint8Array(db.serialize());
  db.close();
  const names = Object.keys(spec.media ?? {});
  const files: Record<string, Uint8Array> = {};
  names.forEach((name, i) => {
    const bytes = spec.media?.[name] as Uint8Array;
    files[String(i)] = latest ? Bun.zstdCompressSync(bytes) : bytes;
  });
  if (latest) {
    files["collection.anki21b"] = Bun.zstdCompressSync(collection);
    // The older clients' placeholder, as Anki writes it beside the real collection.
    files["collection.anki2"] = new Uint8Array(0);
    files.media = Bun.zstdCompressSync(mediaEntries(names));
  } else {
    files["collection.anki2"] = collection;
    files.media = strToU8(JSON.stringify(Object.fromEntries(names.map((n, i) => [i, n]))));
  }
  return zipSync(files);
}

/** protobuf `MediaEntries { repeated MediaEntry entries = 1 }`, each `{ string name = 1 }`. */
function mediaEntries(names: string[]): Uint8Array {
  const out: number[] = [];
  const length = (n: number) => {
    for (; n > 0x7f; n >>>= 7) out.push((n & 0x7f) | 0x80);
    out.push(n);
  };
  for (const name of names) {
    const bytes = strToU8(name);
    out.push(0x0a);
    length(bytes.length + 1 + lengthSize(bytes.length));
    out.push(0x0a);
    length(bytes.length);
    out.push(...bytes);
  }
  return new Uint8Array(out);
}
const lengthSize = (n: number) => (n < 0x80 ? 1 : n < 0x4000 ? 2 : 3);
