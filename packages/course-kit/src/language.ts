// Which of a course's two languages a text from its source is in (02, "Text language"): a source that
// mixes them in one field (an option, a prompt) has its learner-language texts moved to the locale
// file. Told by script, where the two languages differ in it; two languages of one script are not
// told apart (the text stays the target's).

/** The script of the languages courses explain in or teach; Latin unless named. */
const SCRIPTS: Record<string, RegExp> = {
  ru: /\p{Script=Cyrillic}/gu,
  uk: /\p{Script=Cyrillic}/gu,
  bg: /\p{Script=Cyrillic}/gu,
  sr: /\p{Script=Cyrillic}/gu,
  ar: /\p{Script=Arabic}/gu,
  fa: /\p{Script=Arabic}/gu,
  ur: /\p{Script=Arabic}/gu,
  el: /\p{Script=Greek}/gu,
  hi: /\p{Script=Devanagari}/gu,
  zh: /\p{Script=Han}/gu,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
  ko: /\p{Script=Hangul}/gu,
  he: /\p{Script=Hebrew}/gu,
};
const LATIN = /\p{Script=Latin}/gu;
const scriptOf = (lang: string) => SCRIPTS[lang] ?? LATIN;

/** Whether `text` is in the learner's language rather than the target's (both ISO 639-1): more of its
 *  letters in the learner's script than in the target's. */
export function inLearnerLanguage(text: string, target: string, learner: string): boolean {
  const learnerScript = scriptOf(learner);
  const targetScript = scriptOf(target);
  if (learnerScript === targetScript) return false;
  return (text.match(learnerScript)?.length ?? 0) > (text.match(targetScript)?.length ?? 0);
}
