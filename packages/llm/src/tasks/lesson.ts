// The lesson as the tasks see it — with what the learner knows by now (07, the knowledge snapshot) —
// and the lines of it that go into their prompts. One place, so every task shows the lesson the same
// way.
import { clip, htmlToText, newest } from "../text.ts";

/** A word as the tasks see it: headword and translation. */
export interface LessonWord {
  target: string;
  translation?: string;
}

/** What the tasks know of a lesson (the server's lesson context fills it). */
export interface LessonInfo {
  title: string;
  /** In the learner's language, as the course states them. */
  goals: string[];
  /** Grammar pages of the lesson (course HTML). */
  grammarHtml: string[];
  /** Words of this lesson: headword and translation. */
  vocab: LessonWord[];
  /** The course's CEFR level ("A1", "A1–A2"); undefined when the course does not say. */
  level?: string;
  /** Where the lesson is: its number in course order, of how many, and its unit's title. */
  place?: { n: number; of: number; unit?: string };
  /** Words of the earlier lessons with translations, in course order (the latest kept). */
  knownWords?: LessonWord[];
  /** Grammar topics met so far — the earlier lessons' and this one's —, in course order: a topic
   *  once in each lesson that taught it. */
  topics?: TopicMet[];
  /** The course's people met so far, by name (its scripts' speakers): a person made up for a task
   *  is none of them. */
  characters?: string[];
  /** The lesson's own script (its dialogue or text; course HTML): the course's level and style. */
  scriptHtml?: string;
  /** Grammar topics of the lessons after this one, in course order: what the learner has not met. */
  upcoming?: string[];
}

/** A grammar topic (a grammar page's title) and a lesson that taught it: the lesson as the app names
 *  it ("1.2") and its title. */
export interface TopicMet {
  title: string;
  lesson: string;
  lessonTitle?: string;
}

/** The level as the prompts say it: the course's, else a beginner's. */
export const levelText = (level: string | undefined) => level ?? "beginner (A1–A2)";

/** The level a task sizes its work by: the first of a span ("A1–A2" → A1), a beginner's (A1) when
 *  the course names none. */
export const cefrOf = (level: string | undefined) => /[ABC][12]/.exec(level ?? "")?.[0] ?? "A1";

export const levelLine = (lesson: Pick<LessonInfo, "level">) =>
  `Learner's level: ${levelText(lesson.level)}`;

/** "Lesson 12 of 40 (unit: Im Café)". */
export const placeLine = ({ place }: Pick<LessonInfo, "place">) =>
  place
    ? `Place in the course: lesson ${place.n} of ${place.of}${place.unit ? ` (unit: ${place.unit})` : ""}`
    : undefined;

/** "der Kaffee (coffee)". */
const wordWithTranslation = (v: LessonWord) =>
  v.translation ? `${v.target} (${v.translation})` : v.target;

export const goalsLine = (lesson: Pick<LessonInfo, "goals">) =>
  lesson.goals.length ? `Goals: ${lesson.goals.join("; ")}` : undefined;

/** The lesson's words with translations, within `max` characters. */
export const lessonWords = (lesson: Pick<LessonInfo, "vocab">, max: number) =>
  clip(lesson.vocab.map(wordWithTranslation).join("; "), max);

export const lessonWordsLine = (lesson: Pick<LessonInfo, "vocab">, max: number) =>
  lesson.vocab.length ? `Words of this lesson: ${lessonWords(lesson, max)}` : undefined;

/** Words of earlier lessons with translations (oldest first): the most recent within `max`
 *  characters. */
export const knownWordsLine = ({ knownWords = [] }: Pick<LessonInfo, "knownWords">, max: number) =>
  knownWords.length
    ? `Words from earlier lessons: ${newest(knownWords.map(wordWithTranslation), max, "; ")}`
    : undefined;

/** Each topic once with the lessons that taught it, the first first; the topics in the order last
 *  taught (the most recent last). */
function topicPlaces(topics: TopicMet[]) {
  const by = new Map<string, TopicMet[]>();
  for (const t of topics) {
    const places = by.get(t.title) ?? [];
    by.delete(t.title);
    by.set(t.title, [...places, t]);
  }
  return [...by.entries()];
}

/** The grammar topics met so far, each once (oldest first): the most recent within `max`
 *  characters. */
export const topicsLine = ({ topics = [] }: Pick<LessonInfo, "topics">, max: number) =>
  topics.length
    ? `Grammar met so far: ${newest(
        topicPlaces(topics).map(([title]) => title),
        max,
        "; ",
      )}`
    : undefined;

/** The grammar topics met so far with the lessons that taught each, the first first ("Modalverben —
 *  2.3 «Im Café», 4.1"; no word of English beside the numbers, which the model would copy into an
 *  explanation in another language): the most recent within `max` characters — the lessons' titles
 *  dropped before a topic or its first lesson is. */
export function topicPlacesLine({ topics = [] }: Pick<LessonInfo, "topics">, max: number) {
  if (!topics.length) return undefined;
  const entries = (titled: boolean) =>
    topicPlaces(topics).map(
      ([title, places]) =>
        `${title} — ${places
          .map((t) => `${t.lesson}${titled && t.lessonTitle ? ` «${t.lessonTitle}»` : ""}`)
          .join(", ")}`,
    );
  const full = entries(true);
  const fits = full.join("; ").length <= max;
  return `Grammar topics met so far, each with the lessons (unit.lesson «title») that taught it: ${
    fits ? full.join("; ") : newest(entries(false), max, "; ")
  }`;
}

/** A label at a line's start: a name or role of up to three words, the first and the last
 *  capitalised ("NICO", "Frau Berg", "MUTTER VON LOTTE"), and a colon. */
const LABEL = /^(\p{Lu}[\p{L}'’-]*(?: [\p{L}'’-]+)?(?: \p{Lu}[\p{L}'’-]*)?):\s*(.*)$/u;

/** Characters of no width a source leaves in its text ("​HAUKE:"). */
const INVISIBLE = /[​-‍⁠﻿]/g;

const SCRIPTS = ["Latin", "Cyrillic", "Greek", "Arabic", "Hebrew", "Devanagari", "Han"].map(
  (s) => new RegExp(`\\p{Script=${s}}`, "u"),
);
/** The writing system of a text's first letter (-1: none of those). */
const scriptOf = (text: string) => {
  const letter = /\p{L}/u.exec(text)?.[0] ?? "";
  return SCRIPTS.findIndex((s) => s.test(letter));
};

/** "LISA" → "Lisa", "ANNA-LENA" → "Anna-Lena", "MUTTER VON LOTTE" → "Mutter von Lotte". */
const titleCase = (label: string) =>
  label
    .toLocaleLowerCase()
    .split(" ")
    .map((word, i, all) =>
      i > 0 && i < all.length - 1
        ? word
        : word.replace(/(^|-)(\p{L})/gu, (_, a, b: string) => a + b.toLocaleUpperCase()),
    )
    .join(" ");

/** Labels that name no one, whatever the course teaches: a group, a voice, a narrator, a person by
 *  sex or age (data: the courses' languages). */
const ROLE_WORDS = new Set(
  [
    "alle beide stimme stimmen erzähler erzählerin sprecher sprecherin übung beispiel mann",
    "kind junge mädchen all both everyone voice voices narrator announcer speaker man woman boy girl",
    "child male female",
  ].flatMap((line) => line.split(" ")),
);

/** Words before a name that are no part of what makes it one ("Frau Weber"; "Frau" alone a role). */
const TITLES = new Set(["frau", "herr", "mr", "mrs", "ms", "miss", "dr"]);

/** People's names as their words, each once, a title before a name left out ("Frau Keller" →
 *  Keller): what a new text's people are not named. */
export const nameWords = (names: string[]) => [
  ...new Set(
    names.flatMap((n) =>
      n.split(/\s+/).filter((w) => w.length > 1 && !TITLES.has(w.toLowerCase().replace(/\.$/, ""))),
    ),
  ),
];

/** A text's words in lower case, two letters or more ("die Kellnerin, -nen" → die, kellnerin, nen). */
const wordsIn = (text: string) => text.toLocaleLowerCase().match(/\p{L}{2,}/gu) ?? [];

/** The people speaking in a script (course HTML), in the order they first speak, by name as written
 *  in a sentence ("LISA:" → "Lisa"): a label that comes at several lines' start, before what is said
 *  on its line or the next, in that line's writing system — never a heading or a sentence's opening
 *  word, which come once ("Am Bahnhof:", "Also: Hallo"), a letter alone ("A:"), or a heading in the
 *  learner's language ("Пример:"). A label with a common word in it is a role, no name ("Kellnerin",
 *  "Mutter von Lotte", "ALLE"): a word of `words` (the course's words met, as headwords with their
 *  articles: "die Kellnerin, die Kellnerinnen") or a role word of every course; a title before a
 *  name is none ("Frau Weber" a name, "Frau" a role). */
export function speakersOf(html: string, words: string[] = []): string[] {
  const common = new Set([...ROLE_WORDS, ...words.flatMap(wordsIn)]);
  const lines = htmlToText(html)
    .split("\n")
    .map((line) => line.replace(INVISIBLE, "").trim())
    .filter(Boolean);
  const times = new Map<string, number>();
  lines.forEach((line, i) => {
    const [, label = "", rest = ""] = LABEL.exec(line) ?? [];
    const said = rest || lines[i + 1] || "";
    if ([...label].length < 2 || scriptOf(label) !== scriptOf(said)) return;
    const name = label === label.toLocaleUpperCase() ? titleCase(label) : label;
    times.set(name, (times.get(name) ?? 0) + 1);
  });
  const named = (label: string) => {
    const words = label.split(" ");
    while (words.length && TITLES.has(words[0]?.toLocaleLowerCase().replace(/\.$/, "") ?? ""))
      words.shift();
    return words.length > 0 && !wordsIn(words.join(" ")).some((w) => common.has(w));
  };
  return [...times].flatMap(([name, n]) => (n > 1 && named(name) ? [name] : []));
}

/** "The course's characters: Nico, Lisa, Emma" — names a made-up person never takes. */
export const charactersLine = ({ characters = [] }: Pick<LessonInfo, "characters">) =>
  characters.length ? `The course's characters: ${characters.join(", ")}` : undefined;

/** The grammar topics still ahead in the course, each once, the nearest first, within `max`
 *  characters. */
export const upcomingLine = ({ upcoming = [] }: Pick<LessonInfo, "upcoming">, max: number) => {
  const ahead = clip([...new Set(upcoming)].join("; "), max);
  return ahead ? `Grammar the course teaches later (not met yet): ${ahead}` : undefined;
};

/** The lesson's own script within `max` characters: the situations and topic the learner met in it
 *  (a film's natural speech, partly above the learner's level). */
export function scriptLine({ scriptHtml }: Pick<LessonInfo, "scriptHtml">, max: number) {
  const script = scriptHtml ? htmlToText(scriptHtml).trim() : "";
  return script
    ? `The lesson's own script — its topic only: the learner has met its situations, so take another one; natural speech, partly above their level; never copied, never its people:\n${clip(script, max)}`
    : undefined;
}

/** Where the lesson is in its course: its first, middle or last third (the middle when not known). */
export type CourseThird = "early" | "middle" | "late";
export function courseThird({ place }: Pick<LessonInfo, "place">): CourseThird {
  if (!place || place.of < 3) return "middle";
  const at = (place.n - 1) / (place.of - 1);
  return at < 1 / 3 ? "early" : at > 2 / 3 ? "late" : "middle";
}

/** The lesson's grammar notes as plain text within `max` characters. */
export const grammarNotes = (lesson: Pick<LessonInfo, "grammarHtml">, max: number) =>
  clip(lesson.grammarHtml.map(htmlToText).join("\n\n"), max);
