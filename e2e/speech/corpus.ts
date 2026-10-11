// The texts of the speech round-trip (10, "Speech round-trip"): asked once of the app's own tutor, in
// real lessons of several language pairs, and kept in corpus.json — sentences in the language learnt,
// and explanations in the learner's language quoting it (a text mixing both). Written by the model, not
// taken from the courses. Run against a server whose profile has an AI assistant set up:
// `bun speech/corpus.ts <server url> <cookie>`.
import { writeFileSync } from "node:fs";

interface Ask {
  series: string;
  lessonKey: string;
  edition: string;
}

/** Lessons of every pair the courses teach here: Russian → German, Russian → English, English →
 *  German. */
const LESSONS: Ask[] = [
  ...["00-01", "01-02", "03-01", "05-03", "08-02", "12-01", "16-04"].map((l) => ({
    series: "dw.nicos-weg",
    lessonKey: `dw.nicos-weg/a1-ru/${l}`,
    edition: "ru-de",
  })),
  ...["02-01", "05-03"].map((l) => ({
    series: "dw.nicos-weg",
    lessonKey: `dw.nicos-weg/a2-ru/${l}`,
    edition: "ru-de",
  })),
  ...["01-01", "01-06", "02-03", "03-10"].map((l) => ({
    series: "lingust.english",
    lessonKey: `lingust.english/english/${l}`,
    edition: "ru-en",
  })),
  ...["01-01", "03-05"].map((l) => ({
    series: "voa.english-usa",
    lessonKey: `voa.english-usa/english-usa/${l}`,
    edition: "ru-en",
  })),
  ...["01-01", "04-03", "07-02"].map((l) => ({
    series: "coerll.dib",
    lessonKey: `coerll.dib/dib/${l}`,
    edition: "en-de",
  })),
];

const NAME: Record<string, Record<string, string>> = {
  ru: { de: "немецком", en: "английском" },
  en: { de: "German" },
};

/** What the tutor is asked, in the learner's language: lines marked T (the language learnt) and M
 *  (an explanation quoting it). */
function message(learner: string, target: string) {
  const t = NAME[learner]?.[target] ?? target;
  return learner === "ru"
    ? `Мне нужны фразы для тренировки произношения. Напиши 10 разных коротких предложений на ${t} по теме этого урока — каждое отдельной строкой, начиная с «T: ». Только эти строки, без нумерации и другого текста.`
    : `I need phrases to practise pronunciation. Write 10 different short sentences in ${t} on this lesson's topic — each on its own line starting with "T: ". Only these lines, no numbering, nothing else.`;
}

const [base, cookie] = process.argv.slice(2) as [string, string];
const headers = { "content-type": "application/json", "x-sprachanker": "1", cookie };
const corpus: Array<{ lesson: string; edition: string; text: string }> = [];
for (const ask of LESSONS) {
  const [learner, target] = ask.edition.split("-") as [string, string];
  const res = await fetch(`${base}/api/llm/tutor`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...ask,
      language: learner,
      message: message(learner, target),
      newChat: true,
    }),
  });
  const reply = await res.text();
  if (!res.ok) {
    console.error(ask.lessonKey, res.status, reply.slice(0, 200));
    continue;
  }
  for (const line of reply.split("\n")) {
    const m = /^\s*T:\s*(.+?)\s*$/.exec(line);
    if (m?.[1])
      corpus.push({ lesson: ask.lessonKey, edition: ask.edition, text: m[1].replace(/\*\*/g, "") });
  }
  console.log(ask.lessonKey, corpus.length);
}
writeFileSync(new URL("./corpus.json", import.meta.url), `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`${corpus.length} texts`);
