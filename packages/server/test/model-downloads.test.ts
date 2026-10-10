import { expect, test } from "bun:test";
import { createModelDownloads, untilAborted } from "../src/services/model-downloads.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

test("a download tells its progress and is forgotten when it ends", async () => {
  const downloads = createModelDownloads();
  let finish = () => {};
  downloads.start(
    "m",
    (progress) =>
      new Promise<void>((resolve) => {
        progress(10);
        finish = resolve;
      }),
    100,
  );
  expect(downloads.going("m")).toBe(true);
  expect(downloads.of("m")).toEqual({ downloaded: 10 });
  expect(downloads.total("m")).toBe(100);
  // One at a time: a second start while it goes is no second job.
  let again = false;
  downloads.start("m", async () => {
    again = true;
  });
  expect(again).toBe(false);
  finish();
  await tick();
  expect(downloads.going("m")).toBe(false);
  expect(downloads.of("m")).toEqual({});
});

test("a failed download keeps its error, cut to 200 characters, until started again", async () => {
  const downloads = createModelDownloads();
  downloads.start("m", async () => {
    throw new Error("x".repeat(500));
  });
  await tick();
  const { error } = downloads.of("m");
  expect(error).toHaveLength(200);
  expect(error?.startsWith("Error: xxx")).toBe(true);
  expect(downloads.going("m")).toBe(false);
  downloads.start("m", () => new Promise<void>(() => {}));
  expect(downloads.of("m")).toEqual({ downloaded: 0 });
});

test("a cancelled download aborts its job and is forgotten, its failure with it", async () => {
  const downloads = createModelDownloads();
  let signal: AbortSignal | undefined;
  downloads.start("m", (_, s) => {
    signal = s;
    return new Promise<void>((_, reject) => s.addEventListener("abort", () => reject(s.reason)));
  });
  downloads.cancel("m");
  expect(signal?.aborted).toBe(true);
  await tick();
  expect(downloads.of("m")).toEqual({});
  expect(downloads.going("m")).toBe(false);
});

test("untilAborted: the promise's value, or cancelled once the signal aborts; its listener let go", async () => {
  const controller = new AbortController();
  const added: unknown[] = [];
  const removed: unknown[] = [];
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((type: string, fn: EventListener, options?: unknown) => {
    added.push(fn);
    add(type, fn, options as AddEventListenerOptions);
  }) as typeof signal.addEventListener;
  signal.removeEventListener = ((type: string, fn: EventListener) => {
    removed.push(fn);
    remove(type, fn);
  }) as typeof signal.removeEventListener;

  expect(await untilAborted(Promise.resolve(1), signal)).toBe(1);
  await expect(untilAborted(Promise.reject(new Error("broke")), signal)).rejects.toThrow("broke");
  await tick();
  expect(removed).toEqual(added);

  const waiting = untilAborted(new Promise(() => {}), signal);
  controller.abort();
  await expect(waiting).rejects.toThrow("cancelled");
  await expect(untilAborted(Promise.resolve(1), signal)).rejects.toThrow("cancelled");
});
