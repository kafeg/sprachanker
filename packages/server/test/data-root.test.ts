import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileAdmin } from "../src/index.ts";
import { holdDataRoot, serverOn } from "../src/runtime/data-root.ts";

test("one server per data folder; a stale pid file is taken over", () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-root-"));
  // A live process that is not this one (the test runner's parent) serves the folder.
  writeFileSync(join(root, "server.pid"), String(process.ppid));
  expect(serverOn(root)).toBe(process.ppid);
  expect(() => holdDataRoot(root)).toThrow(/another SprachAnker server/);
  // Its process gone: the folder is free.
  writeFileSync(join(root, "server.pid"), "999999");
  expect(serverOn(root)).toBeUndefined();
  holdDataRoot(root);
  expect(readFileSync(join(root, "server.pid"), "utf8")).toBe(String(process.pid));
});

test("a profile is not deleted from the command line while a server holds the folder", () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-root-"));
  const admin = profileAdmin(root);
  writeFileSync(join(root, "server.pid"), String(process.ppid));
  expect(() => admin.remove("local")).toThrow(/stop it first/);
});
