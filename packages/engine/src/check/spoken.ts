// An answer said aloud to a speaking item, checked by the engine without a model: against its line
// to say, or against the source's own answer as heard from its recording (schema `heard.ts`: Whisper's
// text, made once into the course). Tolerant as every spoken check is (`wordDiff`'s `spoken`: case,
// marks and how words are joined not heard). A frame of the source ("Ich trinke …") checks both: the
// source's recording is used only where it completes the frame, and an answer that completes it
// otherwise — the learner's own name, number, taste — is told apart from one that misses it.
import type { TokenDiff } from "@sprachanker/schema";
import { gradedWords, wordAsHeard } from "../text/diff.ts";
import { FRAME, linesToSay, SPELLED } from "./answers.ts";
import { spokenCheck } from "./outcome.ts";

/** A frame's words in order, a gap (`null`) where the learner completes it; a gap is one or more
 *  words: an ellipsis, a line of underscores or words in brackets (a hint: "(die Brille)"). */
type Frame = Array<string | null>;

const GAPS = /…|\.{3,}|_{2,}|\([^)]*\)|\[[^\]]*\]/g;
/** A gap's place in a line while it is read (a private-use character: no word, no mark). */
const GAP = "";
const ALTERNATIVES = /\s+\/\s+/;

/** A source's answer read as frames, one for each of its alternatives (" / "); gaps side by side
 *  ("... (die Brille)") are one. */
function framesOf(reference: string[]): Frame[] {
  return reference
    .flatMap((r) => r.split(ALTERNATIVES))
    .map((line) => {
      const frame: Frame = [];
      for (const token of gradedWords(line.replace(GAPS, ` ${GAP} `))) {
        const gap = token.includes(GAP);
        if (!gap) frame.push(token);
        else if (frame[frame.length - 1] !== null) frame.push(null);
      }
      return frame;
    })
    .filter((f) => f.includes(null));
}

/** The words filling each gap of a frame in `text`, if `text` completes it: every word of the frame
 *  said, in order, nothing else said but in its gaps, each gap one word or more. */
export function completes(lang: string, frame: Frame, text: string): string[][] | undefined {
  const said = gradedWords(text);
  const sound = said.map((w) => wordAsHeard(lang, w));
  const want = frame.map((w) => (w === null ? null : wordAsHeard(lang, w)));
  const failed = new Set<string>();
  const match = (f: number, s: number): string[][] | undefined => {
    if (f === want.length) return s === said.length ? [] : undefined;
    if (failed.has(`${f},${s}`)) return undefined;
    const w = want[f];
    if (w !== null) {
      const rest = sound[s] === w ? match(f + 1, s + 1) : undefined;
      if (rest) return rest;
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

/** A text's sentences, as written: each ends at its final mark (quotes after it kept with it). */
export const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?…]["»«”“’]*)\s+/u)
    .map((s) => s.trim())
    .filter((s) => gradedWords(s).length > 0);

/** What an answer said aloud to a speaking item is checked against: its lines to say (`exact`);
 *  else the source's answer as heard from its recording (`heard`) — the shortest runs of its
 *  sentences that complete the item's frame, or, with no frame, the whole text and each sentence
 *  (a recording often says several answers one after the other). Undefined: nothing to check it by
 *  (no recording heard, or what was heard completes none of the frame — not used, never trusted). */
export function spokenAnswers(
  lang: string,
  item: { text?: string; reference?: string[] },
  heard?: string,
): { answers: string[]; frames: Frame[]; exact: boolean } | undefined {
  const lines = linesToSay(item);
  if (lines) return { answers: lines, frames: [], exact: true };
  if (!heard?.trim() || SPELLED.test(heard)) return undefined;
  const sentences = sentencesOf(heard);
  if (!item.reference) {
    const answers = [...new Set([heard.trim(), ...(sentences.length > 1 ? sentences : [])])];
    return { answers, frames: [], exact: false };
  }
  if (!item.reference.some((r) => FRAME.test(r))) return undefined;
  const frames = framesOf(item.reference);
  const fits = (text: string) => frames.some((f) => completes(lang, f, text));
  const answers: string[] = [];
  for (let start = 0; start < sentences.length; start++)
    for (let end = start + 1; end <= sentences.length; end++) {
      const run = sentences.slice(start, end).join(" ");
      if (!fits(run)) continue;
      answers.push(run);
      break;
    }
  return answers.length ? { answers, frames, exact: false } : undefined;
}
export type SpokenAnswers = NonNullable<ReturnType<typeof spokenAnswers>>;

/**
 * What was heard of an answer judged against what it is checked by: `correct` when it says one of
 * the answers, `partial` when most of its words (spokenCheck) — or when it completes the item's frame
 * otherwise than the source did (`otherwise`: the learner's own words in its gaps) —, `wrong` when
 * it misses the line or the frame. With neither a line nor a frame (the source's answer only), an
 * answer unlike it is not judged (`verdict` undefined): it may be the learner's own. `diff` against
 * the closest answer.
 */
export function judgeSpoken(
  lang: string,
  target: SpokenAnswers,
  transcript: string,
): { verdict?: "correct" | "partial" | "wrong"; otherwise?: true; diff: TokenDiff[] } {
  const { diff, verdict } = spokenCheck(lang, target.answers, transcript);
  if (verdict !== "wrong") return { verdict, diff };
  if (target.frames.some((f) => completes(lang, f, transcript)))
    return { verdict: "partial", otherwise: true, diff };
  return target.exact || target.frames.length ? { verdict: "wrong", diff } : { diff };
}
