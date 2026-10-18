// Decks exported as Anki packages and read back by our own reader: an imported deck — its own
// recording and the reading made for a word —, a course's words in an edition (its recordings in the
// library), the AI's examples unless the learner turned them off; the same notes in every export; the
// package downloaded once; another profile's Finds never exported; one imported here again is a deck.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readApkg } from "@sprachanker/anki-export";
import { bunApkgRuntime } from "@sprachanker/anki-export/testing";
import { courseDeckFolder } from "@sprachanker/schema";
import { COURSE, SOUND, withDecks } from "./deck-setup.ts";
import { deckTransferFiles } from "./storage.ts";

test("an .apkg's audio staged: only files under the decks or the library, by paths of plain names; each the zip's next number", async () => {
  const api = await withDecks();
  mkdirSync(join(api.root, "decks", "d", "media", "sub"), { recursive: true });
  writeFileSync(join(api.root, "decks", "d", "media", "a.wav"), WAV);
  writeFileSync(join(api.root, "secret.wav"), WAV);
  const files = deckTransferFiles(api.root);
  const { id, staged } = await files.stageNumbered([
    { root: "decks", path: "../secret.wav" },
    { root: "decks", path: "d/media/a.wav" },
    { root: "decks", path: "/etc/hosts" },
    { root: "decks", path: "d\\media\\a.wav" },
    { root: "decks", path: "d/./media/a.wav" },
    { root: "decks", path: "d/media/sub" },
    { root: "library", path: "nope/a.mp3" },
    { root: "decks", path: "d/media/a.wav" },
  ]);
  expect(staged).toEqual([1, 7]);
  const length = files.bytes(id, [], ["0", "1"]);
  const zip = new Uint8Array(await new Response(files.stream(id, [], ["0", "1"])).arrayBuffer());
  expect(zip.length).toBe(length);
  expect(new TextDecoder().decode(zip)).toContain("RIFF read der Apfel");
});

type Api = Awaited<ReturnType<typeof withDecks>>;
const WAV = new TextEncoder().encode("RIFF read der Apfel");

/** A deck folder's extras.json and media, as the server writes them. */
function put(root: string, folder: string, words: Record<string, unknown>, media: string[] = []) {
  const dir = join(root, "decks", folder);
  mkdirSync(join(dir, "media"), { recursive: true });
  writeFileSync(join(dir, "extras.json"), JSON.stringify({ format: 2, words }));
  for (const name of media) writeFileSync(join(dir, "media", name), WAV);
}

/** A deck exported as the web does it: made ready, asked after, downloaded once; read back. */
async function exported(api: Api, body: Record<string, string>, cookie = api.cookie) {
  const res = await api.anonymous("POST", "/api/decks/apkg", body, { cookie });
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
  const ready = (await res.json()) as any;
  expect(res.status).toBe(200);
  expect(ready.fileName).toEndWith(".apkg");
  const url = `/api/decks/apkg/${ready.id}`;
  expect((await api.app.request(url, { method: "HEAD", headers: { cookie } })).status).toBe(200);
  const got = await api.app.request(url, { headers: { cookie } });
  expect(got.status).toBe(200);
  expect(got.headers.get("content-disposition")).toContain(ready.fileName);
  const bytes = new Uint8Array(await got.arrayBuffer());
  expect(bytes.length).toBe(ready.bytes);
  // Once.
  expect((await api.app.request(url, { headers: { cookie } })).status).toBe(404);
  return { ready, bytes, apkg: readApkg(bytes, bunApkgRuntime) };
}

test("an imported deck as an .apkg: its words, their audio — the deck's own, else the reading made —, the AI's examples; the same notes again", async () => {
  const api = await withDecks();
  const { id } = await api.importDeck();
  put(
    api.root,
    id,
    {
      "lex:de:apfel:noun:m": {
        audio: {
          path: "media/read-apfel.wav",
          engine: "piper",
          voice: "v",
          text: "der Apfel",
          made: 1,
        },
        examples: {
          ru: {
            items: [{ sentence: "Der Apfel ist rot.", translation: "Яблоко красное." }],
            model: "m",
            made: 1,
          },
        },
      },
    },
    ["read-apfel.wav"],
  );
  const { ready, apkg } = await exported(api, { scope: `deck:${id}`, title: "Mein Deck" });
  expect(ready).toMatchObject({ notes: 4, withAudio: 2 });
  expect(ready.fileName).toStartWith(`${id}-`);
  expect(apkg.deckName).toBe("Mein Deck");
  const byFront = new Map(apkg.notes.map((n) => [n.fields[0]?.replace(/<.*/, ""), n]));
  expect([...byFront.keys()]).toEqual(["der Kaffee", "die Leute", "der Apfel", "antworten"]);
  const kaffee = byFront.get("der Kaffee");
  expect(kaffee?.fieldNames).toEqual(["Front", "Back", "Audio", "Example"]);
  expect(kaffee?.fields[1]).toBe("кофе");
  const sound = (n: typeof kaffee) => /\[sound:([^\]]+)\]/.exec(n?.fields[2] ?? "")?.[1] ?? "";
  expect(apkg.media([sound(kaffee)]).get(sound(kaffee))).toEqual(SOUND);
  const apfel = byFront.get("der Apfel");
  expect(apkg.media([sound(apfel)]).get(sound(apfel))).toEqual(WAV);
  expect(apfel?.fields[3]).toContain("Der Apfel ist rot.");
  expect(byFront.get("antworten")?.fields[2]).toBe("");

  // Again: the same notes (Anki updates them), its examples left out once the learner turned them off.
  await api.sendJson("PUT", "/api/settings", { key: "llm.offIn", value: ["example"] });
  const again = await exported(api, { scope: `deck:${id}`, title: "Mein Deck" });
  expect(again.apkg.notes.map((n) => n.guid)).toEqual(apkg.notes.map((n) => n.guid));
  expect(again.apkg.notes.find((n) => n.fields[0]?.startsWith("der Apfel"))?.fields[3]).toBe("");

  // Imported here, it is a deck of its words.
  const preview = await api.preview(again.bytes);
  expect(preview).toMatchObject({ title: "Mein Deck", words: 4 });
});

test("a course's words in an edition: their recordings from the library, the readings made for the rest", async () => {
  const api = await withDecks();
  const folder = courseDeckFolder(COURSE);
  put(
    api.root,
    folder,
    {
      "lex:de:gern:word": {
        audio: { path: "media/read-gern.wav", engine: "piper", voice: "v", text: "gern", made: 1 },
      },
    },
    ["read-gern.wav"],
  );
  const { ready, apkg } = await exported(api, {
    scope: `course:${COURSE}`,
    edition: "ru-de",
    title: "Demo",
  });
  expect(ready.fileName).toStartWith("sprachanker.fixture-demo-ru-");
  expect(ready).toMatchObject({ notes: 6, withAudio: 3 });
  expect(apkg.deckName).toBe("Demo");
  const sounds = apkg.notes.flatMap((n) => /\[sound:([^\]]+)\]/.exec(n.fields[2] ?? "")?.[1] ?? []);
  expect(sounds).toHaveLength(3);
  const media = apkg.media(sounds);
  expect(media.size).toBe(3);
  expect(
    [...media.values()].filter((b) => b.length === WAV.length && b.every((x, i) => x === WAV[i])),
  ).toHaveLength(1);
  // A course not here, a deck not here: none.
  for (const scope of [`course:${COURSE}x`, "deck:nope"]) {
    const res = await api.anonymous(
      "POST",
      "/api/decks/apkg",
      { scope, title: "X" },
      { cookie: api.cookie },
    );
    expect(res.status).toBe(404);
  }
});

test("a profile's Finds: exported by it, named by its pair; another profile sees no such deck", async () => {
  const api = await withDecks();
  const finds = "finds-local-ru-de";
  mkdirSync(join(api.root, "decks", finds), { recursive: true });
  writeFileSync(
    join(api.root, "decks", finds, "deck.json"),
    JSON.stringify({
      format: 1,
      id: finds,
      title: "Finds",
      lang: "de",
      translationLang: "ru",
      source: { file: "", importedAt: 1 },
      owner: "local",
      words: [
        {
          key: "w1",
          target: "die Situation",
          lexeme: "lex:de:situation:noun:f",
          translation: "ситуация",
          tags: [],
        },
      ],
    }),
  );
  const made = await api.anonymous("POST", "/api/profiles", { name: "Anna" });
  const anna = (made.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const body = { scope: `deck:${finds}`, title: "Находки" };
  const refused = await api.anonymous("POST", "/api/decks/apkg", body, { cookie: anna });
  expect(await refused.json()).toEqual({ error: "no_such_deck" });
  const { ready, apkg } = await exported(api, body);
  expect(ready.fileName).toStartWith("finds-ru-de-");
  expect(apkg.deckName).toBe("Находки");
  expect(apkg.notes.map((n) => n.fields.slice(0, 2))).toEqual([["die Situation", "ситуация"]]);
});
