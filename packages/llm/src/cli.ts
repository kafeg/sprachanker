// Assistants run through a command-line agent on this machine with the user's own subscription (07,
// "Providers"): Claude Code (`claude -p`) and Codex (`codex exec`). This module builds their command
// lines and reads their output; starting the process is the server's (a CliRunner), so this package
// stays free of runtime APIs. Their own tools stay off: the app gives all context in the prompt.
import type { ChatMessage, ChatRequest, LlmClient } from "./client.ts";
import { LlmError } from "./errors.ts";

export type CliKind = "claude" | "codex";

/** One run of a command: files are written into a fresh working folder first, stdin is sent. */
export interface CliRun {
  args: string[];
  stdin: string;
  files?: Record<string, string>;
  signal?: AbortSignal;
}

/** Starts the command and yields its stdout line by line; throws when it fails to start or exits non-zero. */
export type CliRunner = (run: CliRun) => AsyncIterable<string>;

/** Shown for "Check connection": the CLIs take model aliases or full names. */
const CLI_MODELS: Record<CliKind, Array<{ id: string; name: string }>> = {
  claude: [
    { id: "sonnet", name: "Claude Sonnet (latest)" },
    { id: "opus", name: "Claude Opus (latest)" },
    { id: "haiku", name: "Claude Haiku (latest)" },
  ],
  codex: [{ id: "gpt-5", name: "GPT-5" }],
};

const NO_TOOLS =
  "Tools are not available in this session: answer from the data above. If a question needs data you do not have, say so briefly.";

/**
 * A chat as one prompt: system messages become the instructions, earlier turns a transcript, the last
 * user message the request. Tool turns are dropped (the CLIs run without the app's tools).
 */
export function cliPrompt(messages: ChatMessage[], withTools: boolean) {
  // The tools' own notes are never added here (the request's `toolNotes` go only with the tools).
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content ?? "")
    .join("\n\n");
  const turns = messages.filter(
    (m) => (m.role === "user" || m.role === "assistant") && !m.tool_calls?.length,
  );
  const last = turns.at(-1);
  const earlier = last?.role === "user" ? turns.slice(0, -1) : turns;
  const transcript = earlier
    .map((m) => `${m.role === "user" ? "Learner" : "You"}: ${m.content ?? ""}`)
    .join("\n\n");
  const request = last?.role === "user" ? (last.content ?? "") : "";
  return {
    system: withTools ? `${system}\n\n${NO_TOOLS}` : system,
    prompt: transcript
      ? `<conversation>\n${transcript}\n</conversation>\n\nLearner: ${request}`
      : request,
  };
}

const parse = (line: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/** A failure the CLI reported, as an LlmError the settings can explain. */
function cliError(kind: CliKind, message: string): LlmError {
  if (/log ?in|auth|credential|api key|unauthori[sz]ed|401/i.test(message))
    return new LlmError("unauthorized", `${kind}: ${message}`);
  if (/model/i.test(message) && /not found|invalid|unknown|does not exist/i.test(message))
    return new LlmError("model_not_found", `${kind}: ${message}`);
  return new LlmError("bad_response", `${kind}: ${message}`);
}

const CLI_TIMEOUT_MS = 240_000;

/** The request's signal plus a time limit; the CLIs start in a few seconds, big models think long. */
function withTimeout(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(CLI_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** `claude -p` with its system prompt replaced, no tools, MCP servers, settings or saved session. */
function claudeArgs(
  request: Omit<ChatRequest, "signal" | "runTool">,
  output: "stream-json" | "json",
) {
  return [
    "-p",
    "--model",
    request.model,
    "--system-prompt-file",
    "system.txt",
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--output-format",
    output,
    ...(output === "stream-json" ? ["--include-partial-messages", "--verbose"] : []),
    ...(request.reasoning === false ? ["--effort", "low"] : []),
    ...(request.jsonSchema ? ["--json-schema", JSON.stringify(request.jsonSchema.schema)] : []),
  ];
}

/** `codex exec` read-only, without the user's config or a saved session; instructions go into stdin. */
function codexArgs(request: Omit<ChatRequest, "signal" | "runTool">) {
  return [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--sandbox",
    "read-only",
    ...(request.model ? ["--model", request.model] : []),
    ...(request.reasoning === false ? ["-c", 'model_reasoning_effort="low"'] : []),
    ...(request.jsonSchema ? ["--output-schema", "schema.json"] : []),
    "-",
  ];
}

const codexStdin = (system: string, prompt: string) =>
  `<instructions>\n${system}\nAnswer directly in your reply. Do not run commands or read files.\n</instructions>\n\n${prompt}`;

/** Final text of a Claude run, from its `--output-format json` result. */
function claudeResult(kind: CliKind, result: Record<string, unknown>): string {
  if (result.is_error || result.subtype !== "success")
    throw cliError(kind, String(result.result ?? result.subtype ?? "failed"));
  if (result.structured_output !== undefined) return JSON.stringify(result.structured_output);
  return String(result.result ?? "");
}

/** The command a request runs (also what the prompt viewer shows): its arguments, stdin and files. */
export function cliRun(
  kind: CliKind,
  request: Omit<ChatRequest, "signal" | "runTool">,
  output: "stream-json" | "json" = request.jsonSchema ? "json" : "stream-json",
): Omit<CliRun, "signal"> {
  const { system, prompt } = cliPrompt(request.messages, !!request.tools?.length);
  return kind === "claude"
    ? { args: claudeArgs(request, output), stdin: prompt, files: { "system.txt": system } }
    : {
        args: codexArgs(request),
        stdin: codexStdin(system, prompt),
        files: request.jsonSchema
          ? { "schema.json": JSON.stringify(request.jsonSchema.schema) }
          : undefined,
      };
}

export function cliClient(kind: CliKind, run: CliRunner): LlmClient {
  async function* lines(request: ChatRequest, output: "stream-json" | "json") {
    const signal = withTimeout(request.signal);
    const job = run({ ...cliRun(kind, request, output), signal });
    try {
      for await (const line of job) {
        const event = parse(line);
        if (event) yield event;
      }
    } catch (error) {
      if (signal.aborted && !request.signal?.aborted)
        throw new LlmError("timeout", `${kind} did not answer in time`);
      if (error instanceof LlmError) throw error;
      throw cliError(kind, error instanceof Error ? error.message : String(error));
    }
  }

  /** Codex: the agent's message text, and errors it reports. */
  async function* codexMessages(request: ChatRequest) {
    for await (const event of lines(request, "json")) {
      const item = event.item as { type?: string; text?: string } | undefined;
      if (event.type === "item.completed" && item?.type === "agent_message" && item.text)
        yield item.text;
      if (event.type === "error" || event.type === "turn.failed") {
        const error = event.error as { message?: string } | undefined;
        throw cliError(kind, String(error?.message ?? event.message ?? "failed"));
      }
    }
  }

  return {
    async models() {
      return CLI_MODELS[kind];
    },

    async *chat(request) {
      if (kind === "codex") {
        yield* codexMessages(request);
        return;
      }
      for await (const event of lines(request, "stream-json")) {
        if (event.type === "stream_event") {
          const e = event.event as { type?: string; delta?: { type?: string; text?: string } };
          if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text)
            yield e.delta.text;
        } else if (event.type === "result" && (event.is_error || event.subtype !== "success")) {
          throw cliError(kind, String(event.result ?? event.subtype));
        }
      }
    },

    async complete(request) {
      if (kind === "codex") {
        let text = "";
        for await (const message of codexMessages(request)) text = message;
        return text;
      }
      let result: Record<string, unknown> | undefined;
      for await (const event of lines(request, "json")) result = event;
      if (!result) throw new LlmError("bad_response", "claude: no result");
      return claudeResult(kind, result);
    },
  };
}

/** The command line as the prompt viewer shows it. */
export const cliCommand = (kind: CliKind, model: string) =>
  kind === "claude" ? `claude -p --model ${model}` : `codex exec --model ${model || "(default)"}`;
