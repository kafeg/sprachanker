import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { ApkgError, readApkg } from "../src/apkg.ts";
import { fieldLanguages, fieldText } from "../src/fields.ts";
import { lexemeOf, noteWords, posOf } from "../src/words.ts";
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
    expect(apkg.media(["abend.mp3", "other.mp3"])).toEqual(new Map([["abend.mp3", SOUND]]));
    expect(apkg.media([]).size).toBe(0);
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
  // Chosen languages pick their fields.
  expect(
    noteWords([note(["Thema", "Русский", "Deutsch"], ["t", "дом", "das Haus"])], {
      lang: "de",
      translationLang: "ru",
    })[0],
  ).toMatchObject({ target: "das Haus", translation: "дом" });
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
  // No part of speech stated: an article before more than one word, or a sentence, is no noun.
  expect(lexeme({ target: "die Zähne putzen" }, "de")).toBe("lex:de:die-zähne-putzen:phrase");
  expect(lexeme({ target: "Das ist mein Bruder." }, "de")).toBe(
    "lex:de:das-ist-mein-bruder:phrase",
  );
  expect(lexeme({ target: "der Rock 'n' Roll", pos: "Nomen" }, "de")).toBe(
    "lex:de:rock-n-roll:noun:m",
  );
  expect(lexeme({ target: "to go" }, "en")).toBe("lex:en:go:verb");
  expect(lexemeOf({ target: "…" }, "de")).toBeUndefined();
});

test("fields named by language: the word, its translation in the language chosen, its audio, the deck's examples", () => {
  const fieldNames = [
    "id",
    "part_of_speech",
    "german",
    "sentence_1_german",
    "sentence_2_german",
    "audio_german",
    "audio_sentence_1_german",
    "audio_sentence_2_german",
    "english",
    "sentence_1_english",
    "sentence_2_english",
    "russian",
    "sentence_1_russian",
    "sentence_2_russian",
  ];
  const note = {
    guid: "z",
    model: "Core",
    fieldNames,
    fields: [
      "7",
      "nf",
      "die Zeit",
      "Ich habe Zeit.",
      "",
      "[sound:die-zeit.mp3]",
      "[sound:ich-habe-zeit.mp3]",
      "",
      "time",
      "I have time.",
      "",
      "время",
      "У меня есть время.",
      "",
    ],
    tags: [],
  };
  expect(fieldLanguages(fieldNames)).toEqual(["de", "en", "ru"]);
  expect(noteWords([note], { lang: "de", translationLang: "ru" })).toEqual([
    {
      key: "z",
      target: "die Zeit",
      translation: "время",
      pos: "nf",
      tags: [],
      sound: "die-zeit.mp3",
      examples: [
        {
          sentence: "Ich habe Zeit.",
          translation: "У меня есть время.",
          sound: "ich-habe-zeit.mp3",
        },
      ],
    },
  ]);
  // Languages not chosen yet (a preview): the first language's field is the word, the next its
  // translation; never the id.
  expect(noteWords([note])[0]).toMatchObject({ target: "die Zeit", translation: "time" });
});

test("parts of speech as decks write them: nouns' codes give gender, plural-only, either gender", () => {
  const codes = ["nf", "nm", "nn", "die (pl)", "(pl)", "der, die", "der; adj", "verb; aux"];
  expect([...codes, "adj; das", "adv", "Nomen"].map(posOf)).toEqual([
    { pos: "noun", gender: "f" },
    { pos: "noun", gender: "m" },
    { pos: "noun", gender: "n" },
    { pos: "noun", gender: "pl" },
    { pos: "noun", gender: "pl" },
    { pos: "noun" },
    { pos: "noun", gender: "m" },
    { pos: "verb" },
    { pos: "adj" },
    undefined,
    { pos: "noun" },
  ]);
  expect(lexeme({ target: "die Zeit", pos: "nf" }, "de")).toBe("lex:de:zeit:noun:f");
  expect(lexeme({ target: "Leute", pos: "die (pl)" }, "de")).toBe("lex:de:leute:noun:pl");
  expect(lexeme({ target: "Deutsche", pos: "der, die" }, "de")).toBe("lex:de:deutsche:noun");
  expect(lexeme({ target: "Abend", pos: "der; adv" }, "de")).toBe("lex:de:abend:noun:m");
  expect(lexeme({ target: "sein", pos: "verb; aux" }, "de")).toBe("lex:de:sein:verb");
  // After the comma a short form, not a plural.
  expect(lexemeOf({ target: "der Doktor, Dr.", pos: "nm" }, "de")).toEqual({
    lexeme: "lex:de:doktor:noun:m",
    gender: "m",
  } as never);
});
