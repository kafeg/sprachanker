// A DW lesson (lesson page, download page, exercise pages) → canonical lesson + locale lesson.
import {
  boldLinesAsHeadings,
  occurrences,
  plainText,
  skippedWords,
  vocabEntries,
} from "@sprachanker/course-kit";
import {
  exerciseKey,
  type GoalKey,
  type Lesson,
  type LessonKey,
  type LocaleLesson,
  lessonGoalKey,
  type Tab,
  type UnitKey,
} from "@sprachanker/schema";
import { type ApolloState, entitiesOf, exerciseIds } from "../apollo.ts";
import {
  audioPath,
  type Context,
  deref,
  type Entity,
  html,
  imagePath,
  refs,
  videoPaths,
} from "./context.ts";
import { normaliseExercise } from "./exercise.ts";
import { parseHeadword } from "./vocab.ts";

export interface LessonSource {
  key: LessonKey;
  unit: UnitKey;
  sourceId: number;
  edition: LocaleLesson["edition"];
  /** `raw/<edition>/<course>` inside the series folder. */
  rawDir: string;
  lesson: ApolloState;
  downloads: ApolloState;
  exercises: Map<number, ApolloState>;
  /** An exercise's number in the lesson: its own by source id (`<id>`, a repeat `<id>.<n>`), else
   *  its place (the key map). */
  exerciseNumber(occurrence: string, position: number): number;
}

export interface NormalisedLesson {
  lesson: Lesson;
  locale: LocaleLesson;
  /** Goal texts for the locale course file. */
  goals: Record<GoalKey, string>;
}

const listItems = (value: unknown) =>
  [...String(value ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)]
    .map((m) => plainText(m[1]))
    .filter(Boolean);

/** "Spelling (2)": DW numbers the parts of a topic that runs over several pages and lessons, in the
 *  edition's own digits ("(۲)" in Persian, "(२)" in Hindi) and brackets ("（2）" in Chinese). */
const PART = /\s*[(（](\p{Nd}+)[)）]\s*$/u;

/** A topic's title as compared: full-width forms as plain ones, spaces ignored ("被动态 （1）" and
 *  "第二虚拟式: 请求" are the same topics as "被动态（2）" and "第二虚拟式：请求"). */
const topicOf = (title: string) => title.normalize("NFKC").replace(/\s+/g, "");

/** A number written in any script's decimal digits: each digit's value is its distance from the
 *  zero of its run of ten (Unicode keeps them in order). */
function digitsValue(digits: string) {
  let n = 0;
  for (const d of digits) {
    let zero = d.codePointAt(0) as number;
    while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--;
    n = n * 10 + (((d.codePointAt(0) as number) - zero) % 10);
  }
  return n;
}

/**
 * A lesson's grammar or culture pages as one page per topic: the parts of a topic in this lesson
 * (numbered "(1)", "(2)", or bearing the same title) are joined in order; the number leaves the title
 * and stays as `part` when the topic began in an earlier lesson.
 */
export function topicParts(pages: Tab[]): Tab[] {
  const byTitle = new Map<string, { page: Tab; first?: number }>();
  for (const page of pages) {
    const match = PART.exec(page.title);
    const title = page.title.replace(PART, "");
    const n = match ? digitsValue(match[1] as string) : undefined;
    const topic = byTitle.get(topicOf(title));
    if (topic) {
      topic.page.bodyHtml += page.bodyHtml;
      continue;
    }
    byTitle.set(topicOf(title), { page: { ...page, title }, first: n });
  }
  return [...byTitle.values()].map(({ page, first }) =>
    first && first > 1 ? { ...page, part: first } : page,
  );
}

/** A grammar or culture page; its bold-only lines are its sections' titles (shown as cards, 09). */
function tab(ctx: Context, k: Entity | undefined) {
  return k
    ? {
        sourceId: String(k.id),
        title: plainText(k.name),
        bodyHtml: boldLinesAsHeadings(html(ctx, k.text) ?? ""),
      }
    : undefined;
}

export function normaliseLesson(ctx: Context, src: LessonSource): NormalisedLesson {
  const state = src.lesson;
  const L = state[`Lesson:${src.sourceId}`];
  if (!L) throw new Error(`lesson ${src.sourceId} missing in its page`);

  const video = refs(state, L.videos).find((v) => !String(v.name ?? "").includes("Untertitel"));
  const { sd, hd } = videoPaths(ctx, video);
  const subtitleUrl = (video?.subtitles as Array<{ subtitleUrl?: string }> | undefined)?.[0]
    ?.subtitleUrl;
  const subtitles = ctx.media(subtitleUrl);
  const image = imagePath(ctx, state, L.mainContentImage);
  const audio = ctx.media(refs(state, L.audios)[0]?.mp3Src as string | undefined);

  const goalTexts = listItems(L.learningTargetDescription);
  const goals = goalTexts.map((_, i) => lessonGoalKey(src.key, i + 1));

  // Keys follow the source's order the first time and stay by source id (a missing page keeps its
  // number — taken even while it is missing — one inserted takes a new one), so the others never
  // shift. An exercise the lesson lists twice is numbered per occurrence.
  const gone: Array<{ path: string; reason: string }> = [];
  const occurrence = occurrences();
  const exercises = exerciseIds(state, src.sourceId).flatMap((id, i) => {
    const number = src.exerciseNumber(occurrence(String(id)), i + 1);
    const page = src.exercises.get(id);
    if (!page) {
      gone.push({ path: `${src.rawDir}/e-${id}.json`, reason: "exercise page gone at the source" });
      return [];
    }
    // A page that comes without its exercise (DW answers with an empty content for it, seen in the
    // Persian A1): the exercise is not there in this edition.
    if (!page[`Exercise:${id}`]) {
      gone.push({
        path: `${src.rawDir}/e-${id}.json`,
        reason: "exercise not in its page at the source",
      });
      return [];
    }
    return {
      id,
      ...normaliseExercise(
        ctx,
        page,
        id,
        exerciseKey(src.key, number),
        `${src.rawDir}/e-${id}.json`,
      ),
    };
  });

  const { vocab, translations, skipped } = vocabEntries(
    src.key,
    "de",
    refs(state, L.knowledges)
      .filter((k) => k.knowledgeType === "VOCABULARY")
      .map((k) => ({
        head: parseHeadword(plainText(k.name), plainText(k.subTitle)),
        target: plainText(k.name),
        audio: audioPath(ctx, state, k),
        image: imagePath(ctx, state, k.mainContentImage),
        translation: plainText(k.text) || undefined,
      })),
  );

  const parts = (L.overviewParts ?? []) as Array<{ lessonPart: string; targetId: number }>;
  const knowledge = (id: number) => state[`Knowledge:${id}`];
  const tabsOf = (kind: string) =>
    topicParts(
      parts
        .filter((p) => p.lessonPart === kind)
        .map((p) => tab(ctx, knowledge(p.targetId)))
        .filter((t) => !!t),
    );
  const scriptHtml = html(ctx, L.manuscript);

  const downloads = entitiesOf(src.downloads, "ContentLink").flatMap((link) => {
    const target = deref(src.downloads, link.target);
    if (link.targetType !== "DOWNLOAD" || typeof target?.filename !== "string") return [];
    const path = ctx.media(
      `https://static.dw.com/downloads/${link.targetId}/${target.filename.toLowerCase()}`,
    );
    return path ? [{ title: plainText(link.name), path }] : [];
  });

  const synopsisHtml = html(ctx, L.description);
  return {
    lesson: {
      format: 1,
      key: src.key,
      unit: src.unit,
      media: {
        ...(sd || hd
          ? {
              video: {
                ...(sd ? { sd } : {}),
                ...(hd ? { hd } : {}),
                ...(subtitles ? { subtitles } : {}),
              },
            }
          : {}),
        ...(image ? { image } : {}),
        ...(audio ? { audio } : {}),
      },
      goals,
      pages: exercises.map((e) => ({ exercise: e.exercise })),
      vocab,
      unmapped: [
        ...skippedWords(`${src.rawDir}/l-${src.sourceId}.json`, skipped),
        ...gone,
        ...exercises.flatMap((e) =>
          e.unmapped ? [{ path: `${src.rawDir}/e-${e.id}.json`, reason: e.unmapped }] : [],
        ),
      ],
    },
    locale: {
      format: 1,
      edition: src.edition,
      lesson: src.key,
      sourceId: String(src.sourceId),
      title: plainText(L.name),
      ...(synopsisHtml ? { synopsisHtml } : {}),
      exercises: Object.fromEntries(exercises.map((e) => [e.exercise.key, e.locale])),
      vocab: translations,
      tabs: {
        grammar: tabsOf("GRAMMAR"),
        culture: tabsOf("REGIONAL_STUDIES"),
        ...(scriptHtml ? { script: { title: "", bodyHtml: scriptHtml } } : {}),
      },
      downloads,
    },
    goals: Object.fromEntries(goals.map((g, i) => [g, goalTexts[i] as string])),
  };
}
