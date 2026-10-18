// Writing an .apkg in Anki's legacy package format, which every Anki and AnkiDroid imports: the
// collection as `collection.anki2` (schema 11: note types, decks and their options as JSON in `col`),
// the `media` map (JSON: the zip's numbered files to their names). One note type — Front, Back, Audio,
// Example — and two cards a note: the word to its translation, the translation to the word; the audio
// on the side of the word. Cards are new: no scheduling is written. SQLite is the runtime's; the
// caller zips the entries (a deck's audio streamed from its files).
import { strToU8 } from "fflate";
import type { ApkgRuntime } from "./apkg.ts";

/** A word as a note: plain text (escaped here); its audio a name of the package's media. */
export interface ApkgNoteSpec {
  /** Anki's note id across exports (`noteGuid`): a package imported again updates the same note. */
  guid: string;
  /** The word as learnt ("der Abend"), and its plural when the word does not give it. */
  front: string;
  plural?: string;
  back: string;
  audio?: string;
  examples?: Array<{ sentence: string; translation?: string }>;
  tags?: string[];
}

export interface ApkgDeckSpec {
  /** The deck's name in Anki ("::" makes subdecks: not used, the name is one deck's). */
  name: string;
  /** Anki's id of the deck (`ankiId`): the same deck in every export. */
  deckId: number;
  notes: ApkgNoteSpec[];
  /** The media the notes name, in the order the zip holds them (entry `i` is `media[i]`). */
  media: string[];
  /** Epoch ms: the notes' and cards' times. */
  now: number;
}

/** The zip's entries before the media files, and the media in order (the zip's `0`, `1`, …). */
export interface ApkgWritten {
  head: Array<{ name: string; bytes: Uint8Array }>;
  media: string[];
}

/** The note type's id, the same in every export: a package imported again finds it. */
export const NOTE_TYPE_ID = 1760000000000;
export const NOTE_TYPE_NAME = "SprachAnker";
export const NOTE_FIELDS = ["Front", "Back", "Audio", "Example"] as const;

const CSS = `.card {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  font-size: 22px;
  line-height: 1.45;
  text-align: center;
  color: #1f2328;
  background-color: #ffffff;
  padding: 0.5em;
  overflow-wrap: anywhere;
}
.nightMode .card, .night_mode .card, .card.nightMode, .card.night_mode {
  color: #e6e6e6;
  background-color: #1f1f1f;
}
.word { font-size: 1.6em; font-weight: 600; }
.plural { font-size: 0.6em; font-weight: 400; opacity: 0.7; }
.translation { font-size: 1.25em; }
.example { margin: 1em auto 0; max-width: 32em; font-size: 0.8em; text-align: start; }
.example div + div { margin-top: 0.5em; }
.example i { display: block; }
.example span { opacity: 0.7; }
hr#answer { margin: 0.75em 0; opacity: 0.4; }
`;

const EXAMPLE = '{{#Example}}<div class="example">{{Example}}</div>{{/Example}}';
const WORD = '<div class="word">{{Front}}</div>\n{{Audio}}';
const TRANSLATION = '<div class="translation">{{Back}}</div>';
const TEMPLATES = [
  {
    name: "Word → translation",
    qfmt: WORD,
    afmt: `{{FrontSide}}\n\n<hr id=answer>\n\n${TRANSLATION}\n${EXAMPLE}`,
  },
  {
    name: "Translation → word",
    qfmt: `{{#Back}}${TRANSLATION}{{/Back}}`,
    afmt: `{{FrontSide}}\n\n<hr id=answer>\n\n${WORD}\n${EXAMPLE}`,
  },
];

const SCHEMA = [
  `CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL,
    scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL,
    ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL,
    dconf text NOT NULL, tags text NOT NULL)`,
  `CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL,
    mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL,
    sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL)`,
  `CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL,
    ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL,
    queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL,
    reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL,
    odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL)`,
  `CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL,
    ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL,
    time integer NOT NULL, type integer NOT NULL)`,
  "CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL)",
  "CREATE INDEX ix_notes_usn ON notes (usn)",
  "CREATE INDEX ix_cards_usn ON cards (usn)",
  "CREATE INDEX ix_revlog_usn ON revlog (usn)",
  "CREATE INDEX ix_cards_nid ON cards (nid)",
  "CREATE INDEX ix_cards_sched ON cards (did, queue, due)",
  "CREATE INDEX ix_revlog_cid ON revlog (cid)",
  "CREATE INDEX ix_notes_csum ON notes (csum)",
];

/** Anki's default deck options (the importer gives a deck these unless the learner's are there). */
const DECK_CONFIG = {
  id: 1,
  mod: 0,
  name: "Default",
  usn: 0,
  maxTaken: 60,
  autoplay: true,
  timer: 0,
  replayq: true,
  new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
  rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
  lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
  dyn: false,
};

const deckJson = (id: number, name: string, mod: number) => ({
  id,
  mod,
  name,
  usn: -1,
  lrnToday: [0, 0],
  revToday: [0, 0],
  newToday: [0, 0],
  timeToday: [0, 0],
  collapsed: false,
  browserCollapsed: false,
  desc: "",
  dyn: 0,
  conf: 1,
  extendNew: 0,
  extendRev: 0,
});

/** Text as a field's HTML: nothing in it read as markup — neither tags nor Anki's own (`[sound:…]`,
 *  `[latex]`) —, no field separator, its lines kept. */
const html = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "&#91;")
    .split("\x1f")
    .join("")
    .replace(/\r?\n/g, "<br>");

/** A note's fields as Anki keeps them (HTML). */
function fieldsOf(note: ApkgNoteSpec) {
  const plural =
    note.plural && !note.front.includes(note.plural)
      ? `<div class="plural">${html(note.plural)}</div>`
      : "";
  const examples = (note.examples ?? [])
    .map(
      (e) =>
        `<div><i>${html(e.sentence)}</i>${e.translation ? `<span>${html(e.translation)}</span>` : ""}</div>`,
    )
    .join("");
  return [
    `${html(note.front)}${plural}`,
    html(note.back),
    note.audio ? `[sound:${note.audio}]` : "",
    examples,
  ];
}

/** The package of a deck's notes: the collection and the media map — the media files themselves the
 *  caller's, after them in the zip. */
export function writeApkg(
  spec: ApkgDeckSpec,
  runtime: Pick<ApkgRuntime, "newSqlite">,
): ApkgWritten {
  const secs = Math.floor(spec.now / 1000);
  const db = runtime.newSqlite();
  try {
    for (const sql of SCHEMA) db.run(sql);
    const model = {
      id: NOTE_TYPE_ID,
      name: NOTE_TYPE_NAME,
      type: 0,
      mod: secs,
      usn: -1,
      sortf: 0,
      did: spec.deckId,
      tmpls: TEMPLATES.map((t, ord) => ({ ...t, ord, bqfmt: "", bafmt: "", did: null })),
      flds: NOTE_FIELDS.map((name, ord) => ({
        name,
        ord,
        sticky: false,
        rtl: false,
        font: "Arial",
        size: 20,
      })),
      css: CSS,
      latexPre:
        "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
      latexPost: "\\end{document}",
      latexsvg: false,
      req: [
        [0, "any", [0]],
        [1, "any", [1]],
      ],
      tags: [],
      vers: [],
    };
    const decks = {
      1: { ...deckJson(1, "Default", 0), usn: 0 },
      // One deck: "::" would make subdecks of its name.
      [spec.deckId]: deckJson(spec.deckId, spec.name.replaceAll("::", ":"), secs),
    };
    const conf = {
      nextPos: spec.notes.length + 1,
      estTimes: true,
      activeDecks: [1],
      sortType: "noteFld",
      timeLim: 0,
      sortBackwards: false,
      addToCur: true,
      curDeck: 1,
      newSpread: 0,
      dueCounts: true,
      curModel: NOTE_TYPE_ID,
      collapseTime: 1200,
      schedVer: 2,
    };
    db.run("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')", [
      secs,
      spec.now,
      spec.now,
      JSON.stringify(conf),
      JSON.stringify({ [NOTE_TYPE_ID]: model }),
      JSON.stringify(decks),
      JSON.stringify({ 1: DECK_CONFIG }),
    ]);
    // Ids are times in ms: one apart for each note and card, from the export's time.
    let id = spec.now;
    spec.notes.forEach((note, i) => {
      const fields = fieldsOf(note);
      // The word itself, as text (Anki works both out again as it imports a note).
      const sort = note.front.trim();
      const noteId = id++;
      db.run("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')", [
        noteId,
        note.guid,
        NOTE_TYPE_ID,
        secs,
        note.tags?.length ? ` ${note.tags.join(" ")} ` : "",
        fields.join("\x1f"),
        sort,
        checksum(sort),
      ]);
      // A card a template whose question is not empty (Anki's own rule: `req`).
      for (const ord of note.back ? [0, 1] : [0])
        db.run(
          "INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')",
          [id++, noteId, spec.deckId, ord, secs, i + 1],
        );
    });
    const collection = db.bytes();
    return {
      head: [
        { name: "collection.anki2", bytes: collection },
        {
          name: "media",
          bytes: strToU8(JSON.stringify(Object.fromEntries(spec.media.map((n, i) => [i, n])))),
        },
      ],
      media: spec.media,
    };
  } finally {
    db.close();
  }
}

/** Anki's checksum of a note's first field: its SHA-1's first 32 bits. */
const checksum = (text: string) => {
  const h = sha1(strToU8(text));
  return (
    (h[0] as number) * 2 ** 24 +
    ((h[1] as number) << 16) +
    ((h[2] as number) << 8) +
    (h[3] as number)
  );
};

const BASE91 =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";

/** A note's guid as Anki makes them (a 64-bit number in base 91), from what makes the note the same
 *  in every export (its deck and its word). */
export function noteGuid(seed: string) {
  let n = 0n;
  for (const b of sha1(strToU8(seed)).subarray(0, 8)) n = (n << 8n) | BigInt(b);
  let out = "";
  do {
    out = BASE91[Number(n % 91n)] + out;
    n /= 91n;
  } while (n > 0n);
  return out;
}

/** An id Anki takes for a deck, from what makes the deck the same in every export: 13 digits, as
 *  Anki's own (a time in ms). */
export function ankiId(seed: string) {
  const h = sha1(strToU8(seed));
  let n = 0;
  for (const b of h.subarray(0, 6)) n = n * 256 + b;
  return 1_000_000_000_000 + (n % 8_000_000_000_000);
}

/** SHA-1 (no runtime's crypto here: this package stays runtime-free). */
export function sha1(data: Uint8Array): Uint8Array {
  const length = data.length;
  const blocks = ((length + 8) >> 6) + 1;
  const words = new Uint32Array(blocks * 16);
  for (let i = 0; i < length; i++)
    words[i >> 2] = (words[i >> 2] as number) | ((data[i] as number) << (24 - (i % 4) * 8));
  words[length >> 2] = (words[length >> 2] as number) | (0x80 << (24 - (length % 4) * 8));
  words[blocks * 16 - 1] = length * 8;
  words[blocks * 16 - 2] = Math.floor((length * 8) / 2 ** 32);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  for (let b = 0; b < blocks; b++) {
    for (let t = 0; t < 16; t++) w[t] = words[b * 16 + t] as number;
    for (let t = 16; t < 80; t++) {
      const x =
        (w[t - 3] as number) ^ (w[t - 8] as number) ^ (w[t - 14] as number) ^ (w[t - 16] as number);
      w[t] = (x << 1) | (x >>> 31);
    }
    let [a, bb, c, d, e] = h as [number, number, number, number, number];
    for (let t = 0; t < 80; t++) {
      const f =
        t < 20
          ? ((bb & c) | (~bb & d)) + 0x5a827999
          : t < 40
            ? (bb ^ c ^ d) + 0x6ed9eba1
            : t < 60
              ? ((bb & c) | (bb & d) | (c & d)) + 0x8f1bbcdc
              : (bb ^ c ^ d) + 0xca62c1d6;
      const tmp = (((a << 5) | (a >>> 27)) + f + e + (w[t] as number)) >>> 0;
      e = d;
      d = c;
      c = (bb << 30) | (bb >>> 2);
      bb = a;
      a = tmp;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + bb) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const view = new DataView(out.buffer);
  h.forEach((v, i) => {
    view.setUint32(i * 4, v);
  });
  return out;
}
