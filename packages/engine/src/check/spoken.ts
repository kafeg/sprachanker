// An answer said aloud to a speaking item, checked by the engine without a model: against its line
// to say, or against the source's own answer as heard from its recording (schema `heard.ts`: Whisper's
// text, made once into the course). Tolerant as every spoken check is (`wordDiff`'s `spoken`: case,
// marks, how words are joined, "ß"/"ss", numbers in digits not heard). A frame of the source ("Ich
// trinke …") checks both: the source's recording is used only where it completes the frame, and an
// answer that completes it otherwise — the learner's own name, number, taste — is right too. A false
// "wrong" must never punish a right answer (owner, 2026-10-18): an answer neither right nor clearly
// missed is compared word by word with the closest answer, as a line repeated is, and is at worst
// "almost"; the AI only when the learner asks "Why?".
import type { Exercise, ItemOf, TokenDiff } from "@sprachanker/schema";
import { gradedWords, wordAsHeard } from "../text/diff.ts";
import { alternativesOf, FRAME, linesToSay, SPELLED } from "./answers.ts";
import { spokenCheck } from "./outcome.ts";

/** A frame's words in order, a gap (`null`) where the learner completes it; a gap is one or more
 *  words: an ellipsis, a line of underscores or words in brackets (a hint: "(die Brille)"). */
type Frame = Array<string | null>;

const GAPS = /…|\.{3,}|_{2,}|\([^)]*\)|\[[^\]]*\]/g;
/** A gap's place in a line while it is read (a private-use character: no word, no mark). */
const GAP = "";

/** A source's answer read: its alternatives (" / ", outside brackets) with a gap as frames — gaps
 *  side by side ("... (die Brille)") one —, those without one as lines to say (`plain`). A frame of
 *  gaps only ("(seit – zwei Monate)") is none: every answer completes it. */
function framesOf(reference: string[]): { frames: Frame[]; plain: string[] } {
  const frames: Frame[] = [];
  const plain: string[] = [];
  for (const line of reference.flatMap(alternativesOf)) {
    const frame: Frame = [];
    for (const token of gradedWords(line.replace(GAPS, ` ${GAP} `))) {
      const gap = token.includes(GAP);
      if (!gap) frame.push(token);
      else if (frame[frame.length - 1] !== null) frame.push(null);
    }
    if (!frame.includes(null)) {
      if (frame.length) plain.push(line);
    } else if (frame.some((w) => w !== null)) frames.push(frame);
  }
  return { frames, plain };
}

/** Choices joined by a slash with no space ("den Frühling/den Sommer/…"): no frame reads them. */
const SLASHED = /\p{L}\/\p{L}/u;

/** Whether a speaking item's answers are checked by the source's answer as heard: one with no line
 *  to say whose source's answer, if it has one, is a frame the engine reads (not spelled, no
 *  choices joined by a slash). */
const checkedByHeard = (item: { text?: string; reference?: string[] }) =>
  !linesToSay(item) &&
  ![item.text, ...(item.reference ?? [])].some((s) => s && SPELLED.test(s)) &&
  (!item.reference ||
    (item.reference.some((r) => FRAME.test(r)) &&
      !item.reference.some((r) => SLASHED.test(r.replace(GAPS, " ")))));

/** The recording of the source's answer a speaking item's answers are checked by, once heard
 *  (`heardTexts`): an item checked by it (`checkedByHeard`) that has one. */
export function answerToHear(exercise: Exercise, index: number): string | undefined {
  const item = exercise.items[index] as ItemOf<"speech_selfrate"> | undefined;
  if (exercise.type !== "speech_selfrate" || !item?.answerAudio || !checkedByHeard(item))
    return undefined;
  return item.answerAudio;
}

/** The most sentences of a recording read, and of one answer in it: a recording saying more is no
 *  answer to check by (and the runs tried grow with their square). */
const MAX_SENTENCES = 24;
const MAX_RUN = 6;

/** The words filling each gap of a frame in `text`, if `text` completes it: every word of the frame
 *  said, in order — two of them heard as one or one as two ("geht's", "geht es") —, nothing else said
 *  but in its gaps, each gap one word or more. */
export function completes(lang: string, frame: Frame, text: string): string[][] | undefined {
  const said = gradedWords(text);
  const sound = said.map((w) => wordAsHeard(lang, w));
  const want = frame.map((w) => (w === null ? null : wordAsHeard(lang, w)));
  const failed = new Set<string>();
  const match = (f: number, s: number): string[][] | undefined => {
    if (f === want.length) return s === said.length ? [] : undefined;
    if (failed.has(`${f},${s}`)) return undefined;
    const w = want[f];
    if (w !== null && w !== undefined) {
      const next = want[f + 1];
      const steps: Array<[number, number]> = [];
      if (sound[s] === w) steps.push([1, 1]);
      if (typeof next === "string" && sound[s] === w + next) steps.push([2, 1]);
      if (s + 1 < said.length && `${sound[s]}${sound[s + 1]}` === w) steps.push([1, 2]);
      for (const [df, ds] of steps) {
        const rest = match(f + df, s + ds);
        if (rest) return rest;
      }
    } else
      for (let end = s + 1; end <= said.length; end++) {
        const rest = match(f + 1, end);
        if (rest) return [said.slice(s, end), ...rest];
      }
    failed.add(`${f},${s}`);
    return undefined;
  };
  return match(0, 0);
}

/** The share of a frame's own words said in `text`, in any order (one heard joined to the next
 *  counts). */
function frameWordsSaid(lang: string, frame: Frame, text: string) {
  const sounds = new Set(gradedWords(text).map((w) => wordAsHeard(lang, w)));
  const fixed = frame.flatMap((w) => (w === null ? [] : [wordAsHeard(lang, w)]));
  const said = fixed.filter(
    (w, i) =>
      sounds.has(w) || sounds.has(w + (fixed[i + 1] ?? "")) || sounds.has((fixed[i - 1] ?? "") + w),
  );
  return said.length / fixed.length;
}

/** A text's sentences, as written: each ends at its final mark (quotes after it kept with it). */
export const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?…]["»«”“’]*)\s+/u)
    .map((s) => s.trim())
    .filter((s) => gradedWords(s).length > 0);

/** What an answer said aloud to a speaking item is checked against: its lines to say (`exact`);
 *  else the source's answer as heard from its recording (`heard`) — the shortest runs of its
 *  sentences that complete the item's frame (with the source's lines without a gap), or, with no
 *  frame (none, or one of gaps only), the whole text and each sentence (a recording often says
 *  several answers one after the other). Undefined: nothing to check it by (no recording heard, one
 *  of more sentences than an answer has, or what was heard completes none of the frame — not used,
 *  never trusted). */
export function spokenAnswers(
  lang: string,
  item: { text?: string; reference?: string[]; prompt?: string },
  heard?: string,
): { answers: string[]; frames: Frame[]; exact: boolean; prompt?: string } | undefined {
  const lines = linesToSay(item);
  if (lines) return { answers: lines, frames: [], exact: true };
  if (!heard?.trim() || SPELLED.test(heard) || !checkedByHeard(item)) return undefined;
  const sentences = sentencesOf(heard);
  if (sentences.length > MAX_SENTENCES) return undefined;
  const { frames, plain } = item.reference
    ? framesOf(item.reference)
    : { frames: [], plain: [] as string[] };
  if (!frames.length) {
    const answers = [...plain, heard.trim(), ...(sentences.length > 1 ? sentences : [])];
    return { answers: [...new Set(answers)], frames, exact: false, prompt: item.prompt };
  }
  const fits = (text: string) => frames.some((f) => completes(lang, f, text));
  const runs: string[] = [];
  for (let start = 0; start < sentences.length; start++)
    for (let end = start + 1; end <= Math.min(sentences.length, start + MAX_RUN); end++) {
      const run = sentences.slice(start, end).join(" ");
      if (!fits(run)) continue;
      runs.push(run);
      break;
    }
  return runs.length
    ? { answers: [...new Set([...runs, ...plain])], frames, exact: false, prompt: item.prompt }
    : undefined;
}
export type SpokenAnswers = NonNullable<ReturnType<typeof spokenAnswers>>;

/** What was heard of an answer said aloud to a speaking item nothing here checks — no line to say,
 *  no source's answer heard to judge it by (`spokenAnswers`): the AI checks it by itself, where one is
 *  set up. Undefined for anything else (the engine judges it; the AI only on "Why?"), or nothing
 *  heard. */
export function spokenFreely(
  exercise: Exercise,
  index: number,
  answer: unknown,
  lang: string,
  heard?: Readonly<Record<string, string>>,
) {
  const item = exercise.items[index] as ItemOf<"speech_selfrate"> | undefined;
  if (exercise.type !== "speech_selfrate" || !item) return undefined;
  const transcript = (answer as { transcript?: unknown } | undefined)?.transcript;
  if (typeof transcript !== "string" || !transcript.trim()) return undefined;
  const said = item.answerAudio ? heard?.[item.answerAudio] : undefined;
  return spokenAnswers(lang, item, said) ? undefined : transcript;
}

/** At most this share of a frame's own words said, and of the closest answer's words: the frame
 *  missed (the question said back). */
const MISSED = 0.5;

/** A line that is only a word spelled, its letters joined by hyphens ("E-M-M-A"). */
const SPELLED_LINE = /^\p{L}(?:-\p{L})+[.!?]?$/u;
/** A text's letters alone, upper-cased: how a word spelled is compared. */
const lettersOf = (s: string) =>
  s
    .normalize("NFC")
    .replace(/[^\p{L}]/gu, "")
    .toLocaleUpperCase();

/**
 * What was heard of an answer judged against what it is checked by. A line to say: `correct` when
 * it is said, `partial` most of its words (spokenCheck), else `wrong`. A frame: `correct` when the
 * answer says one of the answers or completes the frame — any of its alternatives, a choice in
 * brackets, the learner's own words in its gaps (`ownWords`: a note, not a mistake) —, `wrong` only
 * when at most half of the frame's own words are said and at most half of the closest answer's (the
 * question said back: "Danke, gut. Und Ihnen?" leaves out the greeting, not the answer); between — words
 * around the frame, another order, a word misheard —, the words compared with the closest answer:
 * `partial`, never `wrong` (owner, 2026-10-18: they may be right). The source's answer only (no line,
 * no frame): `correct` when said, else `partial` — the words may be the learner's own. `diff`
 * against the closest answer.
 */
export function judgeSpoken(
  lang: string,
  target: SpokenAnswers,
  transcript: string,
): { verdict: "correct" | "partial" | "wrong"; ownWords?: true; diff: TokenDiff[] } {
  // A line spelled ("E-M-M-A"): its letters, however the recogniser wrote them ("E M M A", "E, M, M, A.",
  // "Emma"); other letters "almost", never wrong (a letter misheard is the recogniser's as often).
  const spelled = target.exact ? target.answers.filter((a) => SPELLED_LINE.test(a.trim())) : [];
  if (spelled.length) {
    const said = lettersOf(transcript);
    if (spelled.some((a) => lettersOf(a) === said)) return { verdict: "correct", diff: [] };
    const letters = (s: string) => [...lettersOf(s)].join(" ");
    return {
      verdict: "partial",
      diff: spokenCheck(lang, spelled.map(letters), letters(transcript)).diff,
    };
  }
  const { diff, verdict, score } = spokenCheck(lang, target.answers, transcript);
  if (verdict === "correct" || target.exact) return { verdict, diff };
  if (target.frames.some((f) => completes(lang, f, transcript)))
    return { verdict: "correct", ownWords: true, diff };
  // Wrong only when what was said is the question said back: like the item's prompt and missing the
  // frame. A short right answer misses the frame's opening words too ("Danke, gut. Und Ihnen?" for
  // "Guten Morgen. Danke, gut ...?"), so missing them alone is never wrong; without a prompt to compare
  // with, never wrong.
  const missed =
    target.frames.length &&
    score <= MISSED &&
    Math.max(...target.frames.map((f) => frameWordsSaid(lang, f, transcript))) <= MISSED;
  const saidBack =
    !!target.prompt?.trim() && spokenCheck(lang, [target.prompt], transcript).verdict !== "wrong";
  return { verdict: missed && saidBack ? "wrong" : "partial", diff };
}
