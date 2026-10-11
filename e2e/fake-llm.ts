// A fake OpenAI-compatible server for the e2e run: fixed replies, so the AI screens are tested without
// a real model (LM Studio on the developer's machine is never used). Started by playwright.config.ts.
// Not 4591: that is e2e:real's server, which may run beside this run.
export const FAKE_LLM_PORT = 4593;
export const FAKE_TEXT = "FAKE: the verb ends in -e here.";

/** A writing task: a situation and its three points (the length is the app's). */
const WRITING_TASK = {
  situation: "FAKE: You are meeting Lena at the café. Write her a message.",
  points: ["FAKE: say who you are", "FAKE: say why you write", "FAKE: say when you come"],
};
/** A text on it checked: each point rated, a correction, a model text. */
const WRITING_CHECK = {
  verdict: "minor_errors",
  corrected: "Ich heiße Lena.",
  corrections: [{ wrong: "heisse", right: "heiße", explanation: "FAKE: ß after a long vowel." }],
  criteria: {
    task: { score: 2, comment: "ok" },
    communication: { score: 2, comment: "ok" },
    accuracy: { score: 1, comment: "one spelling mistake" },
  },
  points: [
    { score: 2, comment: "FAKE: said who." },
    { score: 0, comment: "FAKE: no reason given." },
    { score: 0, comment: "FAKE: no time given." },
  ],
  modelText: "FAKE: Hallo Lena, ich heiße Anna. Ich komme um fünf.",
  feedback: "FAKE: a good start.",
};

const SCENE_SETUP = {
  title: "FAKE: Im Café",
  situation: "FAKE: you are at a café table.",
  partner: "FAKE: the waiter",
  goals: ["Order a coffee", "Pay"],
  opening: "FAKE: Guten Tag! Was möchten Sie?",
  openingTranslation: "FAKE: Hello! What would you like?",
  partnerInfo: ["FAKE: Ein Kaffee kostet 2,50 Euro."],
};
const SCENE_TURN = {
  reply: "FAKE: Gern. Sonst noch etwas?",
  translation: "FAKE: Sure. Anything else?",
  understood: true,
  fits: true,
  corrections: [{ wrong: "Kaffe", right: "Kaffee", explanation: "FAKE: double e." }],
  goalsMet: [0],
  done: false,
};
const SCENE_SUMMARY = {
  corrections: [
    {
      wrong: "Kaffe",
      right: "Kaffee",
      explanation: "FAKE: double e.",
      model: "FAKE: Einen Kaffee, bitte.",
    },
  ],
  feedback: "FAKE: well asked.",
};
/** An Understanding text (a dialogue of two, heard first) and its second reading, which settles
 *  every question as its key does. */
const UNDERSTANDING_TEXT = {
  kind: "dialogue",
  title: "FAKE: Beim Bäcker",
  situation: "FAKE: Anna buys rolls.",
  lines: [
    { speaker: "Anna", text: "Guten Morgen! Zwei Brötchen, bitte." },
    { speaker: "Verkäufer", text: "Gern. Das macht 1,20 Euro." },
  ],
  glossary: [{ word: "Brötchen", translation: "FAKE: rolls" }],
  questions: [
    {
      phase: "listening",
      question: "Anna möchte drei Brötchen.",
      options: ["Richtig", "Falsch"],
      answer: 1,
    },
    { phase: "listening", question: "Wie viel kostet das?", accepted: ["1,20", "1,20 Euro"] },
    {
      phase: "listening",
      question: "Wann ist das?",
      options: ["am Abend", "am Morgen", "in der Nacht"],
      answer: 1,
    },
    {
      phase: "reading",
      question: "Wer verkauft?",
      options: ["Anna", "der Verkäufer", "niemand"],
      answer: 1,
    },
  ],
};
const UNDERSTANDING_CHECK = {
  answers: [
    { n: 1, choice: "b", ambiguous: false },
    { n: 2, answer: "1,20", ambiguous: false },
    { n: 3, choice: "b", ambiguous: false },
    { n: 4, choice: "b", ambiguous: false },
  ],
};

/** Two new items of a type going over mistakes, as the model writes them. */
const NEW_ITEMS: Record<string, unknown[]> = {
  single_choice: [
    { prompt: "FAKE: Wo ist Tom?", options: ["Im Café.", "Im Park."], answer: 0 },
    { prompt: "FAKE: Wo ist Anna?", options: ["Im Café.", "Im Park."], answer: 0 },
  ],
  gap_text: [
    { text: "Ich ___ Tee.", gaps: [{ accepted: ["trinke"] }] },
    { text: "Du ___ Tee.", gaps: [{ accepted: ["trinkst"] }] },
  ],
  gap_choice: [
    { text: "Ich ___ Tee.", gaps: [{ options: ["trinke", "trinkst"], answer: 0 }] },
    { text: "Du ___ Tee.", gaps: [{ options: ["trinke", "trinkst"], answer: 1 }] },
  ],
  order: [{ parts: ["Ich", "trinke", "Tee."] }, { parts: ["Du", "trinkst", "Tee."] }],
  match: [1, 2].map(() => ({
    pairs: [
      { left: "die Tasse", right: "cup" },
      { left: "der Tee", right: "tea" },
      { left: "das Glas", right: "glass" },
    ],
  })),
};

/** A new item as the model writes it: every field, null where its type has none (strict structured
 *  outputs). */
const full = (item: unknown) => {
  const it = item as Record<string, unknown>;
  return {
    ...Object.fromEntries(
      ["prompt", "options", "answer", "text", "gaps", "parts", "pairs"].map((k) => [k, null]),
    ),
    ...it,
    ...(Array.isArray(it.gaps) && {
      gaps: it.gaps.map((g) => ({ accepted: null, options: null, answer: null, ...g })),
    }),
  };
};

/** Going over mistakes: each group of the prompt ("Group 1 — …; new items: <type>, …") explained,
 *  with two new items of its type. */
const mistakeItems = (prompt: string) => ({
  groups: [...prompt.matchAll(/^Group (\d+) — .*?; new items: (\w+),/gm)].map(([, n, type]) => ({
    n: Number(n),
    explanation: "FAKE: read the question again.",
    items: (NEW_ITEMS[type as string] ?? []).map(full),
  })),
});

/** Three examples for each word numbered in <words> ("1. der Kaffee, die Kaffees — coffee (noun)" →
 *  "Hier ist der Kaffee heute."). */
const wordExamples = (prompt: string) => {
  const lines = /<words>\n([\s\S]*?)\n<\/words>/.exec(prompt)?.[1]?.split("\n") ?? [];
  return {
    words: lines.map((line, i) => {
      // The word as learnt, without what is in brackets: "(etwas) bestellen" → "bestellen".
      const asked = /^\d+\. (.+?)(?: — |$)/.exec(line)?.[1] ?? "";
      const word =
        asked
          .replace(/\([^)]*\)/g, "")
          .split(",")[0]
          ?.trim() ?? "";
      return {
        n: i + 1,
        examples: ["heute", "hier", "dort"].map((where, k) => ({
          sentence: k ? `${word} ist ${where}.` : `Hier ist ${word} heute.`,
          translation: `FAKE: Here it is ${k ? where : "today"}.`,
          form: word,
          glossary: [{ word: "heute", translation: "today" }],
        })),
      };
    }),
  };
};

const SPOKEN_CHECK = {
  verdict: "minor_errors",
  corrected: "Hallo, guten Tag!",
  corrections: [{ wrong: "gute", right: "guten", explanation: "FAKE: der Tag → guten Tag." }],
  feedback: "FAKE: nearly there.",
};

/** The fixture exam's note rated by its criteria (when you come, what you bring, the form). */
const EXAM_RATING = {
  criteria: [
    { id: "wann", points: 3, reason: "FAKE: the time is there." },
    { id: "was", points: 1.5, reason: "FAKE: what, but not for whom." },
    { id: "form", points: 1, reason: "FAKE: greeting and closing." },
  ],
  feedback: "FAKE: say who the cake is for.",
};

/** A speaking part: the examiner opens it; after the learner's first line the partner answers and
 *  the examiner closes it. */
const conversation = (prompt: string) =>
  prompt.includes("Learner (A):")
    ? {
        lines: [
          { speaker: "partner", text: "FAKE: Ich gehe schwimmen." },
          { speaker: "examiner", text: "FAKE: Danke. Das war Teil 1." },
        ],
        done: true,
      }
    : {
        lines: [{ speaker: "examiner", text: "FAKE: Bitte fragen Sie Ihren Partner." }],
        done: false,
      };

/** Structured replies by the task's schema name; the writing check otherwise. */
const STRUCTURED: Record<string, unknown> = {
  writing_task: WRITING_TASK,
  scene_setup: SCENE_SETUP,
  scene_turn: SCENE_TURN,
  scene_summary: SCENE_SUMMARY,
  understanding_text: UNDERSTANDING_TEXT,
  understanding_check: UNDERSTANDING_CHECK,
  speaking_check: SPOKEN_CHECK,
  exam_rating: EXAM_RATING,
};

const sse = (text: string) =>
  new Response(
    [
      ...text.split(/(?<= )/).map((delta) => ({ choices: [{ delta: { content: delta } }] })),
      "[DONE]",
    ]
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );

if (import.meta.main) {
  Bun.serve({
    port: FAKE_LLM_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const { pathname } = new URL(req.url);
      // An image generator beside the chat model: the settings must leave it out.
      if (pathname === "/v1/models")
        return Response.json({
          data: [
            { id: "fake-model" },
            { id: "fake/painter", architecture: { output_modalities: ["image"] } },
          ],
        });
      if (pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
      const body = (await req.json()) as {
        stream?: boolean;
        response_format?: { json_schema?: { name?: string } };
        messages: Array<{ content: string }>;
      };
      if (!body.stream) {
        const task = body.response_format?.json_schema?.name ?? "";
        const content = !body.response_format
          ? FAKE_TEXT
          : JSON.stringify(
              task === "word_examples"
                ? wordExamples(body.messages.at(-1)?.content ?? "")
                : task === "mistake_items"
                  ? mistakeItems(body.messages.at(-1)?.content ?? "")
                  : task === "exam_conversation"
                    ? conversation(body.messages.at(-1)?.content ?? "")
                    : (STRUCTURED[task] ?? WRITING_CHECK),
            );
        return Response.json({ choices: [{ message: { role: "assistant", content } }] });
      }
      return sse(FAKE_TEXT);
    },
  });
  console.log(`fake LLM on 127.0.0.1:${FAKE_LLM_PORT}`);
}
