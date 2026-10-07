import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main.ts";

/** Runs the CLI; returns what it printed and its exit code. */
async function cli(...argv: string[]) {
  const out: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
  const error = spyOn(console, "error").mockImplementation((line: string) => void out.push(line));
  process.exitCode = 0;
  try {
    await main(argv);
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { out: out.join("\n"), code: process.exitCode };
}

afterEach(() => {
  process.exitCode = 0;
});

test("verify on a folder without courses says so and fails", async () => {
  const data = mkdtempSync(join(tmpdir(), "sprachanker-cli-"));
  const { out, code } = await cli("verify", "--data", data);
  expect(out).toContain("no courses installed in");
  expect(code).toBe(1);
});

test("a failure is one line and exit code 1, not a stack trace", async () => {
  const unknown = await cli("import", "nope", "--data", join(tmpdir(), "sprachanker-nowhere"));
  expect(unknown.out).toStartWith("sprachanker: unknown provider nope");
  expect(unknown.out).not.toContain("    at ");
  expect(unknown.code).toBe(1);
  const port = await cli("serve", "--port", "");
  expect([port.out, port.code]).toEqual(["sprachanker: invalid --port: ", 1]);
  const option = await cli("verify", "--nope");
  expect([option.out.startsWith("sprachanker: "), option.code]).toEqual([true, 1]);
});

test("an unknown command prints the usage and fails; help succeeds", async () => {
  expect((await cli("nope")).code).toBe(1);
  const help = await cli("help");
  expect([help.out.startsWith("Usage: sprachanker"), help.code]).toEqual([true, 0]);
});
