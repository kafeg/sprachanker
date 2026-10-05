import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaStore } from "../src/media-store.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

test("stores under the wanted name, once per content, with a suffix on name clashes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sprachanker-media-"));
  const store = createMediaStore(dir);
  const first = await store.put("audio/word.mp3", bytes("one"));
  expect(first.path).toBe("media/audio/word.mp3" as never);
  expect(readFileSync(join(dir, "media/audio/word.mp3"), "utf8")).toBe("one");
  expect((await store.put("audio/word.mp3", bytes("one"))).path).toBe(first.path);
  const clash = await store.put("audio/word.mp3", bytes("two"));
  expect(clash.path).toBe("media/audio/word-2.mp3" as never);
  expect(clash.size).toBe(3);
});
