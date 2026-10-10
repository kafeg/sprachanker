// The catalogue and the test centre's answers joined into the exam (pure, 02, 03): each question by its
// section and number; its options as the PDF prints them (a row of pictures: the pictures), the right
// one as the test centre marks it — taken only where both sources list the same options in the same
// order, each reading most like its counterpart (`unpaired`).
import { type LibraryFile, libraryFile } from "@sprachanker/course-kit";
import {
  CANONICAL_FORMAT,
  EXAM_FORMAT,
  type Exam,
  type ExamItem,
  type ExamItemKey,
  type ExamSources,
  examItemKey,
  examSectionKey,
  type FederalState,
  LOCALE_FORMAT,
  type MediaPath,
  type Option,
  optionId,
} from "@sprachanker/schema";
import {
  CATALOGUE_PDF,
  COURSE,
  COURSE_KEY,
  EDITION,
  EXAM_KEY,
  GENERAL_QUESTIONS,
  SOURCE,
  STATE_QUESTIONS,
  STATES,
  TEST_CENTRE_START,
} from "./catalog.ts";
import type { Catalogue, CatalogueQuestion } from "./catalogue.ts";
import type { CentreQuestion } from "./centre.ts";

/** The test asks 33 questions in 60 minutes: 30 of the general part, 3 of the learner's state. */
const TIME_LIMIT_SEC = 3600;
const GENERAL_DRAWN = 30;
const STATE_DRAWN = 3;
/** Points to pass: 15 for the "Leben in Deutschland" certificate, 17 for naturalisation. */
const PASS_LID = 15;
const PASS_NATURALISATION = 17;

/** Where a question's answer is in the test centre: the general part by its number (any state shows
 *  it), a state's question as 301–310 with that state chosen. */
export interface CentreAddress {
  state: FederalState | null;
  number: number;
}

/** A question's key in the exam (`q-001`, `q-be-01`) and its address in the test centre. */
export function addressOf(q: Pick<CatalogueQuestion, "state" | "number">): {
  id: string;
  state: FederalState | null;
  centre: CentreAddress;
} {
  if (q.state === null)
    return {
      id: String(q.number).padStart(3, "0"),
      state: null,
      centre: { state: null, number: q.number },
    };
  const state = STATES.find((s) => s.name === q.state);
  if (!state) throw new Error(`the catalogue names a state not known: ${q.state}`);
  return {
    id: `${state.code}-${String(q.number).padStart(2, "0")}`,
    state: state.code,
    centre: { state: state.code, number: GENERAL_QUESTIONS + q.number },
  };
}

/** An option's text as compared: letters and digits, lower case ("Bild 1" and "1" alike: a picture's
 *  label). */
const comparable = (text: string) =>
  text
    .replace(/^Bild\s+(\d)$/, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** How alike two options read, 0–1: the share of letter pairs they have in common (Dice). The two
 *  sources word some options differently — a gender pair in the other order or one form only ("Die
 *  Wählerin/der Wähler" / "Der Wähler"), a spelling ("selbstständig" / "selbständig"), a slip — but
 *  never so that one option reads like another. */
export function likeness(a: string, b: string): number {
  const pairs = (t: string) => {
    const s = comparable(t);
    if (s.length < 2) return [s];
    return Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
  };
  const [x, y] = [pairs(a), pairs(b)];
  const left = new Map<string, number>();
  for (const p of y) left.set(p, (left.get(p) ?? 0) + 1);
  let common = 0;
  for (const p of x) {
    const n = left.get(p) ?? 0;
    if (n > 0) {
      common++;
      left.set(p, n - 1);
    }
  }
  return (2 * common) / (x.length + y.length);
}

/** Below this the same option in the two sources is not taken as the same. */
const SAME_OPTION = 0.5;

/** The first option where the two sources' options do not pair up one to one in order: one worded
 *  differently that reads as much like another option as like its counterpart, or too unlike it. */
export function unpaired(catalogue: string[], centre: string[]): number | undefined {
  const like = (i: number, j: number) => likeness(catalogue[i] ?? "", centre[j] ?? "");
  for (let i = 0; i < catalogue.length; i++) {
    // The same text is the same option, also where the options differ only in their order of words
    // ("1=Sowjetunion, 2=USA, …").
    if (comparable(catalogue[i] ?? "") === comparable(centre[i] ?? "")) continue;
    const own = like(i, i);
    if (own < SAME_OPTION) return i;
    for (let j = 0; j < catalogue.length; j++)
      if (j !== i && (like(i, j) >= own || like(j, i) >= own)) return i;
  }
  return undefined;
}

/** A picture of a question as stored: by its place (`item`, or the option's id). */
export type PictureFiles = Map<string, MediaPath>;
/** The name a question's picture is stored under: the question's id, then `a`–`d` for an option. */
export const pictureName = (id: string, place: "item" | string) =>
  place === "item" ? `lid-${id}.png` : `lid-${id}-${place}.png`;

export interface NormalisedExam {
  files: LibraryFile[];
  /** Questions in the exam, and those of the catalogue left out. */
  questions: number;
  leftOut: number;
  /** Why: an answer not found, sources that disagree; a catalogue of another size. */
  problems: string[];
}

/** Where the catalogue was kept (`raw/`) and when it and the test centre's pages were read. */
export interface CatalogueCopy {
  sha256: string;
  readAt: number;
}

export const PDF_RAW = `raw/${EDITION}/${COURSE}/gesamtfragenkatalog.pdf`;

export function normaliseExam(
  catalogue: Catalogue,
  answers: (address: CentreAddress) => CentreQuestion | undefined,
  pictures: (id: string) => PictureFiles,
  copy: CatalogueCopy,
): NormalisedExam {
  const problems: string[] = [];
  const items: ExamItem[] = [];
  // What the sources say (ExamSources): each question's places, the checks' counts.
  const placed: ExamSources["items"] = {};
  const read = { options: 0, optionsAgree: 0, marked: 0, markedTwice: 0, pictures: 0, kept: 0 };
  for (const q of catalogue.questions) {
    const { id, state, centre } = addressOf(q);
    const answer = answers(centre);
    if (!answer) {
      problems.push(`${id}: the test centre's page was not read`);
      continue;
    }
    read.options++;
    if (answer.options.length !== q.options.length) {
      problems.push(
        `${id}: ${q.options.length} options in the catalogue, ${answer.options.length} in the test centre`,
      );
      continue;
    }
    const differ = unpaired(
      q.options,
      answer.options.map((o) => o.text),
    );
    if (differ !== undefined) {
      problems.push(
        `${id}: option ${differ + 1} reads "${q.options[differ]}" in the catalogue, "${answer.options[differ]?.text}" in the test centre`,
      );
      continue;
    }
    read.optionsAgree++;
    read.marked++;
    const right = answer.options.flatMap((o, i) => (o.right ? [i] : []));
    if (right.length === 1) read.markedTwice++;
    if (right.length !== 1) {
      problems.push(`${id}: the test centre marks ${right.length} right options`);
      continue;
    }
    const files = pictures(id);
    read.pictures += q.pictures.length;
    read.kept += Math.min(q.pictures.length, files.size);
    const optionPictures = q.pictures.length === q.options.length && q.pictures.length > 1;
    const options: Option[] = q.options.map((text, i) =>
      optionPictures
        ? { id: optionId(i), media: { image: files.get(optionId(i)) as MediaPath } }
        : { id: optionId(i), text },
    );
    const image = files.get("item");
    const item: ExamItem = {
      key: examItemKey(EXAM_KEY, id),
      type: "single_choice",
      tags: { federalState: state },
      prompt: q.stem,
      ...(image && { media: { image, ...(q.credit && { credit: q.credit }) } }),
      options,
      answer: { optionIds: [optionId(right[0] as number)] },
    };
    items.push(item);
    const stateName = STATES.find((s) => s.code === state)?.name;
    placed[item.key] = [
      { document: "catalogue", at: `${stateName ?? "Allgemeine Fragen"}, Aufgabe ${q.number}` },
      { document: "centre", at: `Frage ${centre.number}${stateName ? ` (${stateName})` : ""}` },
    ];
  }
  const keysOf = (state: boolean) =>
    items.filter((i) => (i.tags.federalState !== null) === state).map((i) => i.key as ExamItemKey);
  const exam: Exam = {
    format: EXAM_FORMAT,
    key: EXAM_KEY,
    timeLimitSec: TIME_LIMIT_SEC,
    sections: [
      {
        key: examSectionKey(EXAM_KEY, "general"),
        pool: keysOf(false),
        draw: GENERAL_DRAWN,
        filter: null,
      },
      {
        key: examSectionKey(EXAM_KEY, "state"),
        pool: keysOf(true),
        draw: STATE_DRAWN,
        filter: { tag: "federalState", setting: "exam.federalState" },
      },
    ],
    items,
    thresholds: [
      { id: "lid", minPoints: PASS_LID },
      { id: "naturalisation", minPoints: PASS_NATURALISATION },
    ],
  };
  const expected = GENERAL_QUESTIONS + STATES.length * STATE_QUESTIONS;
  if (catalogue.questions.length !== expected)
    problems.push(`the catalogue has ${catalogue.questions.length} questions, not ${expected}`);
  const [year, month, day] = catalogue.stand.split("-");
  const files: LibraryFile[] = [
    libraryFile.course({
      format: CANONICAL_FORMAT,
      key: COURSE_KEY,
      source: SOURCE,
      units: [],
      exams: [EXAM_KEY],
      goals: [],
    }),
    libraryFile.localeCourse({
      format: LOCALE_FORMAT,
      edition: EDITION,
      course: COURSE_KEY,
      sourceId: "gesamtfragenkatalog",
      title: "Leben in Deutschland",
      descriptionHtml:
        "<p>Der Gesamtfragenkatalog zum Test „Leben in Deutschland“ und zum Einbürgerungstest " +
        `(Stand: ${day}.${month}.${year}): 300 allgemeine Fragen und je 10 Fragen zu jedem ` +
        "Bundesland. Der Test stellt 33 Fragen in 60 Minuten, 3 davon zum eigenen Bundesland.</p>",
      units: {},
      goals: {},
    }),
    libraryFile.exam(exam),
    libraryFile.examSources({
      format: EXAM_FORMAT,
      exam: EXAM_KEY,
      read: copy.readAt,
      documents: [
        {
          id: "catalogue",
          title: `Gesamtfragenkatalog zum Test „Leben in Deutschland“ und zum Einbürgerungstest (Stand: ${day}.${month}.${year})`,
          url: CATALOGUE_PDF,
          raw: PDF_RAW,
          sha256: copy.sha256,
        },
        {
          id: "centre",
          title: "BAMF: Online-Testcenter „Leben in Deutschland“",
          url: TEST_CENTRE_START,
        },
      ],
      checks: [
        { id: "questions-complete", passed: items.length, of: expected },
        { id: "options-agree", passed: read.optionsAgree, of: read.options },
        { id: "answers-marked-twice", passed: read.markedTwice, of: read.marked },
        { id: "media-kept", passed: read.kept, of: read.pictures },
      ],
      items: placed,
    }),
    libraryFile.localeExam({
      format: LOCALE_FORMAT,
      edition: EDITION,
      exam: EXAM_KEY,
      title: "Leben in Deutschland",
      sections: {
        [examSectionKey(EXAM_KEY, "general")]: { title: "Allgemeine Fragen" },
        [examSectionKey(EXAM_KEY, "state")]: { title: "Fragen zum Bundesland" },
      },
      thresholds: {
        lid: { title: "Test „Leben in Deutschland“ bestanden" },
        naturalisation: { title: "Einbürgerungstest bestanden" },
      },
      items: {},
    }),
  ];
  return {
    files,
    questions: items.length,
    leftOut: catalogue.questions.length - items.length,
    problems,
  };
}
