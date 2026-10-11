// Command-line agents on this machine (`claude`, `codex`) as LLM backends: each run gets a fresh,
// empty working folder (no project files or instructions are picked up), its files written there,
// stdin sent, stdout read line by line; aborting kills the process.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import type { CliKind, CliRun } from "@sprachanker/llm";
import type { CliHost } from "../services/llm.ts";

const COMMANDS: Record<CliKind, string> = { claude: "claude", codex: "codex" };

/** The command on PATH, or in the places installers put it when the app was started without a shell. */
function locate(name: string): string | undefined {
  const exe = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local", "bin"),
    join(homedir(), ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of dirs)
    for (const file of exe) if (dir && existsSync(join(dir, file))) return join(dir, file);
  return undefined;
}

/** This process's environment with the run's own: set, or removed where undefined. */
export function environment(own: CliRun["env"]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(own ?? {}))
    if (value === undefined) delete env[key];
    else env[key] = value;
  return env;
}

async function* run(
  command: string,
  { args, stdin, files, env, signal }: CliRun,
): AsyncIterable<string> {
  const cwd = await mkdtemp(join(tmpdir(), "sprachanker-cli-"));
  try {
    for (const [name, content] of Object.entries(files ?? {}))
      await writeFile(join(cwd, name), content);
    const child = spawn(command, args, {
      cwd,
      env: environment(env),
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (t: string) => {
      stderr = (stderr + t).slice(-2000);
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    // A failed start (missing command) must not stay an unhandled rejection while lines are read.
    exited.catch(() => {});
    child.stdin.end(stdin);
    for await (const line of createInterface({ input: child.stdout })) if (line.trim()) yield line;
    const code = await exited;
    if (code !== 0) throw new Error(stderr.trim() || `${command} exited with ${code}`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export function cliHost(): CliHost {
  return {
    installed: (kind) => !!locate(COMMANDS[kind]),
    run: (kind) => (r) => {
      const command = locate(COMMANDS[kind]);
      if (!command) throw new Error(`${COMMANDS[kind]} is not installed`);
      return run(command, r);
    },
  };
}
