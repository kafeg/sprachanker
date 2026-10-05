// A DW lesson (lesson page, download page, exercise pages) → canonical lesson + locale lesson.
import {
  exerciseKey,
  type GoalKey,
  type Lesson,
  type LessonKey,
  type LocaleLesson,
  lemmaSlug,
  lessonGoalKey,
  lexemeKey,
  type UnitKey,
  type VocabEntry,
  vocabKey,
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
import { plainText } from "./text.ts";
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

  const seen = new Map<string, number>();
  const vocab: VocabEntry[] = [];
  const translations: LocaleLesson["vocab"] = {};
  for (const k of refs(state, L.knowledges).filter((k) => k.knowledgeType === "VOCABULARY")) {
    const head = parseHeadword(plainText(k.name), plainText(k.subTitle));
    const slug = lemmaSlug(head.lemma);
    if (!slug) continue;
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    const key = vocabKey(src.key, head.lemma, n);
    const audio = audioPath(ctx, state, k);
    const img = imagePath(ctx, state, k.mainContentImage);
    vocab.push({
      key,
      lexeme: lexemeKey("de", head.lemma, head.pos, head.gender),
      target: plainText(k.name),
      ...(head.gender ? { gender: head.gender } : {}),
      ...(head.plural ? { plural: head.plural } : {}),
      ...(head.forms ? { forms: head.forms } : {}),
      ...(head.note ? { note: head.note } : {}),
      ...(audio ? { audio } : {}),
      ...(img ? { image: img } : {}),
    });
    const translation = plainText(k.text);
    if (translation) translations[key] = { translation };
  }

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
