// Numbers of 0–9999 as each language says them, its words joined (no space, no hyphen): a recogniser
// writes "2 Euro 50" where a course writes "zwei Euro fünfzig", "21" where it writes "twenty-one", and
// the other way round. Data per language, read through language-forms.ts.

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

/** Spanish: "veintiuno", "treinta y uno", "cien", "ciento uno", "quinientos", "mil", "dos mil". */
const es: Speller = (() => {
  const units = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
  const teens = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete"];
  teens.push("dieciocho", "diecinueve");
  const twenties = ["veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro"];
  twenties.push("veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve");
  const tens = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta"];
  tens.push("noventa");
  const hundreds = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos"];
  hundreds.push("seiscientos", "setecientos", "ochocientos", "novecientos");
  const below100 = (n: number) =>
    n < 10
      ? units[n]
      : n < 20
        ? teens[n - 10]
        : n < 30
          ? twenties[n - 20]
          : `${tens[Math.floor(n / 10)]}${n % 10 ? `y${units[n % 10]}` : ""}`;
  const below1000 = (n: number) =>
    n === 100
      ? "cien"
      : `${hundreds[Math.floor(n / 100)]}${n % 100 || n < 100 ? below100(n % 100) : ""}`;
  return (n) => {
    const t = Math.floor(n / 1000);
    const rest = n % 1000;
    return `${t ? `${t > 1 ? units[t] : ""}mil` : ""}${rest || !t ? below1000(rest) : ""}`;
  };
})();

/** French: "vingt et un", "soixante-dix", "quatre-vingts", "deux cents", "deux cent un", "mille". */
const fr: Speller = (() => {
  const units = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"];
  const teens = ["dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dixsept"];
  teens.push("dixhuit", "dixneuf");
  const tens = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];
  const below20 = (n: number) => (n < 10 ? units[n] : teens[n - 10]) as string;
  const below100 = (n: number): string => {
    if (n < 20) return below20(n);
    if (n < 70) {
      const u = n % 10;
      return `${tens[Math.floor(n / 10)]}${u === 1 ? "etun" : u ? units[u] : ""}`;
    }
    if (n < 80) return `soixante${n === 71 ? "et" : ""}${below20(n - 60)}`;
    return n === 80 ? "quatrevingts" : `quatrevingt${below20(n - 80)}`;
  };
  const below1000 = (n: number) => {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const cent = h ? `${h > 1 ? units[h] : ""}cent${h > 1 && !rest ? "s" : ""}` : "";
    return `${cent}${rest || !h ? below100(rest) : ""}`;
  };
  return (n) => {
    const t = Math.floor(n / 1000);
    const rest = n % 1000;
    return `${t ? `${t > 1 ? units[t] : ""}mille` : ""}${rest || !t ? below1000(rest) : ""}`;
  };
})();

/** Italian: "ventuno", "ventotto", "ventitré", "cento", "duecento", "mille", "duemila". */
const it: Speller = (() => {
  const units = ["zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove"];
  const teens = ["dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici"];
  teens.push("diciassette", "diciotto", "diciannove");
  const tens = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta"];
  tens.push("ottanta", "novanta");
  const below100 = (n: number) => {
    if (n < 10) return units[n] as string;
    if (n < 20) return teens[n - 10] as string;
    const ten = tens[Math.floor(n / 10)] as string;
    const u = n % 10;
    if (!u) return ten;
    // "ventuno", "ventotto": the tens' vowel goes before a vowel; a final "tre" is "tré".
    return `${u === 1 || u === 8 ? ten.slice(0, -1) : ten}${u === 3 ? "tré" : units[u]}`;
  };
  const below1000 = (n: number) => {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const cento = h ? `${h > 1 ? units[h] : ""}cento` : "";
    // "centotto", "centottanta": "cento" loses its vowel before "otto" and "ottanta".
    const tail = rest || !h ? below100(rest) : "";
    return h && tail.startsWith("ott") ? `${cento.slice(0, -1)}${tail}` : `${cento}${tail}`;
  };
  return (n) => {
    const t = Math.floor(n / 1000);
    const rest = n % 1000;
    const word = `${t ? (t > 1 ? `${units[t]}mila` : "mille") : ""}${rest || !t ? below1000(rest) : ""}`;
    return word.endsWith("tre") && n > 3 ? `${word.slice(0, -3)}tré` : word;
  };
})();

/** The languages whose numbers are said here, by language code. */
export const NUMBER_WORDS: Record<string, Speller> = { de, en, es, fr, it };
