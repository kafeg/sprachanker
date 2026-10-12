// AI practice walked through with a real model on real lessons, as a learner who makes mistakes.
// Three phases on one throwaway data root (`WALK_OUT`: the library an APFS clone, one profile), each
// starting the server from sources and stopping it at its end:
// - `make`: each lesson's run, its exercises answered (the first two single choices wrong), Reading
//   and Listening made and answered (the first question wrong), Writing's and Speaking's tasks made;
// - `answer`: the texts and lines in `answers.json` (written by whoever walks, as a learner) checked,
//   the other kind of Speaking task made, the mistakes gone over (the first new item wrong);
// - `marks`: each lesson's practice marks, as the plan shows them.
// Everything made is in `state.json`; `report.md` lists it to read. The Mac only, not in CI:
// `bun run practice:walk make|answer|marks`. Env: WALK_OUT, WALK_LESSONS (series/course/lesson@edition,
// comma-separated), WALK_PROVIDER, WALK_MODEL, WALK_PORT, SPRACHANKER_LIBRARY.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { practiceMarks } from "@sprachanker/engine";
import type { TypedEvent } from "@sprachanker/schema";

const OUT = process.env.WALK_OUT ?? join(tmpdir(), "sprachanker-walk");
const PORT = Number(process.env.WALK_PORT ?? 4598);
const BASE = `http://127.0.0.1:${PORT}`;
const PROVIDER = process.env.WALK_PROVIDER ?? "claude-code";
const MODEL = process.env.WALK_MODEL ?? "sonnet";
const LIBRARY = process.env.SPRACHANKER_LIBRARY ?? join(homedir(), "SprachAnker", "library");
const LESSONS = (
  process.env.WALK_LESSONS ??
  [
    "dw.nicos-weg/a1-ru/01-02@ru-de",
    "dw.nicos-weg/a1-ru/08-02@ru-de",
    "dw.nicos-weg/a1-ru/16-03@ru-de",
    "dw.nicos-weg/a2-ru/05-02@ru-de",
    "dw.nicos-weg/a2-ru/15-01@ru-de",
    "dw.nicos-weg/b1-de/04-02@de-de",
    "dw.nicos-weg/b1-de/15-01@de-de",
  ].join(",")
)
  .split(",")
  .map((spec) => {
    const [key = "", edition = "ru-de"] = spec.split("@");
    const [series = "", course = "", name = ""] = key.split("/");
    return { key, series, course, name, edition };
  });
const STATE = join(OUT, "state.json");
const cli = resolve(import.meta.dirname, "../../apps/cli/src/main.ts");

// biome-ignore lint/suspicious/noExplicitAny: the API's replies as read back, shapes of many tasks
type Json = any;
const state: Record<string, Json> = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, "utf8"))
  : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

/** The server on the walk's data root; the library cloned the first time. */
async function start(): Promise<ChildProcess> {
  const data = join(OUT, "data");
  if (!existsSync(join(data, "library"))) {
    mkdirSync(join(data, "library"), { recursive: true });
    for (const s of new Set(LESSONS.map((l) => l.series)))
      execFileSync("cp", ["-c", "-R", join(LIBRARY, s), join(data, "library")]);
  }
  const server = spawn("bun", [cli, "serve", "--port", String(PORT), "--data", data], {
    stdio: ["ignore", "ignore", "inherit"],
    cwd: tmpdir(),
    env: { ...process.env, SPRACHANKER_APP_DATA: join(OUT, "app") },
  });
  for (let i = 0; i < 100 && !(await fetch(`${BASE}/api/health`).catch(() => undefined))?.ok; i++)
    await new Promise((r) => setTimeout(r, 200));
  return server;
}

async function send(method: string, path: string, body?: unknown): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-sprachanker": "1", cookie: state.cookie },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    // A text takes minutes (drafts, a judge, questions, checks): no time limit of fetch's own.
    timeout: false,
  } as RequestInit);
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`${method} ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const ulid = () => {
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let t = Date.now();
  let head = "";
  for (let i = 0; i < 10; i++, t = Math.floor(t / 32)) head = A[t % 32] + head;
  return head + Array.from({ length: 16 }, () => A[Math.floor(Math.random() * 32)]).join("");
};

type Lesson = (typeof LESSONS)[number];
const ids = (l: Lesson) => ({
  series: l.series,
  lessonKey: l.key,
  edition: l.edition,
  language: l.edition.split("-")[0],
});

/** A question answered as keyed, or wrong: another option, a typed "0". */
const answerOf = (q: Json, right: boolean) =>
  q.options
    ? { optionId: "abcdefgh"[right ? (q.answer ?? 0) : ((q.answer ?? 0) + 1) % q.options.length] }
    : { g1: right ? q.accepted[0] : "0" };

async function profile() {
  if (state.cookie) return;
  const res = await fetch(`${BASE}/api/profiles`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sprachanker": "1" },
    body: JSON.stringify({ name: "Walk" }),
  });
  state.cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  await send("PUT", "/api/llm/route", { provider: PROVIDER, model: MODEL });
  await send("PUT", "/api/settings", { key: "llm.preparePractice", value: false });
  await send("PUT", "/api/settings", { key: "uiLanguage", value: "ru" });
  save();
}

async function make(l: Lesson) {
  const req = ids(l);
  state[l.key] ??= {};
  const s = state[l.key];
  const log = (m: string) => console.log(`${l.key}: ${m}`);
  if (!s.run) {
    const { run } = await send("POST", "/api/runs", { ...req, restart: true });
    s.run = run.id;
    const file = join(
      OUT,
      "data/library",
      l.series,
      "canonical",
      l.course,
      "lessons",
      `${l.name}.json`,
    );
    const lesson = JSON.parse(readFileSync(file, "utf8"));
    const choices = lesson.pages
      .flatMap((p: Json) => (p.exercise.type === "single_choice" ? p.exercise.items : []))
      .filter((i: Json) => i.options?.length > 1)
      .slice(0, 3);
    const events = choices.map((item: Json, n: number) => {
      const right = item.answer.optionIds[0];
      const wrong = item.options.find((o: Json) => o.id !== right).id;
      return {
        id: ulid(),
        type: "answered",
        itemKey: item.key,
        payload: { answer: { optionId: n < 2 ? wrong : right }, attempt: 1, ms: 4000 },
      };
    });
    if (events.length) await send("POST", `/api/runs/${run.id}/events`, { events });
    log(`run, ${events.length} exercise answers`);
    save();
  }
  for (const step of ["reading", "listening"]) {
    if (s[step]?.result) continue;
    const t0 = Date.now();
    try {
      const text = await send("POST", "/api/llm/understanding", { ...req, step });
      for (const [i, q] of text.result.questions.entries())
        await send("POST", "/api/llm/understanding/answer", {
          ...req,
          id: text.id,
          question: i,
          answer: answerOf(q, i !== 0),
        });
      s[step] = { id: text.id, result: text.result, ms: Date.now() - t0 };
      log(`${step}: ${text.result.title} (${Math.round((Date.now() - t0) / 1000)} s)`);
    } catch (e) {
      s[step] = { error: String(e) };
      log(`${step} FAILED ${String(e).slice(0, 200)}`);
    }
    save();
  }
  if (!s.writing?.result) {
    try {
      const task = await send("POST", "/api/llm/writing/task", req);
      s.writing = { id: task.id, result: task.result };
      log(`writing: ${task.result.situation.slice(0, 80)}`);
    } catch (e) {
      s.writing = { error: String(e) };
      log(`writing FAILED ${String(e).slice(0, 200)}`);
    }
    save();
  }
  if (!s.talk?.[0]?.result) {
    try {
      const task = await send("POST", "/api/llm/talk", req);
      s.talk = [{ id: task.id, result: task.result }];
      log(`speaking: ${task.result.kind} ${task.result.setting}`);
    } catch (e) {
      s.talk = [{ error: String(e) }];
      log(`speaking FAILED ${String(e).slice(0, 200)}`);
    }
    save();
  }
}

async function answer(l: Lesson, answers: Json) {
  const req = ids(l);
  const s = state[l.key];
  const a = answers[l.key] ?? {};
  const log = (m: string) => console.log(`${l.key}: ${m}`);
  if (!s) return log("not made: run the make phase first");
  if (a.writing && s.writing?.id && !s.writingCheck) {
    const r = await send("POST", "/api/llm/writing", {
      ...req,
      taskId: s.writing.id,
      text: a.writing,
    });
    s.writingCheck = r.result;
    log(`writing checked: ${r.result.verdict}`);
    save();
  }
  for (const [i, said] of (a.talk ?? []).entries()) {
    const task = s.talk?.[i];
    if (!task?.id || task.check) continue;
    const r = await send("POST", "/api/llm/talk/check", { ...req, taskId: task.id, said });
    task.check = r.result.check;
    log(`speaking ${task.result.kind} checked`);
    save();
  }
  // The other kind next, to answer on a second run of this phase.
  if (s.talk?.[0]?.check && !s.talk[1]) {
    const next = await send("POST", "/api/llm/talk", req);
    s.talk[1] = { id: next.id, result: next.result };
    log(`speaking 2: ${next.result.kind} ${next.result.setting}`);
    save();
  }
  if (a.mistakes && !s.review) {
    const review = await send("POST", "/api/llm/mistakes", req);
    s.review = review;
    let n = 0;
    for (const g of review.result.groups)
      for (const item of g.items ?? []) {
        if (item.options) {
          const key = item.answer ?? 0;
          const optionId = "abcdefghij"[n > 0 ? key : (key + 1) % item.options.length];
          await send("POST", "/api/llm/mistakes/answer", {
            ...req,
            id: review.id,
            question: n,
            answer: { optionId },
          }).catch((e) => log(`mistake item ${n}: ${String(e).slice(0, 120)}`));
        }
        n++;
      }
    log(`mistakes: ${review.result.groups.length} types, ${n} items`);
    save();
  }
}

async function marks() {
  const out: string[] = [];
  for (const l of LESSONS) {
    const { state: run } = await send(
      "GET",
      `/api/runs/lesson?series=${l.series}&lessonKey=${encodeURIComponent(l.key)}`,
    );
    const m = practiceMarks(run.events as TypedEvent[]);
    out.push(`${l.key}: ${JSON.stringify(Object.fromEntries(m))}`);
  }
  console.log(out.join("\n"));
}

/** Everything made so far, to read: tasks with their messages and cues, checks with corrections. */
function report() {
  const out: string[] = [`# AI practice walk (${PROVIDER} · ${MODEL})`, ""];
  const lines = (ls: Json[]) =>
    ls.map((x) => `> ${x.speaker ? `**${x.speaker}:** ` : ""}${x.text}`);
  for (const l of LESSONS) {
    const s = state[l.key];
    if (!s) continue;
    out.push(`## ${l.key}`, "");
    for (const step of ["reading", "listening"]) {
      const r = s[step]?.result;
      if (!r) {
        out.push(`### ${step} — FAILED`, `> ${s[step]?.error}`, "");
        continue;
      }
      out.push(`### ${step}: ${r.title} (${r.genre})`, r.situation, "", ...lines(r.lines), "");
      for (const q of r.questions)
        out.push(
          `- ${q.question} — ${q.options ? q.options.map((o: string, k: number) => (k === q.answer ? `**${o}**` : o)).join(" / ") : q.accepted?.join(" | ")}`,
        );
      out.push("");
    }
    const w = s.writing?.result;
    if (w) {
      out.push(`### writing (${w.words} words)`, "");
      if (w.message) out.push(`message: ${w.message.setting}`, ...lines(w.message.lines), "");
      out.push(w.situation, ...w.points.map((p: string) => `1. ${p}`), "");
      const c = s.writingCheck;
      if (c)
        out.push(
          `check: ${c.verdict} — ${c.feedback}`,
          ...c.corrections.map((x: Json) => `- ${x.wrong} → ${x.right}: ${x.explanation}`),
          "",
        );
    }
    for (const t of s.talk ?? []) {
      const r = t.result;
      if (!r) continue;
      if (r.kind === "monologue")
        out.push(
          `### speaking: monologue ${r.setting}`,
          r.instruction,
          `${r.topic}: ${r.points.join(" · ")}`,
          "",
        );
      else {
        const cue = new Map(r.cues.map((c: Json) => [c.n, c.cue]));
        out.push(`### speaking: role-play ${r.setting} (you: ${r.role})`, "");
        out.push(
          ...r.lines.map((x: Json, n: number) =>
            x.speaker === r.learner
              ? `> ${n}. *[${cue.get(n) ?? "NO HINT"}]*`
              : `> ${n}. **${x.speaker}:** ${x.text}`,
          ),
          "",
        );
      }
      if (t.check) out.push("```json", JSON.stringify(t.check, null, 1).slice(0, 1500), "```", "");
    }
  }
  writeFileSync(join(OUT, "report.md"), out.join("\n"));
  console.log(`report: ${join(OUT, "report.md")}`);
}

if (import.meta.main) {
  const phase = process.argv[2];
  if (!["make", "answer", "marks", "report"].includes(phase ?? "")) {
    console.error("usage: walk.ts make|answer|marks|report");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  if (phase === "report") report();
  else {
    const server = await start();
    try {
      await profile();
      if (phase === "make") await Promise.all(LESSONS.map((l) => make(l)));
      if (phase === "answer") {
        const answers = JSON.parse(readFileSync(join(OUT, "answers.json"), "utf8"));
        await Promise.all(
          LESSONS.map((l) =>
            answer(l, answers).catch((e) =>
              console.log(`${l.key}: FAILED ${String(e).slice(0, 300)}`),
            ),
          ),
        );
      }
      if (phase === "marks") await marks();
    } finally {
      server.kill();
    }
    report();
  }
}
