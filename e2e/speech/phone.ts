// Whisper in a phone's browser: the phrases (phrases.ts: read by Qwen3-TTS, heard by this Mac for
// comparison) served with a page (phone.html) that hears them in the browser itself — transformers.js on the
// CPU (WASM) and the GPU (WebGPU), Whisper tiny, base and small — timing each and sending what it
// heard back here; scored as the share of words heard. A page needs a secure context: on an Android
// phone over adb, http://localhost through `adb reverse` (done here when adb sees one); elsewhere,
// https (`tailscale serve --https=8443 http://127.0.0.1:4594`). `bun run speech:phone`; Ctrl-C ends it.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRoot } from "./app.ts";
import { heard, readPhrases } from "./phrases.ts";

const ROOT = checkRoot("sprachanker-speech-phone");
const APP_PORT = 4593;
const PORT = Number(process.env.SPEECH_PHONE_PORT ?? 4594);

// The phrases read and heard on this Mac.
const { phrases, wavs } = await readPhrases(ROOT, APP_PORT);

const page = readFileSync(new URL("./phone.html", import.meta.url), "utf8");
const results = join(ROOT, "results.ndjson");
// Isolated, so the page's WASM may use threads (SharedArrayBuffer).
const isolated = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cache-control": "no-store",
};

interface Run {
  device: string;
  model: string;
  backend: string;
  dtype: string;
  loadMs: number;
  rows: Array<{ id: string; ms: number; text: string }>;
  error?: string;
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/")
      return new Response(page, { headers: { ...isolated, "content-type": "text/html" } });
    if (pathname === "/phrases.json") return Response.json(phrases, { headers: isolated });
    const wav = pathname.match(/^\/audio\/(p\d+)\.wav$/);
    if (wav?.[1] && wavs.has(wav[1]))
      return new Response(wavs.get(wav[1]), {
        headers: { ...isolated, "content-type": "audio/wav" },
      });
    if (pathname === "/results" && req.method === "POST") {
      const run = (await req.json()) as Run;
      appendFileSync(results, `${JSON.stringify({ at: new Date().toISOString(), ...run })}\n`);
      console.log(
        `\n${run.device}\n${run.model} · ${run.backend} · ${run.dtype} · loaded in ${run.loadMs} ms`,
      );
      if (run.error) console.log(`  failed: ${run.error}`);
      for (const r of run.rows) {
        const p = phrases.find((x) => x.id === r.id);
        if (!p) continue;
        const score = Math.round(heard(p.text, r.text) * 100);
        console.log(
          `  ${r.id}  ${p.seconds}s  ${r.ms} ms  ×${(r.ms / 1000 / p.seconds).toFixed(2)}  ${score}%  ${r.text}`,
        );
      }
      return Response.json({ ok: true }, { headers: isolated });
    }
    return new Response("not found", { status: 404, headers: isolated });
  },
});

// An Android phone over adb: its localhost is this page (a secure context without https).
try {
  const devices = execFileSync("adb", ["devices"], { encoding: "utf8" })
    .split("\n")
    .slice(1)
    .filter((l) => l.endsWith("\tdevice"))
    .map((l) => l.split("\t")[0] as string);
  for (const d of devices) execFileSync("adb", ["-s", d, "reverse", `tcp:${PORT}`, `tcp:${PORT}`]);
  if (devices.length) console.log(`\nadb: ${devices.join(", ")} → http://localhost:${PORT}`);
} catch {
  // No adb here.
}
console.log(`\nThe page: http://127.0.0.1:${PORT} (results also in ${results}); Ctrl-C ends it.`);
