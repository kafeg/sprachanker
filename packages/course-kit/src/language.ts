// Which of a course's two languages a text from its source is in (02, "Text language"): a source that
// mixes them in one field (an option, a prompt) has its learner-language texts moved to the locale
// file. Decided by script where the two languages differ in it, else by their frequent words and
// letters; a text that tells nothing (a name, "OK") is taken as the target language.

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

/** Frequent short words of the Latin-script languages, and letters only they use. */
const MARKS: Record<string, { words: string; letters?: RegExp }> = {
  de: {
    words:
      "der die das den dem des ein eine einen einem einer und oder aber ist sind war hat haben ich du er sie es wir ihr nicht kein keine mit von zu im in auf für was wer wie wo warum ja nein auch noch schon sehr gut heute",
    letters: /[äöüß]/giu,
  },
  en: {
    words:
      "the a an and or but is are was were has have had i you he she it we they not no with of to in on for what who how where why yes also very good today this that there",
  },
  es: {
    words:
      "el la los las un una unos unas y o pero es son está están fue tiene yo tú él ella nosotros no con de del a en por para qué quién cómo dónde sí también muy bien hoy",
    letters: /[ñ¿¡]/giu,
  },
  fr: {
    words:
      "le la les un une des et ou mais est sont était a ont je tu il elle nous vous ils elles ne pas avec de du au aux en pour qui que quoi comment où oui aussi très bien aujourd",
    letters: /[çœ]/giu,
  },
  pt: {
    words:
      "o a os as um uma uns umas e ou mas é são está estão foi tem eu tu ele ela nós vocês não com de do da em por para que quem como onde sim também muito bem hoje",
    letters: /[ãõ]/giu,
  },
  it: {
    words:
      "il lo la i gli le un una e o ma è sono era ha hanno io tu lui lei noi voi loro non con di del della a in per che chi come dove sì anche molto bene oggi",
  },
  pl: {
    words:
      "i a ale lub jest są był ma mają ja ty on ona ono my wy oni nie z ze w we na do od dla co kto jak gdzie dlaczego tak też bardzo dobrze dziś to się",
    letters: /[ąęłńśźżć]/giu,
  },
  ro: {
    words:
      "și sau dar este sunt era are au eu tu el ea noi voi ei nu cu de din la în pe pentru ce cine cum unde da și foarte bine azi un o",
    letters: /[ăâîșțşţ]/giu,
  },
  tr: {
    words:
      "ve veya ama bir bu şu o ben sen biz siz onlar değil yok var ile için ne kim nasıl nerede neden evet hayır da de çok iyi bugün mi mı",
    letters: /[ığşİ]/gu,
  },
  hu: {
    words:
      "a az egy és vagy de van vannak volt én te ő mi ti ők nem igen is meg hogy mit ki hogyan hol miért nagyon jó ma ez az",
    letters: /[őű]/giu,
  },
  id: {
    words:
      "dan atau tetapi adalah ini itu saya kamu dia kami kita mereka tidak bukan dengan dari ke di untuk apa siapa bagaimana mana mengapa ya juga sangat baik hari yang",
  },
  sw: {
    words:
      "na au lakini ni ndiyo hapana mimi wewe yeye sisi ninyi wao si kwa ya wa za la cha vya katika nini nani vipi wapi kwa nini pia sana nzuri leo",
  },
  bs: {
    words:
      "i ili ali je su bio ima imaju ja ti on ona mi vi oni ne nije sa s od do u na za šta ko kako gdje zašto da također vrlo dobro danas se",
    letters: /[čćđšž]/giu,
  },
  nl: {
    words:
      "de het een en of maar is zijn was heeft hebben ik jij hij zij wij jullie niet geen met van naar in op voor wat wie hoe waar waarom ja ook heel goed vandaag",
  },
};
const wordSets = new Map(
  Object.entries(MARKS).map(([lang, m]) => [lang, new Set(m.words.split(" "))]),
);

/** How strongly a text reads as one Latin-script language rather than the other: its frequent words
 *  the other does not share (German "an", English "an"…), and its own letters. */
function score(text: string, lang: string, other: string): number {
  const words = wordSets.get(lang);
  if (!words) return 0;
  const theirs = wordSets.get(other) ?? new Set<string>();
  // One letter tells nothing ("geht’s" ends in an "s").
  const tokens = (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((t) => t.length > 1);
  const own = text.match(MARKS[lang]?.letters ?? /$^/gu)?.length ?? 0;
  return tokens.filter((t) => words.has(t) && !theirs.has(t)).length + own;
}

/** Whether `text` is in the learner's language rather than the target's (both ISO 639-1). */
export function inLearnerLanguage(text: string, target: string, learner: string): boolean {
  if (target === learner || !text.trim()) return false;
  const targetScript = scriptOf(target);
  const learnerScript = scriptOf(learner);
  if (targetScript !== learnerScript) {
    const theirs = text.match(learnerScript)?.length ?? 0;
    const ours = text.match(targetScript)?.length ?? 0;
    return theirs > ours;
  }
  // Taken as the learner's only when it says so twice over and more than it says the target: a German
  // text moved to the locale file would be worse than a learner-language one left in place.
  const theirs = score(text, learner, target);
  return theirs >= 2 && theirs > score(text, target, learner);
}
