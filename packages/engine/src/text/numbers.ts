// Numbers of 0–9999 as each language says them, its words joined (no space, no hyphen): a recogniser
// writes "2 Euro 50" where a course writes "zwei Euro fünfzig", "21" where it writes "twenty-one", and
// the other way round. Data per language, read through language-forms.ts: the languages the courses
// check answers said aloud in (German, English); another is added here when a course of it is.

type Speller = (n: number) => string;

/** German: one word ("einundzwanzig"; "hundert", not "einhundert"; a final "ein" is "eins"). */
const de: Speller = (() => {
  const units = ["", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"];
  const teens = ["zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn"];
  teens.push("siebzehn", "achtzehn", "neunzehn");
  const tens = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig"];
  tens.push("achtzig", "neunzig");
  const below100 = (n: number) =>
    n < 10
      ? units[n]
      : n < 20
        ? teens[n - 10]
        : `${n % 10 ? `${units[n % 10]}und` : ""}${tens[Math.floor(n / 10)]}`;
  const below1000 = (n: number) => {
    const h = Math.floor(n / 100);
    return `${h ? `${h > 1 ? units[h] : ""}hundert` : ""}${n % 100 ? below100(n % 100) : ""}`;
  };
  return (n) => {
    if (n === 0) return "null";
    const t = Math.floor(n / 1000);
    const word = `${t ? `${t > 1 ? units[t] : ""}tausend` : ""}${below1000(n % 1000)}`;
    return word.endsWith("ein") ? `${word}s` : word;
  };
})();

/** English: "twenty-one", "one hundred five", "one thousand" (no "and", no "a hundred"). */
const en: Speller = (() => {
  const units = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const teens = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen"];
  teens.push("seventeen", "eighteen", "nineteen");
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty"];
  tens.push("ninety");
  const below100 = (n: number) =>
    n < 10
      ? units[n]
      : n < 20
        ? teens[n - 10]
        : `${tens[Math.floor(n / 10)]}${n % 10 ? units[n % 10] : ""}`;
  const below1000 = (n: number) =>
    `${n >= 100 ? `${units[Math.floor(n / 100)]}hundred` : ""}${n % 100 || n < 100 ? below100(n % 100) : ""}`;
  return (n) => {
    const t = Math.floor(n / 1000);
    const rest = n % 1000;
    return `${t ? `${units[t]}thousand` : ""}${rest || !t ? below1000(rest) : ""}`;
  };
})();

/** The languages whose numbers are said here, by language code. */
export const NUMBER_WORDS: Record<string, Speller> = { de, en };
