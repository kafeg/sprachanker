// The learner's gender in a reply (07, "Prompts"): the rules say it is unknown (NEUTRAL, GENDER_FREE),
// but models still write "ты решил" — the words that mark it are found here, for the task's quality
// (asked again once). Data per learner language; a language without data is never judged.
import type { Lang } from "@sprachanker/schema";

/** What marks a gender in words about the person addressed, and in a sentence the learner is to say
 *  themselves ("я хотел бы"): a reply's own first person (a partner speaking of itself) is no mark,
 *  so a task checks it only where the learner's own sentences are. */
interface Marks {
  addressed: RegExp[];
  own: RegExp[];
}

const L = "(?<!\\p{L})";
const R = "(?!\\p{L})";
const re = (source: string) => new RegExp(source, "u");
/** Both forms side by side: "рад(а)", "встречал/а", and in Cyrillic "должен/должна" (a German pair,
 *  "Kellner/Kellnerin", is no mark). */
const BOTH = [
  re("\\p{L}+\\((?:а|ла|ась|лась|на|ая|ой|ый|a|aś|łaś|y)\\)"),
  re(`\\p{L}\\/(?:а|ла|ая|на|a|aś)${R}`),
];
const CYRILLIC_PAIR = re(`${L}(\\p{Script=Cyrillic}{3})\\p{Script=Cyrillic}*\\/\\1\\p{L}*`);

const RU_ADVERBS =
  "(?:(?:уже|сам|сама|не|бы|ещё|тоже|сегодня|вчера|только|раньше|точно|ли|здесь|тут|теперь|сейчас|очень|так|у нас|у меня)\\s+)*";
const RU_SHORT =
  "(?:готов|рад|уверен|согласен|должен|новенький|новенькая|единственный|единственная|один|одна|сам|сама|прав|свободен|занят)";
const UK_ADVERBS = "(?:(?:вже|сам|сама|не|б|би|ще|теж|сьогодні|вчора|тільки|раніше|точно)\\s+)*";

const MARKS: Partial<Record<Lang, Marks>> = {
  ru: {
    addressed: [
      re(`${L}[Тт]ы\\s+${RU_ADVERBS}\\p{L}+(?:л|ла|лся|лась)${R}`),
      re(`${L}[Тт]ы\\s+${RU_ADVERBS}${RU_SHORT}[аы]?${R}`),
      re(`${L}${RU_SHORT}[аы]?\\s+(?:ли\\s+)?ты${R}`),
      re(`${L}\\p{L}+(?:л|ла|лся|лась)\\s+ли\\s+ты${R}`),
      ...BOTH,
      CYRILLIC_PAIR,
    ],
    own: [re(`${L}[Яя]\\s+\\p{L}+(?:л|ла)\\s+бы${R}`)],
  },
  uk: {
    addressed: [
      re(`${L}[Тт]и\\s+${UK_ADVERBS}\\p{L}+(?:в|ла|вся|лася)${R}`),
      re(
        `${L}[Тт]и\\s+${UK_ADVERBS}(?:готовий|готова|радий|рада|впевнений|впевнена|згоден|згодна|повинен|повинна|сам|сама)${R}`,
      ),
      ...BOTH,
      CYRILLIC_PAIR,
    ],
    own: [re(`${L}[Яя]\\s+\\p{L}+(?:в|ла)\\s+б(?:и)?${R}`)],
  },
  pl: {
    addressed: [
      re(`\\p{L}+(?:łeś|łaś|łbyś|łabyś)${R}`),
      re(
        `${L}[Jj]esteś\\s+(?:już\\s+|nie\\s+)?(?:gotowy|gotowa|pewny|pewna|pewien|sam|sama|zadowolony|zadowolona)${R}`,
      ),
      ...BOTH,
    ],
    own: [new RegExp(`${L}(?:chciałbym|chciałabym|mógłbym|mogłabym|byłbym|byłabym)${R}`, "iu")],
  },
};

/** The first words of `texts` that mark the learner's gender in their language — about them, and with
 *  `own` in a sentence they would say; undefined when none (or no data for the language). */
export function genderMarked(texts: string[], language: Lang, own = true): string | undefined {
  const marks = MARKS[language];
  if (!marks) return undefined;
  const all = own ? [...marks.addressed, ...marks.own] : marks.addressed;
  for (const text of texts)
    for (const mark of all) {
      const found = mark.exec(text)?.[0];
      if (found) return found;
    }
  return undefined;
}

/** The problem a reply is asked again once for: the words that mark the learner's gender. */
export function genderProblem(texts: string[], language: Lang, own = true): string | undefined {
  const found = genderMarked(texts, language, own);
  return found
    ? `"${found}" marks the learner's gender, which is unknown: rebuild the sentence without it`
    : undefined;
}
