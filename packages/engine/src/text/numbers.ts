// A number written in digits as it is said, for comparing words heard: a recogniser writes "2 Euro
// 50" where a course writes "zwei Euro fünfzig", and the other way round. German only for now.

const UNITS = ["", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"];
const TEENS = [
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
];
const TENS = [
  "",
  "",
  "zwanzig",
  "dreißig",
  "vierzig",
  "fünfzig",
  "sechzig",
  "siebzig",
  "achtzig",
  "neunzig",
];

/** Below 100, "ein" for 1 (as in "einundzwanzig"; the caller makes a final one "eins"). */
function belowHundred(n: number): string {
  if (n < 10) return UNITS[n] as string;
  if (n < 20) return TEENS[n - 10] as string;
  const unit = n % 10;
  const tens = TENS[Math.floor(n / 10)] as string;
  return unit ? `${UNITS[unit]}und${tens}` : tens;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return `${hundreds ? `${hundreds > 1 ? UNITS[hundreds] : ""}hundert` : ""}${rest ? belowHundred(rest) : ""}`;
}

/** A German number of 0–9999 in digits as one word ("hundert", not "einhundert"); undefined for
 *  anything else. */
export function germanNumber(digits: string): string | undefined {
  if (!/^\d{1,4}$/.test(digits)) return undefined;
  const n = Number(digits);
  if (n === 0) return "null";
  const thousands = Math.floor(n / 1000);
  const word = `${thousands ? `${thousands > 1 ? UNITS[thousands] : ""}tausend` : ""}${belowThousand(n % 1000)}`;
  return word.endsWith("ein") ? `${word}s` : word;
}
