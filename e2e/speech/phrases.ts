// German phrases of every length a learner says in a lesson, read by Qwen3-TTS through the compiled
// binary (a throwaway data root, models cloned) and heard by this Mac's whisper.cpp — the phones'
// recognition is measured against them (speech:phone, speech:android); scored as `speech:check` does.
import { wordDiff } from "@sprachanker/engine";
import { speechApp, wav16k } from "./app.ts";

/** From one word to a quarter of a minute. */
export const PHRASES = [
  "Ja.",
  "Danke.",
  "Ich heiße Nico.",
  "Der Zug fährt um halb acht von Gleis drei ab.",
  "Ich möchte bitte einen Kaffee mit Milch.",
  "Es geht mir gut, danke. Und dir?",
  "Am Wochenende fahre ich mit meiner Schwester nach Hamburg, weil wir dort unsere Großeltern besuchen wollen.",
  "Ich wohne seit zwei Jahren in Berlin. Morgens fahre ich mit dem Fahrrad zur Arbeit, und abends lerne ich Deutsch mit einer App. Am liebsten spreche ich mit meinen Nachbarn, weil ich dabei viele neue Wörter höre.",
];

/** The share of the reference's words heard (words heard joined or split count as said). */
export function heard(reference: string, transcript: string) {
  const { diff } = wordDiff("de", reference, transcript, true);
  const words = diff.reduce((n, d) => n + (d.expected ? d.expected.split(" ").length : 0), 0);
  const said = diff.reduce(
    (n, d) => n + (d.op === "equal" ? (d.expected ?? "").split(" ").length : 0),
    0,
  );
  return words ? said / words : 1;
}

export interface Phrase {
  id: string;
  text: string;
  seconds: number;
  /** This Mac's whisper.cpp (small, Metal), its model loaded. */
  mac: { ms: number; text: string; heard: number };
}

/** The phrases read (16 kHz WAVs by id) and heard on this Mac, its model loaded first. */
export async function readPhrases(root: string, port: number) {
  const wavs = new Map<string, Uint8Array<ArrayBuffer>>();
  const phrases: Phrase[] = [];
  const app = await speechApp(root, port);
  try {
    await app.set("speech.readEngine", "qwen");
    for (const [i, text] of PHRASES.entries()) {
      const samples = await app.say(text, "de");
      const wav = wav16k(samples);
      // The model loaded before the first is timed.
      if (i === 0) await app.transcribe(wav, "de");
      const t0 = performance.now();
      const macText = (await app.transcribe(wav, "de")).text;
      const ms = Math.round(performance.now() - t0);
      const id = `p${i + 1}`;
      wavs.set(id, wav);
      const seconds = Math.round((samples.length / 16000) * 10) / 10;
      phrases.push({ id, text, seconds, mac: { ms, text: macText, heard: heard(text, macText) } });
      console.log(
        `${id}  ${seconds}s  Mac ${ms} ms  ${Math.round(heard(text, macText) * 100)}%  ${text}`,
      );
    }
  } finally {
    app.stop();
  }
  return { phrases, wavs };
}
