import { expect, test } from "bun:test";
import { createOutbox } from "../../src/api/outbox.ts";

class Refused extends Error {}

/** An outbox over a fake server: `fail` decides each send's fate in turn. */
function outbox(fail: Array<"down" | "refused" | undefined> = []) {
  const stored: number[][] = [];
  let refusedCount = 0;
  let waits = 0;
  const box = createOutbox<number>({
    async send(batch) {
      const fate = fail.shift();
      if (fate === "down") throw new Error("network");
      if (fate === "refused") throw new Refused();
      stored.push(batch);
    },
    refused: (e) => e instanceof Refused,
    onRefused: () => refusedCount++,
    wait: async () => {
      waits++;
    },
    batchSize: 2,
  });
  return { box, stored, refused: () => refusedCount, waits: () => waits };
}

test("sent in order, in batches, until the queue is empty", async () => {
  const o = outbox();
  o.box.push([1, 2, 3]);
  await o.box.flush();
  expect(o.stored).toEqual([[1, 2], [3]]);
  expect(o.box.pending()).toEqual([]);
});

test("a network failure is retried; a refused batch is sent again event by event", async () => {
  const o = outbox(["down", undefined, "refused"]);
  o.box.push([1, 2, 3, 4]);
  await o.box.flush();
  expect(o.stored).toEqual([[1, 2], [3], [4]]);
  expect([o.waits(), o.refused()]).toEqual([1, 0]);
});

test("only the event the server refuses is dropped and reported; the others of its batch are stored", async () => {
  const stored: number[][] = [];
  let refused = 0;
  const box = createOutbox<number>({
    async send(batch) {
      // The server keeps a batch whole or not at all; it refuses 3 (e.g. an answer that no longer fits).
      if (batch.includes(3)) throw new Refused();
      stored.push(batch);
    },
    refused: (e) => e instanceof Refused,
    onRefused: () => refused++,
    wait: async () => {},
    batchSize: 3,
  });
  box.push([1, 2, 3, 4, 5, 6]);
  await box.flush();
  expect(stored).toEqual([[1], [2], [4, 5, 6]]);
  expect(refused).toBe(1);
});

test("one sending at a time; events queued while it runs go out with it", async () => {
  const o = outbox();
  o.box.push([1]);
  const first = o.box.flush();
  o.box.push([2]);
  expect(o.box.flush()).toBe(first);
  await first;
  expect(o.stored.flat()).toEqual([1, 2]);
});

test("cleared: nothing left to send", async () => {
  const o = outbox();
  o.box.push([1, 2]);
  o.box.clear();
  await o.box.flush();
  expect(o.stored).toEqual([]);
});

test("a batch never mixes two runs; failures in a row wait longer each time, up to the limit", async () => {
  const stored: string[][] = [];
  const waited: number[] = [];
  let down = 4;
  const box = createOutbox<string>({
    async send(batch) {
      if (down-- > 0) throw new Error("server error");
      stored.push(batch);
    },
    refused: () => false,
    onRefused: () => {},
    batchKey: (e) => e.split(":")[0] ?? "",
    wait: async (ms) => {
      waited.push(ms);
    },
    retryMs: 100,
    maxRetryMs: 500,
  });
  box.push(["a:1", "a:2", "b:1"]);
  await box.flush();
  expect(stored).toEqual([["a:1", "a:2"], ["b:1"]]);
  expect(waited).toEqual([100, 200, 400, 500]);
});

test("asked to send while it waits to retry, it tries again at once", async () => {
  const stored: number[][] = [];
  let down = 1;
  const box = createOutbox<number>({
    async send(batch) {
      if (down-- > 0) throw new Error("network");
      stored.push(batch);
    },
    refused: () => false,
    onRefused: () => {},
    // A wait that would never end by itself.
    wait: () => new Promise<void>(() => {}),
  });
  box.push([1]);
  const sending = box.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stored).toEqual([]);
  box.push([2]);
  expect(box.flush()).toBe(sending);
  await sending;
  expect(stored).toEqual([[1, 2]]);
});

test("what was stored since a mark: events stored while a reader was away", async () => {
  const o = outbox();
  o.box.push([1]);
  await o.box.flush();
  const mark = o.box.mark();
  o.box.push([2, 3]);
  await o.box.flush();
  expect(o.box.storedSince(mark)).toEqual([2, 3]);
  expect(o.box.storedSince(o.box.mark())).toEqual([]);
});
