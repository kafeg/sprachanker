// Speech round-trip (10, "Speech round-trip"; 08): every text of corpus.json read by Qwen3-TTS and
// heard back by Whisper on this Mac, through the app's own endpoints of the compiled binary, against a
// throwaway data root whose models are an APFS clone of the real ones. Each text is in the language
// learnt, read in that language (a text mixing languages is never read aloud, 08) and scored as the
// share of its words heard (the spoken check's word diff). Seeded synthesis and Whisper make it repeat.
// `bun run speech:check` (`SPEECH_LIMIT=n` for the first n texts).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wordDiff } from "@sprachanker/engine";
import { checkRoot, speechApp, wav16k } from "./app.ts";

const ROOT = checkRoot("sprachanker-speech");
const PORT = 4592;

interface Text {
  lesson: string;
  edition: string;
  text: string;
}
const corpus = JSON.parse(
  readFileSync(new URL("./corpus.json", import.meta.url), "utf8"),
) as Text[];
const limit = Number(process.env.SPEECH_LIMIT ?? corpus.length);

/** The share of the reference's words heard (words heard joined or split count as said). */
function heard(lang: string, reference: string, transcript: string) {
  const { diff } = wordDiff(lang, reference, transcript, true);
  const words = diff.reduce((n, d) => n + (d.expected ? d.expected.split(" ").length : 0), 0);
  const said = diff.reduce(
    (n, d) => n + (d.op === "equal" ? (d.expected ?? "").split(" ").length : 0),
    0,
  );
  return words ? said / words : 1;
}

// The data root: the models cloned, nothing else.
const app = await speechApp(ROOT, PORT);
try {
  await app.set("speech.readEngine", "qwen");

  const rows: Array<{ t: Text; score: number; heardAs: string }> = [];
  for (const t of corpus.slice(0, limit)) {
    const lang = t.edition.split("-")[1] as string;
    const heardAs = (await app.transcribe(wav16k(await app.say(t.text, lang)), lang)).text;
    const score = heard(lang, t.text, heardAs);
    rows.push({ t, score, heardAs });
    console.log(`${t.edition}  ${`${Math.round(score * 100)}%`.padEnd(5)} ${t.text}`);
  }
  writeFileSync(join(ROOT, "results.json"), JSON.stringify(rows, null, 2));

  // How it went, by edition: the median and the lowest share of words heard.
  const groups = new Map<string, number[]>();
  for (const r of rows) groups.set(r.t.edition, [...(groups.get(r.t.edition) ?? []), r.score]);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const failures: string[] = [];
  console.log("\nedition: median · lowest · texts");
  for (const [k, xs] of [...groups].sort()) {
    const m = median(xs);
    console.log(
      `${k}: ${Math.round(m * 100)}% · ${Math.round(Math.min(...xs) * 100)}% · ${xs.length}`,
    );
    if (m < 0.85) failures.push(`${k}: median ${Math.round(m * 100)}%`);
  }
  console.log(`\nresults: ${join(ROOT, "results.json")}`);
  if (failures.length) {
    console.error(`\nbelow the bar:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
} finally {
  app.stop();
}
