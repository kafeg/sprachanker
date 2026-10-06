// A DW lesson (lesson page, download page, exercise pages) → canonical lesson + locale lesson.
import { plainText, vocabEntries } from "@sprachanker/course-kit";
import {
  exerciseKey,
  type GoalKey,
  type Lesson,
  type LessonKey,
  type LocaleLesson,
  lessonGoalKey,
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
  order: number;
  sourceId: number;
  edition: LocaleLesson["edition"];
  /** `raw/<edition>/<course>` inside the series folder. */
  rawDir: string;
  lesson: ApolloState;
  downloads: ApolloState;
  exercises: Map<number, ApolloState>;
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

function tab(ctx: Context, k: Entity | undefined) {
  return k
    ? { sourceId: String(k.id), title: plainText(k.name), bodyHtml: html(ctx, k.text) ?? "" }
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

  const exercises = exerciseIds(state, src.sourceId).map((id, i) => {
    const page = src.exercises.get(id);
    if (!page) throw new Error(`exercise page e-${id} missing`);
    return {
      id,
      ...normaliseExercise(
        ctx,
        page,
        id,
        exerciseKey(src.key, i + 1),
        `${src.rawDir}/e-${id}.json`,
      ),
    };
  });

  const { vocab, translations } = vocabEntries(
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
    parts
      .filter((p) => p.lessonPart === kind)
      .map((p) => tab(ctx, knowledge(p.targetId)))
      .filter((t) => !!t);
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
      order: src.order,
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
      unmapped: exercises.flatMap((e) =>
        e.unmapped ? [{ path: `${src.rawDir}/e-${e.id}.json`, reason: e.unmapped }] : [],
      ),
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
