// A fake OpenAI-compatible server for the e2e run: fixed replies, so the AI screens are tested without
// a real model (LM Studio on the developer's machine is never used). Started by playwright.config.ts.
// Not 4591: that is e2e:real's server, which may run beside this run.
export const FAKE_LLM_PORT = 4593;
export const FAKE_TEXT = "FAKE: the verb ends in -e here.";

const WRITING_CHECK = {
  verdict: "minor_errors",
  corrected: "Ich heiße Lena.",
  corrections: [{ wrong: "heisse", right: "heiße", explanation: "FAKE: ß after a long vowel." }],
  criteria: {
    task: { score: 2, comment: "ok" },
    communication: { score: 2, comment: "ok" },
    accuracy: { score: 1, comment: "one spelling mistake" },
  },
  feedback: "FAKE: a good start.",
};

const SCENE_SETUP = {
  title: "FAKE: Im Café",
  situation: "FAKE: you are at a café table.",
  partner: "FAKE: the waiter",
  goals: ["Order a coffee", "Pay"],
  opening: "FAKE: Guten Tag! Was möchten Sie?",
};
const SCENE_TURN = {
  reply: "FAKE: Gern. Sonst noch etwas?",
  translation: "FAKE: Sure. Anything else?",
  corrections: [{ wrong: "Kaffe", right: "Kaffee", explanation: "FAKE: double e." }],
  goalsMet: [0],
  done: false,
};
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
  scene_setup: SCENE_SETUP,
  scene_turn: SCENE_TURN,
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
