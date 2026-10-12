// Whose voice it is (08): a server voice's gender where it is known — Qwen3-TTS's named speakers,
// Piper's voices by name (those whose speaker is known; a voice of several speakers, or one not known,
// has none) — and its age where it is plain (Qwen3-TTS's "uncle_fu" an older man's). A text's people
// are given voices by their gender and age (`castVoices`: the server's, when a text is made); a text
// made before its people were known, by their names, only where they are obvious ("Frau Weber",
// "Nina", "Jonas": `speakerVoices`, the web's).

export type Gender = "f" | "m";
export type Age = "young" | "adult" | "senior";

/** Another voice than the language's own: `true`, one of a gender (`"f"`, `"m"`), or a second one of
 *  it (`"f2"`, `"m2"`). */
export type Alt = true | "f" | "m" | "f2" | "m2";

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

/** Server voices whose age is plain (the others sound as adults). */
const QWEN_AGE: Record<string, Age> = { uncle_fu: "senior" };

/** A server voice's gender, when it is known: Piper's by its id, Qwen3-TTS's `<model>/<speaker>`. */
export function voiceGender(engine: "piper" | "qwen", voice: string): Gender | undefined {
  if (engine === "qwen") return QWEN[voice.split("/").at(-1) ?? voice];
  return PIPER[/^[^-]+-(.+)-[^-]+$/.exec(voice)?.[1] ?? voice];
}

/** First names whose gender is obvious, as course dialogues use them (lower case). */
const NAMES: Record<string, Gender> = Object.fromEntries([
  ..."anna nina lena maria marie julia laura sarah sara lisa emma mia sophie sofia hannah lea clara eva paula katja petra sabine monika jana olga tanja anja ella lina emily kate mary jane linda susan helen helena alice lucy johanna greta martina claudia irina elena natalia natascha svetlana milena katya yuna samantha karen moira tessa fiona victoria allison ava zoe amélie amelie audrey aurélie monica paulina ольга анна мария елена наташа ирина милена"
    .split(" ")
    .map((n) => [n, "f"]),
  ..."jonas tom max paul lukas felix ben leon tim jan peter thomas michael stefan markus nico daniel david martin alexander sebastian jakob moritz erik philipp simon florian tobias john james mark mike bob ivan pavel dmitri sergei hans karl klaus frank otto oliver noah elias finn yannick viktor yuri alex fred aaron arthur thomas jacques diego jorge juan luca иван павел дмитрий сергей андрей юрий"
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
 * How a dialogue's two first speakers are read, by those another voice than the language's main one
 * reads — each by a voice of their gender where their name says it, or `genderOf` (a text's people's
 * own) (`true`: any other). The main
 * voice reads the first whose gender is its own, else the first not known (its gender not known:
 * the first to speak), the other speaker another voice; when both are of the other gender (two women,
 * a man's main voice), neither: the first a voice of theirs, the second another one of it (`f2`).
 */
export function speakerVoices(
  speakers: string[],
  main: Gender | undefined,
  genderOf: (speaker: string) => Gender | undefined = nameGender,
): Record<string, Alt> {
  const [a, b] = speakers;
  if (a === undefined || b === undefined) return {};
  const genders = [genderOf(a), genderOf(b)];
  const pair = [a, b];
  const reads = main
    ? (pair.find((_, i) => genders[i] === main) ?? pair.find((_, i) => !genders[i]))
    : a;
  const [ga, gb] = genders as [Gender, Gender];
  if (reads === undefined) return { [a]: ga, [b]: gb === ga ? `${gb}2` : gb };
  const other = reads === a ? b : a;
  return { [other]: genderOf(other) ?? true };
}

/** A server voice's age where it is plain, else an adult's. */
export const voiceAge = (engine: "piper" | "qwen", voice: string): Age =>
  (engine === "qwen" ? QWEN_AGE[voice.split("/").at(-1) ?? voice] : undefined) ?? "adult";

/**
 * Each of a text's people a voice among `voices` (an engine's for the language), drawn at random
 * (`random` in [0, 1)): one of their gender, of their age where one is (an older person's voice for
 * a senior, never for anyone else while another is there), none twice while another of their gender
 * is left — so a text's people sound apart and the same two voices are not every text's; never one
 * of the other gender while one of theirs is here (two men, one man's voice: both take it). Nothing
 * when there is no voice.
 */
export function castVoices(
  engine: "piper" | "qwen",
  people: readonly { name: string; gender: Gender; age: Age }[],
  voices: readonly string[],
  random: () => number,
  /** Voices others of the text have already (kept from before): taken as used. */
  taken: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>(taken);
  const draw = (list: string[]) => list[Math.floor(random() * list.length)];
  // Seniors first: the few older voices go to them.
  const order = [...people].sort((a, b) => Number(b.age === "senior") - Number(a.age === "senior"));
  for (const p of order) {
    const free = voices.filter((v) => !used.has(v));
    // Their gender first: a voice used already rather than one of the other gender.
    const ofGender = (list: readonly string[]) =>
      list.filter((v) => voiceGender(engine, v) === p.gender);
    const theirs = ofGender(free).length ? ofGender(free) : ofGender(voices);
    const aged = theirs.filter((v) => (voiceAge(engine, v) === "senior") === (p.age === "senior"));
    const voice = draw(
      aged.length ? aged : theirs.length ? theirs : free.length ? free : [...voices],
    );
    if (voice === undefined) continue;
    out[p.name] = voice;
    used.add(voice);
  }
  return out;
}

/** The longest piece of a text read aloud at once. */
const PIECE = 200;
/** A text as it is read aloud, piece by piece — a long one sentence by sentence: what the web asks
 *  the server for, and so what is read ahead into its cache. */
export const readingPieces = (text: string) =>
  text.length <= PIECE ? [text] : (text.match(/[^.!?…\n]+[.!?…]*\s*/g) ?? [text]);
