// The command-line backends against a fake runner: no process is started.
import { expect, test } from "bun:test";
import { type CliRun, cliClient, cliPrompt, cliRun } from "../src/cli.ts";
import { chatBody, LlmError } from "../src/client.ts";
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

test("a command that fails to start is reported, not thrown raw", async () => {
  const run = () =>
    (async function* () {
      yield* [];
      throw new Error("spawn claude ENOENT");
    })();
  const error = await cliClient("claude", run)
    .complete({ model: "sonnet", messages: [{ role: "user", content: "x" }] })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LlmError);
  expect((error as LlmError).code).toBe("bad_response");
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
