// What the normaliser needs besides the page states: where downloaded media live.

import { type MediaIndex, mediaPath, sanitizeCourseHtml } from "@sprachanker/course-kit";
import type { Media, MediaPath } from "@sprachanker/schema";
import type { ApolloState } from "../apollo.ts";
import { IMAGE_FORMAT, videoFiles } from "../media.ts";

export type Entity = Record<string, unknown>;

export interface Context {
  /** Media path of a downloaded URL. */
  media(url: string | undefined): MediaPath | undefined;
}

export function createContext(index: MediaIndex): Context {
  return {
    media: (url) => mediaPath(index, url),
  };
}

/** Resolves `{ __ref }` links of the Apollo cache. */
export const deref = (state: ApolloState, value: unknown): Entity | undefined =>
  value && typeof value === "object" && "__ref" in value
    ? state[String((value as { __ref: string }).__ref)]
    : (value as Entity | undefined);

export const refs = (state: ApolloState, values: unknown): Entity[] =>
  ((values ?? []) as unknown[]).map((v) => deref(state, v)).filter((v): v is Entity => !!v);

/** `static.dw.com/image/<id>_${formatId}.<ext>` → the downloaded size. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: DW's literal URL template placeholder.
const imageUrl = (template: string) => template.replace("${formatId}", IMAGE_FORMAT);

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

/** The audio of an entity's answer: the link besides its main one (a speaking exercise's
 *  "Lösungsaudio" after its question). */
export function answerAudioPath(ctx: Context, state: ApolloState, entity: Entity) {
  const links = audioLinks(state, entity);
  if (links.length < 2) return undefined;
  const src = (links.find((l) => l.mainContent === false)?.target as Entity | undefined)?.mp3Src;
  return typeof src === "string" ? ctx.media(src) : undefined;
}

/** First audio linked from an entity (`contentLinks(... AUDIO)` or `audios`). */
export function audioPath(ctx: Context, state: ApolloState, entity: Entity): MediaPath | undefined {
  for (const link of audioLinks(state, entity)) {
    const src = (link.target as Entity | undefined)?.mp3Src;
    if (typeof src === "string") return ctx.media(src);
  }
  for (const audio of refs(state, entity.audios)) {
    if (typeof audio.mp3Src === "string") return ctx.media(audio.mp3Src);
  }
  return undefined;
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
