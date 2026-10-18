// A package written and read back by our own reader: its deck, its notes with their fields, the
// media map and the files the zip holds by it; Anki's own collection opened as SQLite (the note type,
// the deck, two new cards a note, one without a translation only its first).
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { unzipSync, zipSync } from "fflate";
import { readApkg } from "../src/apkg.ts";
import { ankiId, NOTE_FIELDS, noteGuid, sha1, writeApkg } from "../src/write.ts";
import { bunApkgRuntime } from "./apkg.ts";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);
const WAV = enc("RIFF....WAVE");

const spec = {
  name: "Deutsch A1 — Wortschatz",
  deckId: ankiId("deck:deutsch-a1"),
  now: 1_760_000_000_000,
  media: ["sa-1.wav"],
  notes: [
    {
      guid: noteGuid("deutsch-a1 ru k1"),
      front: "der Abend",
      plural: "die Abende",
      back: "вечер",
      audio: "sa-1.wav",
      examples: [
        { sentence: "Guten Abend!", translation: "Добрый вечер!" },
        { sentence: "<b>[sound:x.mp3]\x1f\nzwei" },
      ],
      tags: ["thema::zeit"],
    },
    { guid: noteGuid("deutsch-a1 ru k2"), front: "Tschüss", back: "" },
  ],
};

/** The package as the caller zips it: its head, then each media file under its number. */
const zipped = () => {
  const written = writeApkg(spec, bunApkgRuntime);
  const files: Record<string, Uint8Array> = {};
  for (const e of written.head) files[e.name] = e.bytes;
  written.media.forEach((_, i) => {
    files[String(i)] = WAV;
  });
  return zipSync(files);
};

test("SHA-1, Anki's checksum and ids: as Anki makes them, the same each time", () => {
  expect(hex(sha1(enc("abc")))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  expect(hex(sha1(enc("")))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  expect(hex(sha1(new Uint8Array(1000).fill(0x61)))).toBe(
    "291e9a6c66994949b57ba5e650361e98fc36b1ba",
  );
  expect(noteGuid("a")).toBe(noteGuid("a"));
  expect(noteGuid("a")).not.toBe(noteGuid("b"));
  expect(ankiId("x")).toBeGreaterThanOrEqual(1e12);
  expect(ankiId("x")).toBeLessThan(2 ** 53);
  expect(String(ankiId("x"))).toHaveLength(13);
});

test("read back by our reader: the deck, the notes' fields, the media by name", () => {
  const apkg = readApkg(zipped(), bunApkgRuntime);
  expect(apkg.deckName).toBe(spec.name);
  expect(apkg.notes.map((n) => n.guid)).toEqual(spec.notes.map((n) => n.guid));
  const [abend, tschuss] = apkg.notes;
  expect(abend?.model).toBe("SprachAnker");
  expect(abend?.fieldNames).toEqual([...NOTE_FIELDS]);
  expect(abend?.fields).toEqual([
    'der Abend<div class="plural">die Abende</div>',
    "вечер",
    "[sound:sa-1.wav]",
    "<div><i>Guten Abend!</i><span>Добрый вечер!</span></div><div><i>&lt;b&gt;&#91;sound:x.mp3]<br>zwei</i></div>",
  ]);
  expect(abend?.tags).toEqual(["thema::zeit"]);
  expect(tschuss?.fields).toEqual(["Tschüss", "", "", ""]);
  expect(apkg.media(["sa-1.wav"]).get("sa-1.wav")).toEqual(WAV);
});

test("the collection: schema 11, the deck and note type, new cards — none for an empty side", () => {
  const files = unzipSync(zipped());
  expect(Object.keys(files).sort()).toEqual(["0", "collection.anki2", "media"]);
  expect(JSON.parse(new TextDecoder().decode(files.media))).toEqual({ 0: "sa-1.wav" });
  const db = Database.deserialize(files["collection.anki2"] as Uint8Array, { readonly: true });
  const col = db.query("SELECT ver, models, decks, dconf FROM col").get() as {
    ver: number;
    models: string;
    decks: string;
    dconf: string;
  };
  expect(col.ver).toBe(11);
  const model = Object.values(JSON.parse(col.models))[0] as {
    tmpls: Array<{ qfmt: string; afmt: string }>;
    did: number;
  };
  expect(model.did).toBe(spec.deckId);
  expect(model.tmpls[0]?.qfmt).toContain("{{Audio}}");
  expect(model.tmpls[1]?.qfmt).not.toContain("{{Audio}}");
  expect(model.tmpls[1]?.afmt).toContain("{{Audio}}");
  expect(JSON.parse(col.decks)[spec.deckId].name).toBe(spec.name);
  expect(JSON.parse(col.dconf)[1].new.perDay).toBe(20);
  const cards = db
    .query("SELECT nid, did, ord, type, queue, due, ivl, reps FROM cards ORDER BY id")
    .all();
  const notes = db.query("SELECT id, sfld, csum FROM notes ORDER BY id").all() as Array<{
    id: number;
    sfld: string;
    csum: number;
  }>;
  const [first, second] = notes;
  expect(cards).toEqual([
    { nid: first?.id, did: spec.deckId, ord: 0, type: 0, queue: 0, due: 1, ivl: 0, reps: 0 },
    { nid: first?.id, did: spec.deckId, ord: 1, type: 0, queue: 0, due: 1, ivl: 0, reps: 0 },
    { nid: second?.id, did: spec.deckId, ord: 0, type: 0, queue: 0, due: 2, ivl: 0, reps: 0 },
  ]);
  // Anki's checksum of "Tschüss" (the first 32 bits of its SHA-1).
  expect(second?.sfld).toBe("Tschüss");
  expect(second?.csum).toBe(Number.parseInt(hex(sha1(enc("Tschüss"))).slice(0, 8), 16));
  db.close();
});

test("a name with Anki's subdeck mark stays one deck", () => {
  const written = writeApkg({ ...spec, name: "Deutsch::A1" }, bunApkgRuntime);
  const files: Record<string, Uint8Array> = { 0: WAV };
  for (const e of written.head) files[e.name] = e.bytes;
  expect(readApkg(zipSync(files), bunApkgRuntime).deckName).toBe("Deutsch:A1");
});
