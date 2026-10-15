// Profile settings: every key with its schema, and who writes it. The learner's preferences go
// through the generic settings route; the others only through the service that owns them (the
// assistant's endpoints and prompts), so the generic route cannot change them. Values are checked
// when written and parsed when read: a stored value that no longer fits is read as unset.
import { z } from "zod";
import { FederalState } from "./exam.ts";
import { SeriesKey, Slug } from "./keys.ts";
import { EditionId, Lang } from "./lang.ts";
import { CardFace } from "./learner.ts";

/** A profile's tile colour ("Who is studying?"; design tokens of the web app). */
export const ProfileColour = z.enum(["amber", "teal", "rose", "violet", "sky", "lime"]);
export type ProfileColour = z.infer<typeof ProfileColour>;

/** The longest a profile's name may be. */
export const PROFILE_NAME_MAX = 40;

/** A new profile's colour: the first one used least by the profiles there are (a freed colour first,
 *  then round again). */
export function nextProfileColour(used: readonly ProfileColour[]): ProfileColour {
  const count = (c: ProfileColour) => used.filter((u) => u === c).length;
  return ProfileColour.options.reduce((best, c) => (count(c) < count(best) ? c : best));
}

/** Where the AI assistant works, each of which the learner can turn off: "Why is this wrong?", the
 *  tutor (with going over mistakes in the lesson's summary), Understanding (Reading and Listening),
 *  Writing, Speaking (`scene`, the key of the Dialogue it replaced), the check of an answer said
 *  aloud, a word's examples, an exam's open answer rated by its criteria. */
export const AI_PLACES = [
  "explain",
  "tutor",
  "understanding",
  "writing",
  "scene",
  "speaking",
  "example",
  "exam",
] as const;
export type AiPlace = (typeof AI_PLACES)[number];

const filter = z.string().min(1).max(200);

/** Preferences the learner sets (the settings route). */
export const LEARNER_SETTINGS = {
  uiLanguage: Lang,
  /** The federal state whose questions the Leben in Deutschland test asks (unset: asked when the
   *  exam starts). */
  "exam.federalState": FederalState,
  theme: z.enum(["system", "light", "dark"]),
  /** Playback speed of course audio. */
  audioRate: z.number().min(0.25).max(2),
  /** The filters of each Courses tab (My courses: mine, Downloaded, Available: catalog), set only from
   *  their filter bar: a course title or a language pair, or "all" (unset: everything). */
  "catalog.course": filter,
  "catalog.pair": filter,
  "downloaded.course": filter,
  "downloaded.pair": filter,
  "mine.course": filter,
  "mine.pair": filter,
  /** The deck Review opens on (a deck scope: `lang:de`, `course:…`). */
  "review.deck": z.string().min(1).max(400),
  /** Shows the prompt behind each AI answer. */
  "llm.debugPrompts": z.boolean(),
  /** The places the assistant is turned off in (none by default): they are not shown. */
  "llm.offIn": z.array(z.enum(AI_PLACES)).max(AI_PLACES.length),
  /** What is experimental and turned on (Settings → General → Experimental; owner, 2026-10-10): a section
   *  (`courses`, `exams`) and within it each source by its series (`courses:coerll.dib`). */
  "experimental.on": z.array(z.string().min(1).max(120)).max(200),
  /** The Review settings. */
  "srs.newPerDay": z.number().int().min(0).max(9999),
  "srs.reviewsPerDay": z.number().int().min(0).max(9999),
  "srs.retention": z.number().min(0.7).max(0.99),
  "srs.faces": z.array(CardFace).min(1),
  /** Speech recognition used when the engine and a model are there (on by default), and the model. */
  "speech.recognition": z.boolean(),
  "speech.model": z.string().min(1).max(100),
  /** Reading aloud: the engine (the device's voices, Piper or Qwen3-TTS on the server), Qwen3-TTS's
   *  model (none: the large one when it is there), the voice chosen per engine and language (none: the
   *  best one there), the speed. */
  "speech.readEngine": z.enum(["device", "piper", "qwen"]),
  "speech.qwenModel": z.string().min(1).max(100),
  "speech.voices": z.record(z.string().max(40), z.record(z.string().max(40), z.string().max(400))),
  "speech.readRate": z.number().min(0.5).max(1.5),
} as const;

/** Settings written only by the service that owns them. */
const SERVICE_SETTINGS = {
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

/** The server's own settings (`server.sqlite`, `server_settings`), set by the command line. */
export const SERVER_SETTINGS = {
  /** New profiles may be made from "Who is studying?" (on by default). */
  registration: z.boolean(),
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

/** What a preference is while the learner has not set it — the one place both the server and the web
 *  read it from (Anki's deck options among them, as Anki has them). */
export const SETTING_DEFAULTS = {
  theme: "system",
  audioRate: 1,
  "llm.debugPrompts": false,
  "llm.offIn": [],
  "experimental.on": [],
  "speech.recognition": true,
  "speech.readEngine": "qwen",
  "speech.readRate": 1,
  "srs.faces": ["recognition", "production"],
  "srs.newPerDay": 20,
  "srs.reviewsPerDay": 200,
  "srs.retention": 0.9,
} as const satisfies { [K in keyof Learner]?: SettingValue<K> };
export type LearnerSettingKey = keyof Learner;
/** A preference as read: its value, or its default where it has one. */
export type SettingRead<K extends LearnerSettingKey> = K extends keyof typeof SETTING_DEFAULTS
  ? SettingValue<K>
  : SettingValue<K> | undefined;

/** A preference read from stored values, with its default. */
export const settingOf = <K extends LearnerSettingKey>(
  stored: Record<string, unknown> | undefined,
  key: K,
): SettingRead<K> =>
  (stored?.[key] ?? (SETTING_DEFAULTS as Record<string, unknown>)[key]) as SettingRead<K>;

/** The schema of a key the learner may set, or undefined for any other key. */
export function learnerSettingSchema(key: string): z.ZodType | undefined {
  if (Object.hasOwn(LEARNER_SETTINGS, key)) return LEARNER_SETTINGS[key as keyof Learner];
  const edition = EDITION_KEY.exec(key);
  if (edition && SeriesKey.safeParse(edition[1]).success && Slug.safeParse(edition[2]).success)
    return EditionId;
  return undefined;
}

/** The schema of any stored key (learner's or a service's), or undefined for an unknown key. */
export function settingSchema(key: string): z.ZodType | undefined {
  if (Object.hasOwn(SERVICE_SETTINGS, key)) return SERVICE_SETTINGS[key as keyof Service];
  return learnerSettingSchema(key);
}
