// The kinds of text Reading and Listening are made of (04, "AI practice in courses"; owner,
// 2026-10-12: real things one reads and hears, many situations): data, chosen by code — at random
// among those of the step at the learner's level, not the lesson's last ones — so the model never
// falls back on one favourite scene. Each says what it is, whether people speak in turns, one
// speaks or it is written, and how long it is at A1; a level and the lesson's place in its course
// make it longer (`textWords`).
import type { PracticeStep } from "@sprachanker/schema";
import { type CourseThird, cefrOf } from "./lesson.ts";

/** People in turns (a conversation, a chat), one voice (a message, a story told), or a written text. */
export type TextShape = "dialogue" | "monologue" | "written";

export interface TextGenre {
  id: string;
  step: PracticeStep;
  shape: TextShape;
  /** The lowest level it suits. */
  from: "A1" | "A2" | "B1";
  /** What it is, for the model. */
  what: string;
  /** Its length at A1 in words. */
  words: [number, number];
  /** At most this many people speak or write (a dialogue's or chat's). */
  people?: number;
  /** Made from the very first words too (greetings, names): the genres of a course's start. */
  start?: true;
}

export const TEXT_GENRES: readonly TextGenre[] = [
  {
    id: "conversation",
    step: "listening",
    shape: "dialogue",
    from: "A1",
    what: "an everyday conversation of two people who want something from each other: they ask, plan, buy, arrange or agree on something",
    words: [50, 90],
    people: 2,
    start: true,
  },
  {
    id: "telling",
    step: "listening",
    shape: "dialogue",
    from: "A1",
    what: "a conversation where one person tells the other about something that happened or a plan, in longer turns; the other reacts, asks back and comments",
    words: [60, 100],
    people: 2,
  },
  {
    id: "phone_call",
    step: "listening",
    shape: "dialogue",
    from: "A1",
    what: "a phone call: who calls and why, something arranged or asked for (a time, a place, a price), goodbye",
    words: [50, 90],
    people: 2,
    start: true,
  },
  {
    id: "voice_message",
    step: "listening",
    shape: "monologue",
    from: "A1",
    what: "a voice message or a message on an answering machine: who calls, why, what the other should do, how to reach them",
    words: [35, 65],
    start: true,
  },
  {
    id: "announcement",
    step: "listening",
    shape: "monologue",
    from: "A1",
    what: "a public announcement: at a station, on a train, at an airport, in a shop or supermarket, at a school or an event, a traffic or weather report on the radio",
    words: [30, 60],
  },
  {
    id: "story_told",
    step: "listening",
    shape: "monologue",
    from: "A1",
    what: "a short story told by a narrator: a small episode of everyday life with a beginning, a turn and an end",
    words: [60, 105],
  },
  {
    id: "about_myself",
    step: "listening",
    shape: "monologue",
    from: "A1",
    what: "someone talks about themselves — their day, family, work, home, a trip or a hobby — as in a podcast, a video or a course",
    words: [55, 95],
  },
  {
    id: "three_people",
    step: "listening",
    shape: "dialogue",
    from: "A2",
    what: "a conversation of three people (friends, colleagues, a family) deciding or discussing something together",
    words: [80, 110],
    people: 3,
  },
  {
    id: "interview",
    step: "listening",
    shape: "dialogue",
    from: "A2",
    what: "a short radio or street interview: a host asks someone about their work, a hobby, an event or an experience",
    words: [80, 110],
    people: 2,
  },
  {
    id: "chat",
    step: "reading",
    shape: "dialogue",
    from: "A1",
    what: "a messenger chat of two or three people (friends, a family, colleagues, neighbours): short messages, each with its sender",
    words: [40, 80],
    people: 3,
    start: true,
  },
  {
    id: "personal_letter",
    step: "reading",
    shape: "written",
    from: "A1",
    what: "an e-mail or letter from a friend or relative: news, an invitation, a plan, a request — with a greeting and a signature",
    words: [60, 105],
  },
  {
    id: "work_letter",
    step: "reading",
    shape: "written",
    from: "A1",
    what: "an e-mail at work, at a language course or a school: from a colleague, a boss, a teacher or a parent — with a greeting and a signature",
    words: [55, 100],
  },
  {
    id: "official_letter",
    step: "reading",
    shape: "written",
    from: "A1",
    what: "a letter or e-mail from an office or a company: a landlord, the city office, a doctor's practice, a health insurance, a bank, a delivery service — an appointment, a request, a reminder; simple and clear at A1",
    words: [50, 100],
  },
  {
    id: "notice",
    step: "reading",
    shape: "written",
    from: "A1",
    what: "a notice or sign: in a house, on a shop's door, at a library, a pool, a doctor's practice or a school — opening times, rules, a change, an event",
    words: [30, 65],
    start: true,
  },
  {
    id: "small_ads",
    step: "reading",
    shape: "written",
    from: "A1",
    what: "three or four small ads or offers on one topic (flats, courses, things for sale, jobs, free time), each a short paragraph",
    words: [60, 105],
  },
  {
    id: "programme",
    step: "reading",
    shape: "written",
    from: "A1",
    what: "a menu, a timetable, a course or event programme or a price list, with a few lines of text around it",
    words: [35, 70],
  },
  {
    id: "story",
    step: "reading",
    shape: "written",
    from: "A1",
    what: "a short story about everyday life, with a beginning, a turn and an end",
    words: [70, 110],
  },
  {
    id: "post",
    step: "reading",
    shape: "written",
    from: "A2",
    what: "a blog or social media post: someone writes about a trip, a hobby, a new home, a recipe, a day out",
    words: [70, 110],
  },
  {
    id: "article",
    step: "reading",
    shape: "written",
    from: "B1",
    what: "a short newspaper or magazine article on an everyday topic: a town's news, a trend, a person and what they do",
    words: [60, 90],
  },
];

/** Areas of everyday life, a few of which are offered to the model as ideas for a situation. */
export const LIFE_AREAS = [
  "a bakery, a market or a supermarket",
  "a café or a restaurant",
  "a flat: neighbours, the landlord, moving house",
  "work: colleagues, the first day, a meeting",
  "a language course or a school",
  "a doctor's practice or a pharmacy",
  "a city office or a bank",
  "a bus, a train or a station",
  "a trip, a hotel, holidays",
  "sport, a club, a park",
  "family and relatives",
  "friends: plans for the evening or the weekend",
  "a birthday, a party, a holiday",
  "the weather and the seasons",
  "clothes and shopping",
  "cooking and recipes",
  "a phone, the internet, an app",
  "a post office or a parcel",
  "a hobby: music, films, books, games",
  "a garden, animals, pets",
  "a library or a museum",
  "a car, a bike, the way somewhere",
  "a hairdresser or a repair shop",
  "a flat share or a dormitory",
  "children: a nursery, a playground, homework",
  "a job ad, an interview, a new job",
  "a concert, a cinema, a theatre",
  "a neighbourhood: a street festival, a flea market",
];

const LEVEL_FACTOR: Record<string, number> = {
  A1: 1,
  A2: 1.4,
  B1: 1.9,
  B2: 2.4,
  C1: 2.8,
  C2: 2.8,
};
const THIRD_FACTOR: Record<CourseThird, number> = { early: 0.8, middle: 1, late: 1.15 };

/** How long a text of a genre is at a level and a place in the course, in words. */
export function textWords(genre: TextGenre, level: string | undefined, third: CourseThird) {
  const f = (LEVEL_FACTOR[cefrOf(level)] ?? 1) * THIRD_FACTOR[third];
  return genre.words.map((w) => Math.round((w * f) / 5) * 5) as [number, number];
}

/** How many questions a text of that length has: one for about every fourteen words, five to ten. */
export const questionCount = ([from, to]: [number, number]) =>
  Math.max(5, Math.min(10, Math.round((from + to) / 2 / 14)));

const ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** How many words the learner knows below which only a course's start genres are drawn. */
export const FEW_WORDS = 80;

/** The genres of a step at a level (a course of A1 none from A2 on); `few`: the learner knows very
 *  few words yet — the genres of a course's start only. */
export function genresFor(step: PracticeStep, level: string | undefined, few = false) {
  const at = ORDER.indexOf(cefrOf(level));
  return TEXT_GENRES.filter(
    (g) => g.step === step && ORDER.indexOf(g.from) <= at && (!few || g.start),
  );
}

/** A genre of a step at random (`random` in [0, 1)), none of `recent` while another is there. */
export function pickGenre(
  step: PracticeStep,
  level: string | undefined,
  recent: readonly string[],
  random: () => number,
  few = false,
): TextGenre {
  const all = genresFor(step, level, few);
  const fresh = all.filter((g) => !recent.includes(g.id));
  const from = fresh.length ? fresh : all;
  return from[Math.floor(random() * from.length)] as TextGenre;
}

/** `n` life areas at random, each once. */
export function pickAreas(n: number, random: () => number): string[] {
  const left = [...LIFE_AREAS];
  const out: string[] = [];
  while (out.length < n && left.length)
    out.push(left.splice(Math.floor(random() * left.length), 1)[0] as string);
  return out;
}
