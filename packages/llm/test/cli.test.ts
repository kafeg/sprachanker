// The command-line backends against a fake runner: no process is started.
import { expect, test } from "bun:test";
import { CLI_LIMITS, type CliRun, cliClient, cliPrompt, cliRun } from "../src/cli.ts";
import { chatBody } from "../src/client.ts";
import { LlmError } from "../src/errors.ts";
import { TUTOR_TOOLS_REMINDER, TUTOR_TOOLS_RULE } from "../src/tasks/tutor-tools.ts";

function fakeRunner(lines: string[]) {
  const runs: CliRun[] = [];
  const run = (r: CliRun) => {
    runs.push(r);
    return (async function* () {
      yield* lines;
    })();
  };
  return { run, runs };
}

const event = (e: unknown) => JSON.stringify(e);
const delta = (text: string) =>
  event({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text } },
  });

test("cliPrompt: system messages as instructions, earlier turns as a transcript", () => {
  const { system, prompt } = cliPrompt(
    [
      { role: "system", content: "Rules." },
      { role: "user", content: "Hallo?" },
      { role: "assistant", content: "Hallo!" },
      { role: "user", content: "Wie geht's?" },
    ],
    true,
  );
  expect(system).toStartWith("Rules.");
  expect(system).toContain("Tools are not available");
  expect(prompt).toBe(
    "<conversation>\nLearner: Hallo?\n\nYou: Hallo!\n</conversation>\n\nLearner: Wie geht's?",
  );
  expect(cliPrompt([{ role: "user", content: "Nur das" }], false).prompt).toBe("Nur das");
});

test("claude: streamed text deltas, own system prompt, no tools or settings", async () => {
  const fake = fakeRunner([
    event({ type: "system", subtype: "init" }),
    delta("Der "),
    delta("Tee."),
    event({ type: "result", subtype: "success", is_error: false, result: "Der Tee." }),
  ]);
  const client = cliClient("claude", fake.run);
  let text = "";
  for await (const t of client.chat({
    model: "sonnet",
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "Tee?" },
    ],
    reasoning: false,
    effort: "low",
  }))
    text += t;
  expect(text).toBe("Der Tee.");
  const run = fake.runs[0] as CliRun;
  expect(run.stdin).toBe("Tee?");
  expect(run.files).toEqual({ "system.txt": "Be brief." });
  expect(run.args).toEqual(
    expect.arrayContaining(["-p", "--model", "sonnet", "--tools", "", "--effort", "low"]),
  );
  expect(run.args.join(" ")).toContain("--system-prompt-file system.txt");
});

test("claude: structured output from the JSON result; errors as LlmError", async () => {
  const ok = fakeRunner([
    event({
      type: "result",
      subtype: "success",
      is_error: false,
      structured_output: { verdict: "good" },
    }),
  ]);
  const schema = { type: "object" };
  const reply = await cliClient("claude", ok.run).complete({
    model: "haiku",
    messages: [{ role: "user", content: "x" }],
    jsonSchema: { name: "t", schema },
  });
  expect(JSON.parse(reply)).toEqual({ verdict: "good" });
  expect(ok.runs[0]?.args).toEqual(
    expect.arrayContaining(["--json-schema", JSON.stringify(schema)]),
  );

  const denied = fakeRunner([
    event({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Invalid API key · Please run /login",
    }),
  ]);
  const error = await cliClient("claude", denied.run)
    .complete({ model: "haiku", messages: [{ role: "user", content: "x" }] })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LlmError);
  expect((error as LlmError).code).toBe("unauthorized");
});

test("codex: instructions in stdin, the agent's message as the reply, schema as a file", async () => {
  const fake = fakeRunner([
    event({ type: "thread.started", thread_id: "t" }),
    event({
      type: "item.completed",
      item: { id: "i", type: "agent_message", text: '{"ok":true}' },
    }),
    event({ type: "turn.completed", usage: {} }),
  ]);
  const reply = await cliClient("codex", fake.run).complete({
    model: "gpt-5",
    messages: [
      { role: "system", content: "Check it." },
      { role: "user", content: "Ich heisse Lena." },
    ],
    jsonSchema: { name: "t", schema: { type: "object" } },
  });
  expect(reply).toBe('{"ok":true}');
  const run = fake.runs[0] as CliRun;
  expect(run.args).toEqual(
    expect.arrayContaining([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--output-schema",
      "schema.json",
      "-",
    ]),
  );
  expect(run.files).toEqual({ "schema.json": '{"type":"object"}' });
  expect(run.stdin).toStartWith("<instructions>\nCheck it.");
  expect(run.stdin).toEndWith("Ich heisse Lena.");
});

test("a command that fails to start is reported, not thrown raw, nor run again", async () => {
  let runs = 0;
  const run = () =>
    (async function* () {
      runs++;
      yield* [];
      throw new Error("spawn claude ENOENT");
    })();
  const error = await cliClient("claude", run)
    .complete({ model: "sonnet", messages: [{ role: "user", content: "x" }] })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LlmError);
  expect((error as LlmError).code).toBe("bad_response");
  expect(runs).toBe(1);
});

test("claude's effort: low only for a short check; the user's environment never overrides it", () => {
  const request = { model: "sonnet", messages: [{ role: "user" as const, content: "x" }] };
  const turn = cliRun("claude", { ...request, reasoning: false });
  expect(turn.args).not.toContain("--effort");
  expect(turn.env).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: undefined, CLAUDE_CODE_MAX_RETRIES: "3" });
  expect(cliRun("claude", { ...request, effort: "low" }).args).toEqual(
    expect.arrayContaining(["--effort", "low"]),
  );
  expect(cliRun("codex", { ...request, effort: "low" }).args.join(" ")).toContain(
    'model_reasoning_effort="low"',
  );
  expect(cliRun("codex", request).args.join(" ")).not.toContain("model_reasoning_effort");
});

/** A runner whose runs go as listed: lines then success, lines then a failure, or a hang. */
function runsAs(
  ...runs: Array<{ lines?: string[]; fail?: string; hang?: boolean; afterMs?: number }>
) {
  let n = 0;
  const run = (r: CliRun) =>
    (async function* () {
      const plan = runs[n++] ?? {};
      if (plan.afterMs) await Bun.sleep(plan.afterMs);
      if (r.signal?.aborted) throw new Error("aborted");
      yield* plan.lines ?? [];
      if (plan.hang)
        await new Promise((_, reject) =>
          r.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      if (plan.fail) throw new Error(plan.fail);
    })();
  return { run, count: () => n };
}
const json = (value: unknown) =>
  event({ type: "result", subtype: "success", is_error: false, structured_output: value });
const ask = { model: "sonnet", messages: [{ role: "user" as const, content: "x" }] };
const schema = { jsonSchema: { name: "t", schema: { type: "object" } } };

test("claude exiting with 1 is run once more: a JSON reply, and a streamed one before its text", async () => {
  const whole = runsAs({ fail: "claude exited with 1" }, { lines: [json({ ok: true })] });
  expect(await cliClient("claude", whole.run).complete({ ...ask, ...schema })).toBe('{"ok":true}');
  expect(whole.count()).toBe(2);

  const streamed = runsAs(
    { lines: [event({ type: "system", subtype: "init" })], fail: "claude exited with 1" },
    { lines: [delta("Ja.")] },
  );
  let text = "";
  for await (const t of cliClient("claude", streamed.run).chat(ask)) text += t;
  expect(text).toBe("Ja.");
  expect(streamed.count()).toBe(2);
});

test("no second run once text was shown, after a second failure, or for a refused login", async () => {
  const broken = runsAs({ lines: [delta("Ja")], fail: "claude exited with 1" }, {});
  const seen: string[] = [];
  const error = await (async () => {
    for await (const t of cliClient("claude", broken.run).chat(ask)) seen.push(t);
  })().catch((e: unknown) => e);
  expect(seen).toEqual(["Ja"]);
  expect((error as LlmError).code).toBe("bad_response");
  expect(broken.count()).toBe(1);

  const twice = runsAs({ fail: "claude exited with 1" }, { fail: "claude exited with 1" }, {});
  const second = await cliClient("claude", twice.run)
    .complete(ask)
    .catch((e: unknown) => e);
  expect((second as LlmError).code).toBe("bad_response");
  expect(twice.count()).toBe(2);

  // Its result says why it exits with 1: the login, not worth another run.
  const denied = runsAs({
    lines: [
      event({ type: "result", subtype: "success", is_error: true, result: "Please run /login" }),
    ],
    fail: "claude exited with 1",
  });
  const login = await cliClient("claude", denied.run)
    .complete(ask)
    .catch((e: unknown) => e);
  expect((login as LlmError).code).toBe("unauthorized");
  expect(denied.count()).toBe(1);
});

test("a JSON reply out of time is asked once more; a streamed one is not", async () => {
  const limits = { streamMs: 30, jsonAttemptMs: 30 };
  const slow = runsAs({ hang: true }, { lines: [json({ ok: 1 })] });
  expect(await cliClient("claude", slow.run, limits).complete({ ...ask, ...schema })).toBe(
    '{"ok":1}',
  );
  expect(slow.count()).toBe(2);

  const stuck = runsAs({ hang: true }, { lines: [delta("late")] });
  const error = await (async () => {
    for await (const _ of cliClient("claude", stuck.run, limits).chat(ask));
  })().catch((e: unknown) => e);
  expect((error as LlmError).code).toBe("timeout");
  expect(stuck.count()).toBe(1);
});

test("a long JSON task's attempt has its own time limit, by the task's name", async () => {
  const limits = { streamMs: 30, jsonAttemptMs: 30, jsonAttemptMsOf: { writing_check: 500 } };
  const long = { jsonSchema: { name: "writing_check", schema: { type: "object" } } };
  const slowly = runsAs({ afterMs: 80, lines: [json({ ok: 1 })] });
  expect(await cliClient("claude", slowly.run, limits).complete({ ...ask, ...long })).toBe(
    '{"ok":1}',
  );
  expect(slowly.count()).toBe(1);
  // Another task, as slow, is cut at the default and asked once more.
  const other = runsAs({ afterMs: 80, lines: [json({ ok: 1 })] }, { lines: [json({ ok: 2 })] });
  expect(await cliClient("claude", other.run, limits).complete({ ...ask, ...schema })).toBe(
    '{"ok":2}',
  );
  expect(CLI_LIMITS.jsonAttemptMsOf?.writing_check).toBe(150_000);
  expect(CLI_LIMITS.jsonAttemptMsOf?.scene_setup).toBe(150_000);
});

test("tool notes go only with the tools: the HTTP body with them, without them, and never a CLI prompt", () => {
  const request = {
    model: "m",
    messages: [
      { role: "system" as const, content: "Rules\n\nContext" },
      { role: "user" as const, content: "Hallo" },
    ],
    tools: [{ name: "get_progress", description: "", parameters: {} }],
    toolNotes: [TUTOR_TOOLS_RULE, TUTOR_TOOLS_REMINDER],
  };
  expect(chatBody(request).messages[0]?.content).toEndWith(TUTOR_TOOLS_REMINDER);
  expect(chatBody({ ...request, tools: undefined }).messages[0]?.content).toBe("Rules\n\nContext");
  const { files } = cliRun("claude", request);
  expect(files?.["system.txt"]).not.toContain("call the tool first");
  expect(files?.["system.txt"]).toContain("Tools are not available");
});
