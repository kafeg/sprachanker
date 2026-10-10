import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileAdmin } from "../src/index.ts";
import { holdDataRoot, serverOn, sprachAnkerRuns } from "../src/runtime/data-root.ts";

/** Another live SprachAnker (Bun running it), for as long as the test needs it. */
const another = () => Bun.spawn(["bun", "-e", "setTimeout(() => {}, 60_000)"]);

test("one server per data folder; a stale pid file is taken over", () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-root-"));
  // A live SprachAnker that is not this process serves the folder.
  const server = another();
  writeFileSync(join(root, "server.pid"), String(server.pid));
  expect(serverOn(root)).toBe(server.pid);
  expect(() => holdDataRoot(root)).toThrow(/another SprachAnker server/);
  server.kill();
  // Its process gone: the folder is free.
  writeFileSync(join(root, "server.pid"), "999999");
  expect(serverOn(root)).toBeUndefined();
  // Its pid given to another program (after a restart): not a server either.
  const other = Bun.spawn(["sleep", "60"]);
  writeFileSync(join(root, "server.pid"), String(other.pid));
  expect(serverOn(root)).toBeUndefined();
  other.kill();
  holdDataRoot(root);
  expect(readFileSync(join(root, "server.pid"), "utf8")).toBe(String(process.pid));
});

test("a SprachAnker runs: this process (Bun), not a gone pid nor another program", () => {
  expect(sprachAnkerRuns(process.pid)).toBe(true);
  expect(sprachAnkerRuns(999_999)).toBe(false);
  const other = Bun.spawn(["sleep", "60"]);
  expect(sprachAnkerRuns(other.pid)).toBe(false);
  other.kill();
});

test("a profile is not deleted from the command line while a server holds the folder", () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-root-"));
  const admin = profileAdmin(root);
  const server = another();
  writeFileSync(join(root, "server.pid"), String(server.pid));
  expect(() => admin.remove("local")).toThrow(/stop it first/);
  server.kill();
});
