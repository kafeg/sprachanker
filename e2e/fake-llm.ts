// A fake OpenAI-compatible server for the e2e run: fixed replies, so the AI screens are tested without
// a real model (LM Studio on the developer's machine is never used). Started by playwright.config.ts.
export const FAKE_LLM_PORT = 4591;
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
/** Structured replies by the task's schema name; the writing check otherwise. */
const STRUCTURED: Record<string, unknown> = { scene_setup: SCENE_SETUP, scene_turn: SCENE_TURN };

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
      };
      if (!body.stream) {
        const task = body.response_format?.json_schema?.name ?? "";
        const content = body.response_format
          ? JSON.stringify(STRUCTURED[task] ?? WRITING_CHECK)
          : FAKE_TEXT;
        return Response.json({ choices: [{ message: { role: "assistant", content } }] });
      }
      return sse(FAKE_TEXT);
    },
  });
  console.log(`fake LLM on 127.0.0.1:${FAKE_LLM_PORT}`);
}
