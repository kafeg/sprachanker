// Profile settings (05): every key with its schema, and who writes it. The learner's preferences go
// through the generic settings route; the others only through the service that owns them (the
// assistant's endpoints and prompts), so the generic route cannot change them. Values are checked
// when written and parsed when read: a stored value that no longer fits is read as unset.
import { z } from "zod";
import { CourseSlug, SeriesKey } from "./keys.ts";
import { EditionId, Lang } from "./lang.ts";
import { CardFace } from "./learner.ts";

const filter = z.string().min(1).max(200);

/** Preferences the learner sets (the settings route). */
export const LEARNER_SETTINGS = {
  uiLanguage: Lang,
  /** The learner's own language (explanations, translations) and the one learnt: they filter the
   *  courses (set by the onboarding). */
  "learner.native": Lang,
  "learner.target": Lang,
  theme: z.enum(["system", "light", "dark"]),
  /** Playback speed of course audio. */
  audioRate: z.number().min(0.25).max(2),
  /** The filters of All courses and My courses: a course title or a language pair, or "all". */
  "catalog.course": filter,
  "catalog.pair": filter,
  "mine.course": filter,
  "mine.pair": filter,
  /** The deck Review opens on (a deck scope: `lang:de`, `course:…`). */
  "review.deck": z.string().min(1).max(400),
  /** Shows the prompt behind each AI answer. */
  "llm.debugPrompts": z.boolean(),
  /** Anki's deck options (04). */
  "srs.newPerDay": z.number().int().min(0).max(9999),
  "srs.reviewsPerDay": z.number().int().min(0).max(9999),
  "srs.retention": z.number().min(0.7).max(0.99),
  "srs.faces": z.array(CardFace).min(1),
} as const;

/** Settings written only by the service that owns them. */
export const SERVICE_SETTINGS = {
  /** Endpoint URLs of the providers that let the learner set one, by provider id. */
  "llm.endpoints": z.record(z.string(), z.url()),
  /** The learner's own system prompts, by task. */
  "llm.prompts": z.record(z.string(), z.string().max(20_000)),
  /** New cards added to today's limit of some decks (Anki's custom study), for the study day that
   *  starts at `day`; another day reads as none. */
  "srs.extraNew": z.object({
    day: z.number(),
    scopes: z.record(z.string(), z.number().int().min(0).max(9999)),
  }),
} as const;

/** The edition chosen for a course: `edition:<series>/<course>`. */
export const editionSetting = (series: string, course: string) => `edition:${series}/${course}`;
const EDITION_KEY = /^edition:([^/]+)\/(.+)$/;

type Learner = typeof LEARNER_SETTINGS;
type Service = typeof SERVICE_SETTINGS;
export type SettingKey = keyof Learner | keyof Service;
export type SettingValue<K extends SettingKey> = K extends keyof Learner
  ? z.infer<Learner[K]>
  : K extends keyof Service
    ? z.infer<Service[K]>
    : never;

/** The schema of a key the learner may set, or undefined for any other key. */
export function learnerSettingSchema(key: string): z.ZodType | undefined {
  if (Object.hasOwn(LEARNER_SETTINGS, key)) return LEARNER_SETTINGS[key as keyof Learner];
  const edition = EDITION_KEY.exec(key);
  if (
    edition &&
    SeriesKey.safeParse(edition[1]).success &&
    CourseSlug.safeParse(edition[2]).success
  )
    return EditionId;
  return undefined;
}

/** The schema of any stored key (learner's or a service's), or undefined for an unknown key. */
export function settingSchema(key: string): z.ZodType | undefined {
  if (Object.hasOwn(SERVICE_SETTINGS, key)) return SERVICE_SETTINGS[key as keyof Service];
  return learnerSettingSchema(key);
}
