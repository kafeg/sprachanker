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

/** How to rewrite a mark keeping the sentence whole (data): models asked only to "rebuild" it lost
 *  the person meant ("что ты хотел бы мне рассказать?" → "что хотелось бы мне рассказать?"). */
const REWRITE: Partial<Record<Lang, string>> = {
  ru: 'change only the words that mark it, keeping who is meant and every case: "ты хотел бы X" → "тебе хотелось бы X", "я хотел бы" → "мне хотелось бы", "ты решил" → "у тебя получилось решить", "ты готов?" → "можно начинать?"; "тебе", "мне" and "ты" stay where they were; then reread the whole sentence: correct Russian, the same meaning',
  uk: 'change only the words that mark it, keeping who is meant and every case: "ти хотів би X" → "тобі хотілося б X", "я хотів би" → "мені хотілося б", "ти знайшов" → "тобі вдалося знайти", "ти готовий?" → "можна починати?"; "тобі", "мені" and "ти" stay where they were; then reread the whole sentence: correct Ukrainian, the same meaning',
  pl: 'change only the words that mark it, keeping who is meant and every case: "chciałbyś X" → "masz ochotę X", "chciałbym" → "poproszę" or "chcę", "znalazłeś" → "udało ci się znaleźć", "jesteś gotowy?" → "możemy zaczynać?"; then reread the whole sentence: correct Polish, the same meaning',
};

/** The problem a reply is asked again once for: the words that mark the learner's gender, and how
 *  the learner's language rewrites them. */
export function genderProblem(texts: string[], language: Lang, own = true): string | undefined {
  const found = genderMarked(texts, language, own);
  return found
    ? `"${found}" marks the learner's gender, which is unknown: ${REWRITE[language] ?? "rebuild the sentence without it"}`
    : undefined;
}

/** "Would like to" with an infinitive after it, the commonest mark: the person in the dative, the
 *  verb impersonal (data: the pronouns' datives, the verb's forms and its impersonal one, the
 *  particle, an infinitive's ending). */
const WOULD_LIKE: Partial<
  Record<
    Lang,
    { dative: Record<string, string>; verb: string; it: string; bi: string; inf: string }
  >
> = {
  ru: {
    dative: { ты: "тебе", я: "мне" },
    verb: "хотела?",
    it: "хотелось",
    bi: "бы",
    inf: "(?:ть|ти|чь)(?:ся|сь)?",
  },
  uk: {
    dative: { ти: "тобі", я: "мені" },
    verb: "хотів|хотіла",
    it: "хотілося",
    bi: "би|б",
    inf: "(?:ти|ть)(?:ся|сь)?",
  },
};

/**
 * `text` with "would like to" said without the learner's gender, where it is safe in code: an
 * infinitive follows within the clause, the person is kept in the dative, every other word as it
 * was ("Что бы ты хотел узнать?" → "Что бы тебе хотелось узнать?", "что ты хотел бы мне рассказать"
 * → "что тебе хотелось бы мне рассказать"). Without an infinitive ("ты хотел бы кофе?") it is left
 * to the model, asked again with how to rewrite it (`genderProblem`).
 */
export function genderFree(text: string, language: Lang): string {
  const d = WOULD_LIKE[language];
  if (!d) return text;
  const p = `(?<p>${Object.keys(d.dative).join("|")})`;
  const [verb, bi] = [`(?:${d.verb})`, `(?<b>${d.bi})`];
  const then = `${R}(?=(?:\\s+\\p{L}+){0,3}?\\s+\\p{L}+${d.inf}${R})`;
  const forms: Array<[string, (dat: string, b: string) => string]> = [
    [`${p}\\s+${verb}\\s+${bi}`, (dat, b) => `${dat} ${d.it} ${b}`], // ты хотел бы
    [`${p}\\s+${bi}\\s+${verb}`, (dat, b) => `${dat} ${b} ${d.it}`], // ты бы хотел
    [`${verb}\\s+${bi}\\s+${p}`, (dat, b) => `${d.it} ${b} ${dat}`], // хотел бы ты
    [`${bi}\\s+${p}\\s+${verb}`, (dat, b) => `${b} ${dat} ${d.it}`], // бы ты хотел
  ];
  return forms.reduce(
    (out, [source, made]) =>
      out.replace(new RegExp(`${L}${source}${then}`, "giu"), (found, ...rest) => {
        const g = rest.at(-1) as { p: string; b: string };
        const said = made(d.dative[g.p.toLowerCase()] ?? g.p, g.b.toLowerCase());
        const upper = found[0] !== found[0]?.toLowerCase();
        return upper ? `${said[0]?.toUpperCase()}${said.slice(1)}` : said;
      }),
    text,
  );
}

/** A reply with every string's "would like to" made gender-free (`genderFree`): a task's fix. */
export function genderFreeReply<T>(value: T, language: Lang): T {
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? genderFree(v, language)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return WOULD_LIKE[language] ? (walk(value) as T) : value;
}
