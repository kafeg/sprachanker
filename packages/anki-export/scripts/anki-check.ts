// A package written here imported by Anki's own library (Python, not in CI): a synthetic deck — a
// word with audio, plural and examples, one without a translation — into an empty collection, then
// written again and imported over it (its notes updated, none added). Run:
//   python3 -m venv <venv> && <venv>/bin/pip install anki==26.5
//   ANKI_PYTHON=<venv>/bin/python bun packages/anki-export/scripts/anki-check.ts
// With a package's path it only imports that one and prints what Anki made of it.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { ankiId, noteGuid, writeApkg } from "../src/write.ts";
import { bunApkgRuntime } from "../test/apkg.ts";

const python = process.env.ANKI_PYTHON ?? "python3";
const importer = join(import.meta.dir, "anki_import.py");

type Imported = {
  decks: string[];
  noteTypes: string[];
  notes: Array<{ guid: string; type: string; fields: Record<string, string> }>;
  cards: Array<{ deck: string; ord: number; type: number; queue: number; question: string }>;
  media: Record<string, number>;
  missingSounds: string[];
};

function imported(apkg: string, folder: string): Imported {
  const run = Bun.spawnSync([python, "-I", importer, apkg, folder]);
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return JSON.parse(run.stdout.toString());
}

const given = process.argv[2];
if (given) {
  const out = imported(given, mkdtempSync(join(tmpdir(), "anki-")));
  console.log(
    JSON.stringify(
      {
        decks: out.decks,
        noteTypes: out.noteTypes,
        notes: out.notes.length,
        cards: out.cards.length,
        newCards: out.cards.filter((c) => c.type === 0 && c.queue === 0).length,
        media: Object.keys(out.media).length,
        missingSounds: out.missingSounds,
        first: out.notes[0],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const fail = (what: string) => {
  console.error(`FAILED: ${what}`);
  process.exit(1);
};
const check = (ok: boolean, what: string) => (ok ? console.log(`ok: ${what}`) : fail(what));

/** A tiny WAV of silence (Anki keeps media as they are). */
const wav = (ms: number) => {
  const samples = Math.round(16 * ms);
  const b = new Uint8Array(44 + samples * 2);
  const v = new DataView(b.buffer);
  const str = (at: number, s: string) =>
    [...s].forEach((c, i) => {
      v.setUint8(at + i, c.charCodeAt(0));
    });
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  return b;
};

function write(dir: string, file: string, back: string, now: number) {
  const spec = {
    name: "SprachAnker check",
    deckId: ankiId("deck:check"),
    now,
    media: ["sprachanker-check-1.wav", "sprachanker-check-2.wav"],
    notes: [
      {
        guid: noteGuid("check ru k1"),
        front: "der Abend",
        plural: "die Abende",
        back,
        audio: "sprachanker-check-1.wav",
        examples: [{ sentence: "Guten Abend!", translation: "Добрый вечер!" }],
      },
      {
        guid: noteGuid("check ru k2"),
        front: "sich freuen",
        back: "радоваться",
        audio: "sprachanker-check-2.wav",
      },
      { guid: noteGuid("check ru k3"), front: "Tschüss", back: "" },
    ],
  };
  const written = writeApkg(spec, bunApkgRuntime);
  const files: Record<string, Uint8Array> = {};
  for (const e of written.head) files[e.name] = e.bytes;
  written.media.forEach((_, i) => {
    files[String(i)] = wav(400 + 100 * i);
  });
  const path = join(dir, file);
  writeFileSync(path, zipSync(files));
  return path;
}

const dir = mkdtempSync(join(tmpdir(), "anki-check-"));
const col = join(dir, "anki");
const first = imported(write(dir, "first.apkg", "вечер", Date.now() - 60_000), col);
check(first.decks.includes("SprachAnker check"), "the deck, named as the deck");
check(first.noteTypes.includes("SprachAnker"), "the note type");
check(first.notes.length === 3, "3 notes");
check(first.cards.length === 5, "5 cards: two a note, one for the note without a translation");
check(
  first.cards.every((c) => c.type === 0 && c.queue === 0 && c.deck === "SprachAnker check"),
  "every card new, in the deck",
);
check(
  Object.keys(first.media).length === 2 && !first.missingSounds.length,
  "2 media files, every sound there",
);
const abend = first.notes.find((n) => n.fields.Front?.startsWith("der Abend"));
check(abend?.fields.Audio === "[sound:sprachanker-check-1.wav]", "the audio field");
check(!!abend?.fields.Example?.includes("Guten Abend!"), "the example field");
const reverse = first.cards.find((c) => c.ord === 1 && c.question.includes("вечер"));
check(
  !!reverse && !reverse.question.includes("[sound:") && !reverse.question.includes("anki:play"),
  "the reverse card's question without the audio",
);
const forward = first.cards.find((c) => c.ord === 0 && c.question.includes("der Abend"));
check(
  !!forward && /anki:play|\[sound:/.test(forward.question),
  "the word's question plays its audio",
);
// Again, its translation changed: the same notes updated.
const again = imported(write(dir, "again.apkg", "вечер (время суток)", Date.now()), col);
check(
  again.notes.length === 3 && again.cards.length === 5,
  "imported again: no note nor card added",
);
check(
  again.notes.some((n) => n.fields.Back === "вечер (время суток)"),
  "imported again: the note updated",
);
console.log(`Anki imported both packages (${dir})`);
