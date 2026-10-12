// Whose voice it is (08; pure): a server voice's gender where it is known — Qwen3-TTS's named speakers,
// Piper's voices by name (those whose speaker is known; a voice of several speakers, or one not known,
// has none) — and a dialogue's speaker's by their name, only where it is obvious ("Frau Weber", "Nina",
// "Jonas"); the second speaker of a dialogue is then the one the other voice suits.

export type Gender = "f" | "m";

const QWEN: Record<string, Gender> = {
  ryan: "m",
  aiden: "m",
  eric: "m",
  dylan: "m",
  uncle_fu: "m",
  serena: "f",
  vivian: "f",
  ono_anna: "f",
  sohee: "f",
};

/** Piper's voices by name (the part of the id between the locale and the quality). */
const PIPER: Record<string, Gender> = Object.fromEntries([
  ...[
    "alba",
    "alma",
    "amy",
    "anna",
    "berta",
    "cori",
    "daniela",
    "dii",
    "SA_dii",
    "eva_k",
    "gosia",
    "hfc_female",
    "irina",
    "jenny_dioco",
    "justyna_wg_glos",
    "kathleen",
    "kerstin",
    "kristin",
    "lada",
    "lessac",
    "lili",
    "lisa",
    "ljspeech",
    "maider",
    "marylux",
    "meera",
    "nathalie",
    "natia",
    "paola",
    "priyamvada",
    "ramona",
    "raya",
    "salka",
    "siwis",
    "southern_english_female",
    "ugla",
    "upc_ona",
    "zenski_wg_glos",
  ].map((n) => [n, "f"]),
  ...[
    "alan",
    "amir",
    "antton",
    "artur",
    "bryce",
    "carlfm",
    "danny",
    "davefx",
    "denis",
    "dmitri",
    "edresson",
    "faber",
    "fahrettin",
    "fettah",
    "gilles",
    "harri",
    "hfc_male",
    "imre",
    "jeff",
    "jirka",
    "joe",
    "john",
    "kareem",
    "karlsson",
    "kusal",
    "mihai",
    "miro",
    "SA_miro",
    "SA_miro_V2",
    "norman",
    "northern_english_male",
    "pavoque",
    "pim",
    "pratham",
    "reza_ibrahim",
    "riccardo",
    "rohan",
    "ronnie",
    "ruslan",
    "ryan",
    "southern_english_male",
    "steinn",
    "thorsten",
    "tom",
    "upc_pau",
  ].map((n) => [n, "m"]),
]);

/** A server voice's gender, when it is known: Piper's by its id, Qwen3-TTS's `<model>/<speaker>`. */
export function voiceGender(engine: "piper" | "qwen", voice: string): Gender | undefined {
  if (engine === "qwen") return QWEN[voice.split("/").at(-1) ?? voice];
  return PIPER[/^[^-]+-(.+)-[^-]+$/.exec(voice)?.[1] ?? voice];
}

/** First names whose gender is obvious, as course dialogues use them (lower case). */
const NAMES: Record<string, Gender> = Object.fromEntries([
  ..."anna nina lena maria marie julia laura sarah sara lisa emma mia sophie sofia hannah lea clara eva paula katja petra sabine monika jana olga tanja anja ella lina emily kate mary jane linda susan helen alice lucy johanna greta martina claudia irina elena natalia natascha svetlana ольга анна мария елена наташа ирина"
    .split(" ")
    .map((n) => [n, "f"]),
  ..."jonas tom max paul lukas felix ben leon tim jan peter thomas michael stefan markus nico daniel david martin alexander sebastian jakob moritz erik philipp simon florian tobias john james mark mike bob ivan pavel dmitri sergei hans karl klaus frank otto oliver noah elias finn иван павел дмитрий сергей андрей"
    .split(" ")
    .map((n) => [n, "m"]),
]);
const TITLES: Record<string, Gender> = {
  frau: "f",
  herr: "m",
  mrs: "f",
  ms: "f",
  miss: "f",
  mr: "m",
  madame: "f",
  monsieur: "m",
  señora: "f",
  señor: "m",
  госпожа: "f",
  господин: "m",
};

/** A speaker's gender by their name, only where it is obvious (a title, a common first name). */
export function nameGender(name: string): Gender | undefined {
  const first =
    name
      .toLowerCase()
      .split(/[\s.,]+/)
      .find(Boolean) ?? "";
  return TITLES[first] ?? NAMES[first];
}

/**
 * Which of a dialogue's speakers the other voice reads: the one whose name says they are not of the
 * main voice's gender, while the other is (or is not known); else the second to speak.
 */
export function otherSpeaker(speakers: string[], main: Gender | undefined): string | undefined {
  const [a, b] = speakers;
  if (a === undefined || b === undefined) return undefined;
  const [ga, gb] = [nameGender(a), nameGender(b)];
  if (main && ga && ga !== main && gb !== ga) return a;
  return b;
}
