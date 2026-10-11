import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { ApkgError, readApkg } from "../src/apkg.ts";
import { fieldText, lexemeOf, noteWords } from "../src/words.ts";
import { buildApkg, bunApkgRuntime } from "./apkg.ts";

const lexeme = (...args: Parameters<typeof lexemeOf>): string | undefined =>
  lexemeOf(...args)?.lexeme;

const SOUND = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);

const spec = {
  deck: "Deutsch::A1",
  model: "Vokabel (de–ru)",
  fields: ["Wort", "Plural", "Übersetzung", "Wortart"],
  notes: [
    {
      guid: "a1!x",
      fields: ["der Abend [sound:abend.mp3]", "die Abende", "вечер", "Nomen"],
      tags: ["thema::zeit"],
    },
    { guid: "b2#y", fields: ["antworten", "", "отвечать<br>давать ответ", "Verb"] },
  ],
  media: { "abend.mp3": SOUND },
};

describe.each(["anki2", "anki21b"] as const)("a package in the %s format", (format) => {
  test("its notes with their note type's fields, its deck, its media by name", () => {
    const apkg = readApkg(buildApkg({ ...spec, format }), bunApkgRuntime);
    expect(apkg.deckName).toBe("Deutsch / A1");
    expect(apkg.notes).toEqual([
      {
        guid: "a1!x",
        model: "Vokabel (de–ru)",
        fieldNames: spec.fields,
        fields: spec.notes[0]?.fields as string[],
        tags: ["thema::zeit"],
      },
      {
        guid: "b2#y",
        model: "Vokabel (de–ru)",
        fieldNames: spec.fields,
        fields: spec.notes[1]?.fields as string[],
        tags: [],
      },
    ]);
    expect(apkg.media("abend.mp3")).toEqual(SOUND);
    expect(apkg.media("other.mp3")).toBeUndefined();
  });
});

test("a file that is no deck package says so", () => {
  expect(() => readApkg(strToU8("hello"), bunApkgRuntime)).toThrow(ApkgError);
  expect(() => readApkg(zipSync({ "a.txt": strToU8("x") }), bunApkgRuntime)).toThrow(
    "no collection",
  );
  expect(() =>
    readApkg(zipSync({ "collection.anki2": strToU8("not sqlite") }), bunApkgRuntime),
  ).toThrow(ApkgError);
});

test("fields by their names: word, translation, plural, part of speech; HTML as text; the sound", () => {
  const apkg = readApkg(buildApkg(spec), bunApkgRuntime);
  expect(noteWords(apkg.notes)).toEqual([
    {
      key: "a1!x",
      target: "der Abend",
      translation: "вечер",
      plural: "die Abende",
      pos: "Nomen",
      tags: ["thema::zeit"],
      sound: "abend.mp3",
    },
    {
      key: "b2#y",
      target: "antworten",
      translation: "отвечать; давать ответ",
      pos: "Verb",
      tags: [],
    },
  ]);
});

test("unknown field names: the first is the word, the second its translation; a language's name too", () => {
  const note = (fieldNames: string[], fields: string[]) => ({
    guid: "g",
    model: "",
    fieldNames,
    fields,
    tags: [],
  });
  expect(noteWords([note(["Vorne", "Hinten", "Extra"], ["Haus", "дом", "x"])])[0]).toMatchObject({
    target: "Haus",
    translation: "дом",
  });
  expect(
    noteWords([note(["Thema", "Русский", "Deutsch"], ["t", "дом", "das Haus"])])[0],
  ).toMatchObject({
    target: "дом",
    translation: "das Haus",
  });
  expect(noteWords([note(["Back", "Front"], ["house", "das Haus"])])[0]).toMatchObject({
    target: "das Haus",
    translation: "house",
  });
  // A note whose word field holds only a picture has no word.
  expect(noteWords([note(["Front", "Back"], ['<img src="a.jpg">', "x"])])).toEqual([]);
});

test("a field's text: tags, breaks, entities, sounds", () => {
  expect(
    fieldText("<div>der&nbsp;Tisch</div><div>&lt;m&gt; &#228;&#x00FC;</div>[sound:t.mp3]"),
  ).toBe("der Tisch; <m> äü");
  expect(fieldText("<b>gehen</b>, ging")).toBe("gehen, ging");
});

test("lexemes as the courses make them: German nouns by their article, the deck's part of speech", () => {
  expect(lexemeOf({ target: "der Abend", plural: "die Abende", pos: "Nomen" }, "de")).toEqual({
    lexeme: "lex:de:abend:noun:m",
    gender: "m",
    plural: "die Abende",
  } as never);
  expect(lexemeOf({ target: "der Kaffee, die Kaffees" }, "de")).toEqual({
    lexeme: "lex:de:kaffee:noun:m",
    gender: "m",
    plural: "die Kaffees",
  } as never);
  expect(lexemeOf({ target: "die Leute", plural: "nur Plural", pos: "Nomen" }, "de")).toEqual({
    lexeme: "lex:de:leute:noun:pl",
    gender: "pl",
  } as never);
  expect(lexemeOf({ target: "das Alter", plural: "-" }, "de")?.plural).toBeUndefined();
  expect(lexeme({ target: "bestellen", pos: "Verb" }, "de")).toBe("lex:de:bestellen:verb");
  expect(lexeme({ target: "(sich) freuen", pos: "Verb" }, "de")).toBe("lex:de:freuen:verb");
  expect(lexeme({ target: "gern", pos: "Adverb" }, "de")).toBe("lex:de:gern:word");
  expect(lexeme({ target: "Guten Tag.", pos: "Ausdruck" }, "de")).toBe("lex:de:guten-tag:phrase");
  // An article's word stated as no noun keeps it; English has no German articles.
  expect(lexeme({ target: "das heißt", pos: "Ausdruck" }, "de")).toBe("lex:de:das-heißt:word");
  expect(lexeme({ target: "die Zähne putzen", pos: "Verb" }, "de")).toBe(
    "lex:de:die-zähne-putzen:phrase",
  );
  expect(lexeme({ target: "to go" }, "en")).toBe("lex:en:go:verb");
  expect(lexemeOf({ target: "…" }, "de")).toBeUndefined();
});
