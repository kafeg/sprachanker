// What the normaliser needs besides the page states: where downloaded media live.

import { inLearnerLanguage, mediaPath, sanitizeCourseHtml } from "@sprachanker/course-kit";
import {
  type EditionId,
  type Media,
  type MediaIndex,
  type MediaPath,
  parseEditionId,
} from "@sprachanker/schema";
import type { ApolloState } from "../apollo.ts";
import { imageUrl, videoFiles } from "../media.ts";
import { writtenOrder } from "./text.ts";

export type Entity = Record<string, unknown>;

export interface Context {
  /** Media path of a downloaded URL. */
  media(url: string | undefined): MediaPath | undefined;
  /** Whether a text of the page is in the edition's learner language (its locale file's), not German. */
  learnerText(text: string): boolean;
  /** A text (a title, a note, a prompt, an option) as written: right-to-left editions keep some in
   *  the order they are seen (`writtenOrder`). */
  written(text: string): string;
}

/** Learner languages DW's right-to-left editions are in. */
const RIGHT_TO_LEFT = new Set(["ar", "fa"]);

/** `edition`: the course's language pair ("ru-de"): German taught in Russian. */
export function createContext(index: MediaIndex, edition: EditionId): Context {
  const { source, target } = parseEditionId(edition);
  return {
    media: (url) => mediaPath(index, url),
    learnerText: (text) => inLearnerLanguage(text, target, source),
    written: (text) => (RIGHT_TO_LEFT.has(source) ? writtenOrder(text) : text),
  };
}

/** Resolves `{ __ref }` links of the Apollo cache. */
export const deref = (state: ApolloState, value: unknown): Entity | undefined =>
  value && typeof value === "object" && "__ref" in value
    ? state[String((value as { __ref: string }).__ref)]
    : (value as Entity | undefined);

export const refs = (state: ApolloState, values: unknown): Entity[] =>
  ((values ?? []) as unknown[]).map((v) => deref(state, v)).filter((v): v is Entity => !!v);

export function imagePath(ctx: Context, state: ApolloState, image: unknown): MediaPath | undefined {
  const url = deref(state, image)?.staticUrl;
  return typeof url === "string" ? ctx.media(imageUrl(url)) : undefined;
}

/** The audio links of an entity (`contentLinks(... AUDIO)`). */
function audioLinks(state: ApolloState, entity: Entity) {
  const linkKey = Object.keys(entity).find(
    (k) => k.startsWith("contentLinks(") && k.includes("AUDIO"),
  );
  return refs(state, linkKey ? entity[linkKey] : []);
}

/** An exercise item's recordings: what it asks with (its main content: `mainContent` not false)
 *  and the source's answer, spoken (a link that is not main content: DW's "Lösungsaudio", most items'
 *  only recording — heard before the item is answered, it gives the answer away). */
export function itemAudioPaths(ctx: Context, state: ApolloState, entity: Entity) {
  const links = audioLinks(state, entity);
  const path = (link: Entity | undefined) => {
    const src = (link?.target as Entity | undefined)?.mp3Src;
    return typeof src === "string" ? ctx.media(src) : undefined;
  };
  return {
    // Without links, its `audios` (as audioPath reads them).
    audio: links.length
      ? path(links.find((l) => l.mainContent !== false))
      : audiosPath(ctx, state, entity),
    answerAudio: path(links.find((l) => l.mainContent === false)),
  };
}

function audiosPath(ctx: Context, state: ApolloState, entity: Entity) {
  for (const audio of refs(state, entity.audios))
    if (typeof audio.mp3Src === "string") return ctx.media(audio.mp3Src);
  return undefined;
}

/** First audio linked from an entity (`contentLinks(... AUDIO)` or `audios`). */
export function audioPath(ctx: Context, state: ApolloState, entity: Entity): MediaPath | undefined {
  for (const link of audioLinks(state, entity)) {
    const src = (link.target as Entity | undefined)?.mp3Src;
    if (typeof src === "string") return ctx.media(src);
  }
  return audiosPath(ctx, state, entity);
}

export function videoPaths(ctx: Context, video: Entity | undefined) {
  const files = video ? videoFiles(video) : {};
  return { sd: ctx.media(files.sd), hd: ctx.media(files.hd) };
}

/** Media object without empty fields. */
export function media(
  parts: Partial<Record<keyof Media, MediaPath | undefined>>,
): Media | undefined {
  const entries = Object.entries(parts).filter(([, v]) => v);
  return entries.length ? (Object.fromEntries(entries) as Media) : undefined;
}

/** Course HTML: allow-listed, DW images rewritten to media paths, credit lines dropped. */
export function html(ctx: Context, value: unknown): string | undefined {
  const text = sanitizeCourseHtml(String(value ?? ""), {
    image: (a) => (a["data-url"] ? ctx.media(imageUrl(a["data-url"])) : undefined),
    drop: (tag, a) => tag === "small" && (a.class ?? "").includes("copyright"),
  });
  return text ? text : undefined;
}
