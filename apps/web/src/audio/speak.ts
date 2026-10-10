// What reading aloud says and with which voice (08): text made speakable (a model's Markdown), a text
// mixing two languages split into the parts each voice reads — or kept whole for an engine whose one
// voice speaks them all — and the best voice of a language among those there are. Pure: tested
// without a browser.

/** A piece of text to read in one language; `langs`: the languages it mixes, when it is read whole. */
export interface SpokenPart {
  text: string;
  lang: string;
  langs?: string[];
}

/** Parts read as one text by one voice (Qwen3-TTS: its speakers speak every language and tell them
 *  apart within a text), in the language most of it is in. */
export function asOneText(parts: SpokenPart[]): SpokenPart[] {
  if (parts.length < 2) return parts;
  const share = new Map<string, number>();
  for (const p of parts) share.set(p.lang, (share.get(p.lang) ?? 0) + p.text.length);
  const lang = [...share].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (parts[0] as SpokenPart).lang;
  return [{ text: parts.map((p) => p.text).join(" "), lang, langs: [...share.keys()] }];
}

/** A text in one language as parts to read: none while the language is not known. */
export const said = (text: string, lang: string | undefined): SpokenPart[] =>
  lang && text.trim() ? [{ text: text.trim(), lang }] : [];

/** What a voice offers that choosing one needs (a `SpeechSynthesisVoice`, or a server's voice). */
export interface VoiceInfo {
  /** The voice's id: what the profile keeps when the learner picks it. */
  id: string;
  name: string;
  /** BCP 47, as the engine gives it ("de-DE", "de_DE"). */
  lang: string;
  /** Runs on this device (not a network voice). */
  local?: boolean;
}

/** Text of a model's Markdown as it is said: no markup, links as their text, arrows as pauses. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|`|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/[→⟶⇒]/g, ", ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** The script a language is written in (`Latn`, `Cyrl`, …), as the browser knows it. */
function scriptOf(lang: string): string | undefined {
  try {
    const script = new Intl.Locale(lang).maximize().script;
    // Chinese: the property names the script Han whatever its form.
    return script === "Hans" || script === "Hant" ? "Hani" : script;
  } catch {
    return undefined;
  }
}

const HAS_WORD = /[\p{L}\p{N}]/u;

/** A run in another language than the text's main one is read by its own voice from this many words:
 *  a word or two quoted ("слово Hund значит собака") stays with the text around it, so the voice does
 *  not change every few words. */
const OWN_VOICE_WORDS = 3;
const WORDS = /[\p{L}\p{N}]+/gu;

/**
 * A text in parts, each read in its language: where the two languages are written in different
 * scripts (Russian and German), each run of one script is the language written in it — a run in
 * another language than `main` of fewer than three words stays with the text around it; characters
 * of neither (spaces, digits, punctuation) stay with the run they are in. Otherwise the whole text is
 * one part in `main`.
 */
export function splitByScript(text: string, langs: string[], main: string): SpokenPart[] {
  const byScript = new Map<string, string>();
  for (const lang of langs) {
    const script = scriptOf(lang);
    if (script && !byScript.has(script)) byScript.set(script, lang);
  }
  const whole = text.trim();
  if (!whole) return [];
  if (byScript.size < 2) return [{ text: whole, lang: main }];
  const tests = [...byScript].map(([script, lang]) => ({
    lang,
    test: new RegExp(`\\p{Script=${script}}`, "u"),
  }));
  const parts: SpokenPart[] = [];
  let lang: string | undefined;
  let run = "";
  for (const char of whole) {
    const own = tests.find((t) => t.test.test(char))?.lang;
    if (own && lang && own !== lang) {
      parts.push({ text: run, lang });
      run = "";
    }
    if (own) lang = own;
    run += char;
  }
  parts.push({ text: run, lang: lang ?? main });
  // Short runs in another language join the main language's text; then runs of one language join.
  const joined: SpokenPart[] = [];
  for (const p of parts) {
    const words = p.text.match(WORDS)?.length ?? 0;
    const own = p.lang !== main && words < OWN_VOICE_WORDS ? main : p.lang;
    const last = joined[joined.length - 1];
    if (last && last.lang === own) last.text += p.text;
    else joined.push({ text: p.text, lang: own });
  }
  // Text before the first letter belongs to the first part; a part with no word in it is not said.
  return joined.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => HAS_WORD.test(p.text));
}

/** "de_DE" → "de-de": a voice's language comparable to a language code. */
const tag = (lang: string) => lang.replace(/_/g, "-").toLowerCase();

/** Whether a voice speaks `lang` (a language code, "de", or a full tag). */
export const speaks = (voice: VoiceInfo, lang: string) => {
  const v = tag(voice.lang);
  const l = tag(lang);
  return v === l || v.startsWith(`${l}-`);
};

/** Novelty and character voices macOS ships beside the real ones, in every language. */
const NOVELTY =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;

/**
 * The voice that reads a language best, among `voices`: one downloaded in high quality ("Premium",
 * then "Enhanced") of the language's main region (de-DE for "de", as the courses speak it) first, then
 * one on the device, and never a novelty voice while there is another.
 */
export function bestVoice<V extends VoiceInfo>(voices: V[], lang: string): V | undefined {
  let region: string | undefined;
  try {
    region = new Intl.Locale(lang).maximize().region?.toLowerCase();
  } catch {}
  const score = (v: V) =>
    (/premium/i.test(v.name) ? 8 : 0) +
    (/enhanced|erweitert|verbessert|улучш/i.test(v.name) ? 6 : 0) +
    (region && tag(v.lang).endsWith(`-${region}`) ? 3 : 0) +
    (v.local ? 1 : 0) -
    (NOVELTY.test(v.name) ? 20 : 0);
  return voices
    .filter((v) => speaks(v, lang))
    .reduce<V | undefined>((best, v) => (!best || score(v) > score(best) ? v : best), undefined);
}
