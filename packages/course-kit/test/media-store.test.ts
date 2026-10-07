import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { urlFileName } from "../src/media-index.ts";
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

test("media file names from URLs, optionally decoded", () => {
  const url = "https://cdn.example/a/Lesson%201.pdf?x=1";
  expect(urlFileName(url)).toBe("Lesson%201.pdf");
  expect(urlFileName(url, { decode: true })).toBe("Lesson 1.pdf");
  expect(urlFileName("https://cdn.example/")).toBe("");
});

test("a media name that walks out of its folder is refused", async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), "sprachanker-media-")));
  for (const name of [
    "audio/../../x.mp3",
    "audio/a/b.mp3",
    "audio/..",
    "video/x\u0000.mp4",
    "x.mp3",
  ])
    await expect(store.put(name, bytes("x"))).rejects.toThrow("unsafe media name");
});

test("two downloads of one name at once: one file, the other a numbered one or the same", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sprachanker-media-"));
  const store = createMediaStore(dir);
  const [a, b, c] = await Promise.all([
    store.put("audio/w.mp3", bytes("one")),
    store.put("audio/w.mp3", bytes("two")),
    store.put("audio/w.mp3", bytes("one")),
  ]);
  // Which one comes first is up to the disk; the same content shares a file, the other is numbered.
  expect(a?.path).toBe(c?.path as never);
  expect(new Set([a?.path, b?.path])).toEqual(
    new Set(["media/audio/w.mp3", "media/audio/w-2.mp3"] as never[]),
  );
  expect(readFileSync(join(dir, b?.path as string), "utf8")).toBe("two");
  expect(readFileSync(join(dir, a?.path as string), "utf8")).toBe("one");
});
