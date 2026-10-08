import { expect, test } from "bun:test";
import { createOutbox } from "../../src/lesson/outbox.ts";

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

test("a network failure is retried; a refused batch is dropped and reported", async () => {
  const o = outbox(["down", undefined, "refused"]);
  o.box.push([1, 2, 3, 4]);
  await o.box.flush();
  expect(o.stored).toEqual([[1, 2]]);
  expect([o.waits(), o.refused()]).toEqual([1, 1]);
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
