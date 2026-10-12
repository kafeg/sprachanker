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

/** A speaker's label in a script: a name (up to three words) and a colon, at a line's start. */
const SPEAKER = /^(\p{Lu}[\p{L}'’-]*(?: \p{Lu}[\p{L}'’-]*){0,2}):\s*(.*)$/u;

/** The people speaking in a script (course HTML), by name as written in a sentence ("LISA:" →
 *  "Lisa"): a label in capitals, or one alone on its line — never a word that opens a sentence with a
 *  colon ("Also: Hallo"). */
export function speakersOf(html: string): string[] {
  const names = new Set<string>();
  for (const line of htmlToText(html).split("\n")) {
    const [, label = "", rest = ""] = SPEAKER.exec(line.trim()) ?? [];
    const capitals = label.length > 1 && label === label.toLocaleUpperCase();
    if (!label || (!capitals && rest)) continue;
    names.add(
      capitals
        ? label
            .toLocaleLowerCase()
            .replace(/(^|[\s-])(\p{L})/gu, (_, a, b: string) => a + b.toLocaleUpperCase())
        : label,
    );
  }
  return [...names];
}

/** "The course's characters: Nico, Lisa, Emma" — names a made-up person never takes. */
export const charactersLine = ({ characters = [] }: Pick<LessonInfo, "characters">) =>
  characters.length ? `The course's characters: ${characters.join(", ")}` : undefined;

/** The lesson's grammar notes as plain text within `max` characters. */
export const grammarNotes = (lesson: Pick<LessonInfo, "grammarHtml">, max: number) =>
  clip(lesson.grammarHtml.map(htmlToText).join("\n\n"), max);
