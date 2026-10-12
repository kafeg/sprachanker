// A task's system prompt (07, "Prompts"): the learner's own rules for it (filled in) or its standing
// ones, then the fixed suffix that stays whatever the learner wrote — how the data is delimited, the
// reply's form and its languages.
import type { Lang } from "@sprachanker/schema";
import { languageName } from "../text.ts";

/** A task's standing rules for an answer language and a learnt language; `names` replaces the
 *  languages' names (the placeholders a template shows). */
export type TaskRules = (
  language: Lang,
  target: Lang,
  names?: { language: string; target: string },
) => string;

/** What a task's input carries for its system prompt. */
export interface RulesInput {
  /** The learner's own system prompt for the task, filled in (settings); the standing rules otherwise. */
  rules?: string;
  language: Lang;
  target: Lang;
}

/** The reply's languages, whatever the rules: models drift into a third one (a Chinese or English
 *  word in a Russian explanation). */
export function languagesLine(language: Lang, target: Lang): string {
  const [l, t] = [languageName(language), languageName(target)];
  return `Write only in ${l === t ? t : `${l} and ${t}`}: not a word in any other language.`;
}

/** The system prompt as sent: the learner's rules or the standing ones, then the fixed suffix — with,
 *  for a task whose standing rules keep the learner's gender unassumed, how the learner's language
 *  does that (`GENDER_FREE`), so it holds under the learner's own rules too. */
export function systemPrompt(input: RulesInput, standing: TaskRules, fixed: string) {
  const rules = standing(input.language, input.target);
  return [
    input.rules ?? rules,
    fixed,
    languagesLine(input.language, input.target),
    rules.includes(NEUTRAL) ? GENDER_FREE[input.language] : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Said in every rule set that addresses the learner or writes about them: their gender is never
 *  assumed. */
export const NEUTRAL =
  'The learner\'s gender is unknown: wherever a language would mark it (a translation, an explanation, feedback, your lines), choose wording that does not — never both forms side by side ("a(b)", "a/b"); rebuild the sentence instead.';

/** How a learner's language that marks gender in words about the person addressed is written without
 *  it: what to avoid and what to say instead (walkthrough, 2026-10-12: "ты нашёл", "хотел(а)"). Data,
 *  so the rules name no language. */
export const GENDER_FREE: Partial<Record<Lang, string>> = {
  ru: 'In Russian, no past-tense verb, short adjective or participle about the learner ("ты нашёл", "ты справился", "ты встретил", "ты готов", nor "смог(ла)"): rebuild the sentence — "у тебя получилось", "удалось найти", "это верно", "можно сказать…".',
  uk: 'In Ukrainian, no past-tense verb, short adjective or participle about the learner ("ти знайшов", "ти впорався", "ти готовий", nor "зміг(ла)"): rebuild the sentence — "у тебе вийшло", "вдалося знайти", "це правильно", "можна сказати…".',
  pl: 'In Polish, no past-tense verb or adjective about the learner ("znalazłeś", "poradziłeś sobie", "jesteś gotowy", nor "zrobiłeś/aś"): rebuild the sentence — "udało ci się", "to jest poprawne", "można powiedzieć…".',
  bs: 'In Bosnian, no past participle or adjective about the learner ("našao si", "uspio si", "spreman si", nor "uradio/la"): rebuild the sentence — "uspjelo ti je", "to je tačno", "može se reći…".',
  fr: 'In French, no adjective or participle agreeing with the learner ("tu es prêt", "tu es allé", nor "prêt(e)"): rebuild the sentence — "ta réponse est juste", "tu as réussi", "on peut dire…".',
  es: 'In Spanish, no adjective or participle about the learner ("estás listo", "eres bueno", nor "listo/a"): rebuild the sentence — "tu respuesta es correcta", "lo has hecho bien", "se puede decir…".',
  pt: 'In Portuguese, no adjective or participle about the learner ("estás pronto", "ficaste cansado", nor "pronto/a"): rebuild the sentence — "a tua resposta está correta", "conseguiste", "pode dizer-se…".',
  ro: 'In Romanian, no adjective or participle about the learner ("ești pregătit", "ești sigur", nor "pregătit/ă"): rebuild the sentence — "răspunsul tău este corect", "ai reușit", "se poate spune…".',
  el: 'In Greek, no adjective or participle about the learner ("είσαι έτοιμος", "είσαι σίγουρος", nor "έτοιμος/η"): rebuild the sentence — "η απάντησή σου είναι σωστή", "τα κατάφερες", "μπορεί να πει κανείς…".',
  ar: 'In Arabic, no second-person verb or adjective that differs by gender ("أنت مستعد", "تكتبين"): use nouns and impersonal phrases — "إجابتك صحيحة", "يمكن أن نقول…".',
  hi: 'In Hindi, no verb or adjective about the learner that marks gender ("आप जा सकते हैं", "आप तैयार थे"): rebuild the sentence — "आपका उत्तर सही है", "यह सही है", "ऐसे कहा जा सकता है…".',
};
