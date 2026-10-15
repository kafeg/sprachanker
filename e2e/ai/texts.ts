// The text generator's work made in bulk with a real model (owner, 2026-10-12:
// generate many and read them — coherent, natural, worth a lesson, the keys right, harder as the
// course goes on): Reading's and Listening's texts, Writing's tasks with the message they answer,
// Speaking's tasks (`speaking` twice: a monologue card and a role-play, the kinds taking turns). The server from sources on a throwaway data root (the library an APFS clone, a new
// profile), the model of `TEXTS_PROVIDER` / `TEXTS_MODEL` (claude-code · sonnet by default), a text
// of each step for each lesson of `TEXTS_LESSONS` (series/course/lesson@edition, comma-separated; the
// default: Nicos Weg A1 and A2 from the start, the middle and the end) `TEXTS_EACH` times, three
// lessons at a time; `TEXTS_STEPS` the steps (default reading,listening). Writes `report.md` (every
// text as the learner gets it, with its rating, its questions keyed; every task as set) and `texts.json` into `TEXTS_OUT` (default: a folder in
// the system's temp). The Mac only, not in CI: `bun run practice:texts`.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = join(tmpdir(), "sprachanker-texts");
const OUT = process.env.TEXTS_OUT ?? join(ROOT, "out");
const PORT = Number(process.env.TEXTS_PORT ?? 4597);
const BASE = `http://127.0.0.1:${PORT}`;
const PROVIDER = process.env.TEXTS_PROVIDER ?? "claude-code";
const MODEL = process.env.TEXTS_MODEL ?? "sonnet";
const EACH = Number(process.env.TEXTS_EACH ?? 1);
const AT_ONCE = Number(process.env.TEXTS_AT_ONCE ?? 3);
const STEPS = (process.env.TEXTS_STEPS ?? "reading,listening").split(",");
const LIBRARY = process.env.SPRACHANKER_LIBRARY ?? join(homedir(), "SprachAnker", "library");
const LESSONS = (
  process.env.TEXTS_LESSONS ??
  [
    "dw.nicos-weg/a1-ru/00-01@ru-de",
    "dw.nicos-weg/a1-ru/02-02@ru-de",
    "dw.nicos-weg/a1-ru/07-02@ru-de",
    "dw.nicos-weg/a1-ru/12-03@ru-de",
    "dw.nicos-weg/a1-ru/19-01@ru-de",
    "dw.nicos-weg/a2-ru/01-02@ru-de",
    "dw.nicos-weg/a2-ru/10-02@ru-de",
    "dw.nicos-weg/a2-ru/18-03@ru-de",
  ].join(",")
).split(",");

const cli = resolve(import.meta.dirname, "../../apps/cli/src/main.ts");

interface Made {
  lesson: string;
  step: string;
  ms: number;
  text?: {
    model: string;
    latencyMs: number;
    result: {
      step?: string;
      genre?: string;
      kind: string;
      title: string;
      situation: string;
      people?: Array<{ name: string; gender: string; age: string }>;
      voices?: { engine: string; by: Record<string, string> };
      lines: Array<{ speaker?: string; text: string }>;
      glossary: Array<{ word: string; translation: string }>;
      questions: Array<{
        question: string;
        options?: string[];
        answer?: number;
        accepted?: string[];
      }>;
      rating?: Record<string, number>;
    };
  };
  /** Writing's or Speaking's task as set. */
  task?: { model: string; result: Record<string, unknown> };
  error?: string;
}

type Line = { speaker?: string; text: string };
const quoted = (lines: Line[]) =>
  lines.map((l) => `> ${l.speaker ? `**${l.speaker}:** ` : ""}${l.text}`);

/** A writing or speaking task as the learner gets it. */
function taskLines(r: Record<string, unknown>): string[] {
  const out: string[] = [];
  const message = r.message as { genre?: string; setting: string; lines: Line[] } | undefined;
  if (message)
    out.push(
      `message: ${message.setting} (${message.genre}, ${words(message.lines)} words)`,
      "",
      ...quoted(message.lines),
      "",
    );
  if (r.kind === "roleplay") {
    const cue = new Map((r.cues as Array<{ n: number; cue: string }>).map((c) => [c.n, c.cue]));
    const lines = r.lines as Line[];
    const partner = r.partner as { name: string; gender: string; age: string };
    out.push(
      `**${r.setting}** (${r.genre}) — ${r.situation} You are: ${r.role} (${r.learner}); partner ${partner.name} (${partner.gender}, ${partner.age})`,
      "",
      ...lines.map((l, n) =>
        l.speaker === r.learner
          ? `> *[${cue.get(n) ?? "NO HINT"}]* ${l.text}`
          : `> **${l.speaker}:** ${l.text}`,
      ),
      "",
    );
    return out;
  }
  if (r.kind === "monologue")
    return [
      `**${r.setting}** — ${r.instruction} (${r.seconds} s)`,
      "",
      `${r.topic}: ${(r.points as string[]).join(" · ")}`,
      "",
      `model: ${r.model}`,
      "",
    ];
  out.push(
    `**${r.situation}** (${r.words} words)`,
    "",
    ...(r.points as string[]).map((p, i) => `${i + 1}. ${p}`),
    "",
  );
  return out;
}

/** The request that makes a step's text or task. */
const MAKE: Record<string, string> = {
  reading: "/api/llm/understanding",
  listening: "/api/llm/understanding",
  writing: "/api/llm/writing/task",
  speaking: "/api/llm/talk",
};

async function start() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "data", "library"), { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const series = new Set(LESSONS.map((l) => l.split("/")[0] as string));
  for (const s of series)
    if (existsSync(join(LIBRARY, s)))
      execFileSync("cp", ["-c", "-R", join(LIBRARY, s), join(ROOT, "data", "library")]);
  const server = spawn(
    "bun",
    [cli, "serve", "--port", String(PORT), "--data", join(ROOT, "data")],
    {
      stdio: ["ignore", "ignore", "inherit"],
      cwd: tmpdir(),
      env: { ...process.env, SPRACHANKER_APP_DATA: join(ROOT, "app") },
    },
  );
  for (let i = 0; i < 100 && !(await fetch(`${BASE}/api/health`).catch(() => undefined))?.ok; i++)
    await new Promise((r) => setTimeout(r, 200));
  const made = await fetch(`${BASE}/api/profiles`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sprachanker": "1" },
    body: JSON.stringify({ name: "Texts" }),
  });
  const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const headers = { "content-type": "application/json", "x-sprachanker": "1", cookie };
  const send = async (method: string, path: string, body: unknown) => {
    // A text takes minutes (drafts, a judge, questions, checks): no time limit of fetch's own.
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
      timeout: false,
    } as RequestInit);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    return json;
  };
  await send("PUT", "/api/llm/route", { provider: PROVIDER, model: MODEL });
  await send("PUT", "/api/settings", { key: "uiLanguage", value: "ru" });
  return { server, send };
}

const words = (lines: Array<{ text: string }>) =>
  lines.reduce(
    (n, l) => n + (l.text.match(/[\p{L}\p{N}]+(?:[,.'’-][\p{L}\p{N}]+)*/gu)?.length ?? 0),
    0,
  );

function report(all: Made[]) {
  const out: string[] = [`# Texts made (${PROVIDER} · ${MODEL}), ${new Date().toISOString()}`, ""];
  const ok = all.filter((m) => m.text || m.task);
  out.push(
    `${ok.length} of ${all.length} made; average ${Math.round(ok.reduce((n, m) => n + m.ms, 0) / Math.max(1, ok.length) / 1000)} s each.`,
    "",
  );
  for (const m of all) {
    out.push(`## ${m.lesson} · ${m.step}${m.text || m.task ? "" : " — FAILED"}`, "");
    if (m.task) {
      out.push(`${Math.round(m.ms / 1000)} s`, "", ...taskLines(m.task.result));
      continue;
    }
    if (!m.text) {
      out.push(`> ${m.error}`, "");
      continue;
    }
    const r = m.text.result;
    const rating = r.rating
      ? Object.entries(r.rating)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")
      : "—";
    out.push(
      `**${r.title}** — ${r.situation}`,
      "",
      `genre ${r.genre} · ${words(r.lines)} words · ${Math.round(m.ms / 1000)} s · ${rating}`,
      "",
      `people: ${(r.people ?? []).map((p) => `${p.name} (${p.gender}, ${p.age})`).join(", ")}${r.voices ? ` · voices ${JSON.stringify(r.voices.by)}` : ""}`,
      "",
      ...quoted(r.lines),
      "",
      ...r.questions.map((q, i) =>
        q.options
          ? `${i + 1}. ${q.question} — ${q.options.map((o, k) => (k === q.answer ? `**${o}**` : o)).join(" / ")}`
          : `${i + 1}. ${q.question} — typed: ${q.accepted?.join(" | ")}`,
      ),
      "",
      r.glossary.length
        ? `glossary: ${r.glossary.map((g) => `${g.word} — ${g.translation}`).join("; ")}`
        : "",
      "",
    );
  }
  writeFileSync(join(OUT, "report.md"), out.join("\n"));
  writeFileSync(join(OUT, "texts.json"), JSON.stringify(all, null, 2));
}

if (import.meta.main) {
  if (!existsSync(LIBRARY)) {
    console.error(`no library at ${LIBRARY} (set SPRACHANKER_LIBRARY)`);
    process.exit(1);
  }
  const { server, send } = await start();
  const all: Made[] = [];
  const jobs = LESSONS.flatMap((spec) =>
    Array.from({ length: EACH }, () => {
      const [key = "", edition = "ru-de"] = spec.split("@");
      return { key, edition };
    }),
  );
  try {
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const { key, edition } = jobs[next++] as { key: string; edition: string };
        const series = key.split("/")[0] as string;
        const lesson = { series, lessonKey: key, edition };
        await send("POST", "/api/runs", lesson).catch((e) => console.error(String(e)));
        for (const step of STEPS) {
          const started = Date.now();
          try {
            const made = await send("POST", MAKE[step] ?? "/api/llm/understanding", {
              ...lesson,
              language: edition.split("-")[0],
              step,
            });
            const ms = Date.now() - started;
            const kind = step === "writing" || step === "speaking" ? "task" : "text";
            all.push({ lesson: key, step, ms, [kind]: made });
            const name = made.result.title ?? made.result.setting ?? made.result.situation;
            console.log(`${key} ${step}: ${name} (${Math.round(ms / 1000)} s)`);
          } catch (error) {
            all.push({ lesson: key, step, ms: Date.now() - started, error: String(error) });
            console.log(`${key} ${step}: FAILED ${String(error).slice(0, 200)}`);
          }
          report(all);
        }
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
  } finally {
    server.kill();
  }
  report(all);
  console.log(`report: ${join(OUT, "report.md")}`);
}
