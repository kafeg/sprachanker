// One DW exercise page → an exercise of our types + its learner-language texts (research, "Exercises").
import {
  draftExercise,
  plainLines,
  plainText,
  Unmapped,
  unknownExercise,
} from "@sprachanker/course-kit";
import {
  type Exercise,
  type ExerciseKey,
  itemKey,
  type LocaleExercise,
  type LocaleItem,
  type Option,
  optionId,
} from "@sprachanker/schema";
import type { ApolloState } from "../apollo.ts";
import {
  audioPath,
  type Context,
  type Entity,
  html,
  imagePath,
  itemAudioPaths,
  media,
  refs,
  videoPaths,
} from "./context.ts";
import { isUiLabel, uiLabels } from "./text.ts";

const GAP = /#p[a-z]*#/g;

type Item = Record<string, unknown>;
interface Mapped {
  type: Exercise["type"];
  item: Item;
  locale: LocaleItem;
}

/** Target-language text of a field, or undefined for empty fields and the page's player labels. */
function german(state: ApolloState, value: unknown): string | undefined {
  const text = plainText(value);
  return text && !isUiLabel(text, labelsOf(state)) ? text : undefined;
}

/** The player labels of a page, read once per page state. */
const labelCache = new WeakMap<ApolloState, Set<string>>();
function labelsOf(state: ApolloState) {
  const known = labelCache.get(state);
  if (known) return known;
  const labels = uiLabels(state);
  labelCache.set(state, labels);
  return labels;
}

function option(ctx: Context, state: ApolloState, alt: Entity, i: number, image: boolean): Option {
  if (!image) return { id: optionId(i), text: plainText(alt.alternativeText) };
  const path = imagePath(ctx, state, refs(state, alt.images)[0]);
  if (!path) throw new Unmapped("option image not downloaded");
  return { id: optionId(i), media: { image: path } };
}

function segments(text: string, gaps: number) {
  const out: Array<string | { gap: string }> = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(GAP)) {
    if ((m.index ?? 0) > last) out.push(text.slice(last, m.index));
    out.push({ gap: `g${++n}` });
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  if (n !== gaps) throw new Unmapped(`cloze has ${n} gap markers for ${gaps} gaps`);
  return out;
}

function mapItem(ctx: Context, state: ApolloState, q: Entity): Mapped {
  const subs = refs(state, q.subInquiries);
  // A prompt in the learner's language goes to the locale file (02, "Text language").
  const prompt = german(state, q.inquiryText);
  const learnerPrompt = prompt && ctx.learnerText(prompt) ? prompt : undefined;
  const { audio, answerAudio } = itemAudioPaths(ctx, state, q);
  const base: Item = {
    ...(prompt && !learnerPrompt ? { prompt } : {}),
    ...(answerAudio ? { answerAudio } : {}),
  };
  const itemMedia = media({
    audio,
    image: imagePath(ctx, state, q.mainContentImage ?? refs(state, q.images)[0]),
  });
  if (itemMedia) base.media = itemMedia;
  const hintHtml = html(ctx, q.inquiryDescription);
  const locale: LocaleItem = {
    ...(learnerPrompt ? { prompt: learnerPrompt } : {}),
    ...(hintHtml ? { hintHtml } : {}),
  };
  const image = q.mediaType === "IMAGE";

  switch (q.inquiryType) {
    case "ASSOCIATION": {
      if (q.selectionType === "DIRECT") {
        const left = subs.map((s, i) => {
          const text = plainText(s.inquiryText);
          const path = imagePath(ctx, state, refs(state, s.images)[0]);
          if (!text && !path) throw new Unmapped("match entry without text or image");
          return { id: optionId(i), ...(text ? { text } : { media: { image: path } }) } as Option;
        });
        const right = subs.map((s, i) =>
          option(ctx, state, refs(state, s.alternatives)[0] ?? {}, i, image),
        );
        const pairs = subs.map((_, i) => [optionId(i), optionId(i)]);
        return { type: "match", item: { ...base, left, right, answer: { pairs } }, locale };
      }
      const alts = refs(state, subs[0]?.alternatives);
      const correct = alts.flatMap((a, i) => (a.isCorrect ? [optionId(i)] : []));
      if (!correct.length) throw new Unmapped("choice without a correct option");
      const single = q.selectionType === "SINGLE" && correct.length === 1;
      // Options in the learner's language (a question on what the text says) go to the locale file
      // together, read as one.
      let options = alts.map((a, i) => option(ctx, state, a, i, image));
      const texts = options.flatMap((o) => (o.text ? [o.text] : []));
      if (texts.length && ctx.learnerText(texts.join(" "))) {
        locale.options = Object.fromEntries(
          options.flatMap((o) => (o.text ? [[o.id, o.text]] : [])),
        );
        options = options.map(({ text: _, ...o }) => o);
      }
      return {
        type: single ? "single_choice" : "multi_choice",
        item: { ...base, options, answer: { optionIds: correct } },
        locale,
      };
    }
    case "SORTING": {
      const alts = refs(state, q.alternatives);
      const parts = alts.map((a, i) => option(ctx, state, a, i, image));
      const placed = alts.map((a, i) => ({ order: Number(a.order), id: optionId(i) }));
      if (placed.some((p) => !Number.isFinite(p.order)))
        throw new Unmapped("sorting part without its place");
      const sequence = placed.sort((a, b) => a.order - b.order).map((p) => p.id);
      const join = q.sortingType === "MERGE" ? "none" : "space";
      return { type: "order", item: { ...base, parts, join, answer: { sequence } }, locale };
    }
    case "CLOZE": {
      const text =
        q.clozeLayoutType === "CONTINUOUS_TEXT"
          ? plainLines(q.text)
          : subs.map((s) => plainText(s.inquiryText)).join("\n");
      const segs = segments(text, subs.length);
      const gap = (i: number) => `g${i + 1}`;
      const kind = subs[0]?.clozeType;
      const alts = subs.map((s) => refs(state, s.alternatives));
      if (kind === "WRITING") {
        const answer = Object.fromEntries(
          alts.map((a, i) => {
            const accepted = a.filter((x) => x.isCorrect).map((x) => plainText(x.alternativeText));
            if (!accepted.length) throw new Unmapped(`gap ${gap(i)} without an accepted answer`);
            return [gap(i), { accepted }];
          }),
        );
        return { type: "gap_text", item: { ...base, segments: segs, answer }, locale };
      }
      if (kind === "CHOOSE") {
        const bank = alts.map((a, i) => {
          const text = plainText(a.find((x) => x.isCorrect)?.alternativeText);
          if (!text) throw new Unmapped(`gap ${gap(i)} without its word`);
          return { id: optionId(i), text };
        });
        const gaps = Object.fromEntries(alts.map((_, i) => [gap(i), { options: bank }]));
        const answer = Object.fromEntries(alts.map((_, i) => [gap(i), optionId(i)]));
        return {
          type: "gap_choice",
          item: { ...base, segments: segs, gaps, display: "bank", answer },
          locale,
        };
      }
      if (kind === "PULLDOWN") {
        const gaps = Object.fromEntries(
          alts.map((a, i) => [
            gap(i),
            { options: a.map((x, j) => option(ctx, state, x, j, false)) },
          ]),
        );
        const answer = Object.fromEntries(
          alts.map((a, i) => {
            const right = a.findIndex((x) => x.isCorrect);
            if (right < 0) throw new Unmapped(`gap ${gap(i)} without a correct option`);
            return [gap(i), optionId(right)];
          }),
        );
        return {
          type: "gap_choice",
          item: { ...base, segments: segs, gaps, display: "dropdown", answer },
          locale,
        };
      }
      throw new Unmapped(`cloze type ${String(kind)}`);
    }
    case "REPEAT": {
      const text = german(state, subs[0]?.inquiryText);
      const task = plainText(subs[0]?.inquiryDescription);
      return {
        type: "speech_selfrate",
        item: { ...base, ...(text ? { text } : {}) },
        locale: { ...locale, ...(task ? { prompt: task } : {}) },
      };
    }
    case "DICTATION": {
      // What is written down is what is heard: the main recording, else the only one.
      const heard = audio ?? answerAudio;
      if (!heard) throw new Unmapped("dictation audio not downloaded");
      const { answerAudio: _, ...rest } = base;
      return {
        type: "dictation",
        item: {
          ...(audio ? base : rest),
          media: { ...(base.media as object), audio: heard },
          answer: { accepted: [plainText(q.text)] },
        },
        locale,
      };
    }
    default:
      throw new Unmapped(`inquiry type ${String(q.inquiryType)}`);
  }
}

export interface NormalisedExercise {
  exercise: Exercise;
  locale: LocaleExercise;
  /** Reason when the exercise became `unknown`. */
  unmapped?: string;
}

export function normaliseExercise(
  ctx: Context,
  state: ApolloState,
  sourceId: number,
  key: ExerciseKey,
  rawPath: string,
): NormalisedExercise {
  const ex = state[`Exercise:${sourceId}`];
  if (!ex) throw new Error(`exercise ${sourceId} missing in its page`);
  const stimulus = media({
    video: ex.inputType === "VIDEO" ? videoPaths(ctx, refs(state, ex.videos)[0]).sd : undefined,
    image:
      ex.inputType === "IMAGE"
        ? imagePath(ctx, state, ex.mainContentImage ?? refs(state, ex.images)[0])
        : undefined,
    audio: ex.inputType === "AUDIO" ? audioPath(ctx, state, ex) : undefined,
  });
  const textHtml = html(ctx, ex.inputText);
  const instructionHtml = html(ctx, ex.description);
  const locale: LocaleExercise = {
    sourceId: String(sourceId),
    // An exercise without a name gives no title (the player numbers it; "" would not validate).
    ...(plainText(ex.name) ? { title: plainText(ex.name) } : {}),
    ...(instructionHtml ? { instructionHtml } : {}),
    ...(textHtml ? { textHtml } : {}),
    items: {},
  };
  const common = { key, newWords: [], ruleIds: [], ...(stimulus ? { media: stimulus } : {}) };
  try {
    const mapped = refs(state, ex.inquiries).map((q) => mapItem(ctx, state, q));
    const types = new Set(mapped.map((m) => m.type));
    if (types.size !== 1) throw new Unmapped(`items of different types: ${[...types].join(", ")}`);
    mapped.forEach((m, i) => {
      if (Object.keys(m.locale).length) locale.items[`#${i + 1}`] = m.locale;
    });
    const items = mapped.map((m, i) => ({ key: itemKey(key, i + 1), ...m.item }));
    const type = mapped[0]?.type;
    if (!type) throw new Unmapped("no items");
    return { exercise: draftExercise({ ...common, type, items }), locale };
  } catch (error) {
    if (!(error instanceof Unmapped)) throw error;
    return {
      exercise: unknownExercise(common, rawPath, error.message),
      locale,
      unmapped: error.message,
    };
  }
}
