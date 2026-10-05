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
      if (pathname === "/v1/models") return Response.json({ data: [{ id: "fake-model" }] });
      if (pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
      const body = (await req.json()) as { stream?: boolean; response_format?: unknown };
      if (!body.stream) {
        const content = body.response_format ? JSON.stringify(WRITING_CHECK) : FAKE_TEXT;
        return Response.json({ choices: [{ message: { role: "assistant", content } }] });
      }
      return sse(FAKE_TEXT);
    },
  });
  console.log(`fake LLM on 127.0.0.1:${FAKE_LLM_PORT}`);
}
