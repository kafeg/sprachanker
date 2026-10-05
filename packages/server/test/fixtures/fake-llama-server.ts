// Stands in for llama-server in tests: same flags, /health (503 while "loading"), streamed chat.
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: false,
  options: { m: { type: "string" }, port: { type: "string" }, alias: { type: "string" } },
});
const model = String(values.m);
if (model.includes("broken")) {
  console.error("error: failed to load model");
  process.exit(1);
}
const started = Date.now();
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(values.port),
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/health")
      return new Response(null, { status: Date.now() - started < 300 ? 503 : 200 });
    if (path === "/v1/chat/completions") {
      const content = `hello from ${values.alias} (pid ${process.pid})`;
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
      );
    }
    return new Response(null, { status: 404 });
  },
});
