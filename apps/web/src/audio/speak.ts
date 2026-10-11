// What reading aloud says and with which voice (08): a text in one language, given explicitly (a text
// mixing languages is never read), and the best voice of a language among those there are. Pure: tested without a browser.

/** A piece of text to read, in its one language; `alt`: by another voice of the language when there
 *  is one (a dialogue's second speaker). */
export interface SpokenPart {
  text: string;
  lang: string;
  alt?: boolean;
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
