// Reading an .apkg, Anki's deck package (04, "Decks"): a zip holding the collection — SQLite;
// `collection.anki21b` zstd-compressed in the newest format, else `collection.anki21` or
// `collection.anki2` — and the media, numbered files named by the `media` map (JSON, or in the newest
// format a zstd-compressed protobuf list, the files zstd-compressed too). SQLite and zstd are the
// runtime's, passed in: this package stays runtime-free.
import { strFromU8, unzipSync } from "fflate";

/** A database the runtime opened from bytes: rows of a query; closed once read. */
export interface SqliteReader {
  all(sql: string): Array<Record<string, unknown>>;
  close(): void;
}

export interface ApkgRuntime {
  openSqlite(bytes: Uint8Array): SqliteReader;
  zstd(bytes: Uint8Array): Uint8Array;
}

/** One note as the collection keeps it: its note type's name and fields by name, values as stored
 *  (HTML with `[sound:…]`). */
export interface AnkiNote {
  guid: string;
  model: string;
  fieldNames: string[];
  fields: string[];
  tags: string[];
}

export interface Apkg {
  /** The deck most of its cards are in (subdecks joined by " / "). */
  deckName: string | undefined;
  /** In the order they were made. */
  notes: AnkiNote[];
  /** Media files' bytes by the names notes use (`[sound:<name>]`), read when asked: a batch at a
   *  time, each read of the zip finding them all at once; names it does not hold are left out. */
  media(names: string[]): Map<string, Uint8Array>;
}

/** The file is no deck package Anki writes. */
export class ApkgError extends Error {}

const COLLECTIONS = ["collection.anki21b", "collection.anki21", "collection.anki2"];
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => ZSTD_MAGIC.every((m, i) => b[i] === m);

function unzip(bytes: Uint8Array, names: (name: string) => boolean) {
  try {
    return unzipSync(bytes, { filter: (f) => names(f.name) });
  } catch (error) {
    throw new ApkgError(`not a zip: ${String(error)}`);
  }
}

export function readApkg(bytes: Uint8Array, runtime: ApkgRuntime): Apkg {
  const files = unzip(bytes, (name) => COLLECTIONS.includes(name) || name === "media");
  const name = COLLECTIONS.find((n) => files[n]);
  if (!name) throw new ApkgError("no collection in the package");
  const latest = name === "collection.anki21b";
  const raw = files[name] as Uint8Array;
  let db: SqliteReader;
  try {
    db = runtime.openSqlite(rollbackJournal(latest ? runtime.zstd(raw) : raw));
  } catch (error) {
    throw new ApkgError(`the collection does not open: ${String(error)}`);
  }
  const byName = mediaNames(files.media, runtime);
  // Read whole at once: the database is let go before the package is used.
  let read: ReturnType<typeof collection>;
  try {
    read = collection(db);
  } finally {
    db.close();
  }
  return {
    ...read,
    media(names) {
      const wanted = new Map(
        names.flatMap((n) => {
          const entry = byName.get(n);
          return entry === undefined ? [] : [[entry, n] as const];
        }),
      );
      const out = new Map<string, Uint8Array>();
      if (!wanted.size) return out;
      for (const [entry, found] of Object.entries(unzip(bytes, (n) => wanted.has(n))))
        out.set(wanted.get(entry) as string, isZstd(found) ? runtime.zstd(found) : found);
      return out;
    },
  };
}

/** A database file marked for WAL (header bytes 18–19) as one with a rollback journal: SQLite opens
 *  a WAL database from memory only without its `-wal` file, which a package never holds. */
function rollbackJournal(db: Uint8Array) {
  if (db[18] !== 2 || db[19] !== 2) return db;
  const copy = db.slice();
  copy[18] = 1;
  copy[19] = 1;
  return copy;
}

/** Note types, decks and notes: in tables of their own in the newest schema, else in `col`'s JSON. */
function collection(db: SqliteReader): Omit<Apkg, "media"> {
  const models = new Map<string, { name: string; fields: string[] }>();
  const decks = new Map<string, string>();
  try {
    const tables = new Set(
      db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name)),
    );
    if (tables.has("notetypes")) {
      for (const t of db.all("SELECT id, name FROM notetypes"))
        models.set(String(t.id), { name: String(t.name), fields: [] });
      for (const f of db.all("SELECT ntid, name FROM fields ORDER BY ntid, ord"))
        models.get(String(f.ntid))?.fields.push(String(f.name));
      for (const d of db.all("SELECT id, name FROM decks"))
        decks.set(String(d.id), String(d.name).split("\x1f").join(" / "));
    } else {
      const col = db.all("SELECT models, decks FROM col")[0] ?? {};
      for (const [id, m] of Object.entries(JSON.parse(String(col.models)) as ModelJson))
        models.set(id, {
          name: m.name,
          fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
        });
      for (const [id, d] of Object.entries(JSON.parse(String(col.decks)) as DeckJson))
        decks.set(id, d.name.split("::").join(" / "));
    }
    const top = db.all("SELECT did, COUNT(*) AS n FROM cards GROUP BY did ORDER BY n DESC LIMIT 1");
    const notes = db.all("SELECT guid, mid, flds, tags FROM notes ORDER BY id").map((n) => {
      const model = models.get(String(n.mid));
      return {
        guid: String(n.guid),
        model: model?.name ?? "",
        fieldNames: model?.fields ?? [],
        fields: String(n.flds).split("\x1f"),
        tags: String(n.tags).split(" ").filter(Boolean),
      };
    });
    return { deckName: top[0] && decks.get(String(top[0].did)), notes };
  } catch (error) {
    throw new ApkgError(`the collection does not read: ${String(error)}`);
  }
}

type ModelJson = Record<string, { name: string; flds: Array<{ name: string; ord: number }> }>;
type DeckJson = Record<string, { name: string }>;

/** The media map: a name → the numbered file in the zip holding it. */
function mediaNames(file: Uint8Array | undefined, runtime: ApkgRuntime) {
  const out = new Map<string, string>();
  if (!file?.length) return out;
  if (isZstd(file)) {
    for (const [i, e] of mediaEntries(runtime.zstd(file)).entries())
      out.set(e.name, String(e.zip ?? i));
    return out;
  }
  try {
    for (const [n, name] of Object.entries(JSON.parse(strFromU8(file)) as Record<string, string>))
      out.set(name, n);
  } catch {
    throw new ApkgError("the media list does not read");
  }
  return out;
}

/** The newest format's media list (protobuf `MediaEntries`: entries = 1 { name = 1; size = 2;
 *  sha1 = 3; legacy_zip_filename = 255 }). */
function mediaEntries(bytes: Uint8Array): Array<{ name: string; zip?: number }> {
  const entries: Array<{ name: string; zip?: number }> = [];
  for (const [field, value] of protoFields(bytes)) {
    if (field !== 1 || !(value instanceof Uint8Array)) continue;
    const entry: { name: string; zip?: number } = { name: "" };
    for (const [f, v] of protoFields(value)) {
      if (f === 1 && v instanceof Uint8Array) entry.name = strFromU8(v);
      if (f === 255 && typeof v === "number") entry.zip = v;
    }
    entries.push(entry);
  }
  return entries;
}

/** A protobuf message's fields in order: varints as numbers, length-delimited ones as bytes. */
function* protoFields(bytes: Uint8Array): Generator<[number, number | Uint8Array]> {
  let at = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[at++];
      if (b === undefined) throw new ApkgError("the media list is cut short");
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return value;
      shift += 7;
    }
  };
  while (at < bytes.length) {
    const tag = varint();
    const wire = tag & 7;
    const field = Math.floor(tag / 8);
    if (wire === 0) yield [field, varint()];
    else if (wire === 2) {
      const length = varint();
      yield [field, bytes.subarray(at, at + length)];
      at += length;
    } else if (wire === 1) at += 8;
    else if (wire === 5) at += 4;
    else throw new ApkgError("the media list does not read");
  }
}
