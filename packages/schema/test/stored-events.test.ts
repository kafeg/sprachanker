// Every shape an event payload was ever stored in (test/stored-events/events.json, synthetic) must keep
// reading: payloads only grow (05, "Events"). A change that breaks one needs an upgrade, not an edit here.
import { expect, test } from "bun:test";
import { EVENT_PAYLOADS, type EventType, readPayload } from "../src/index.ts";
import stored from "./stored-events/events.json";

test("every event type has stored shapes on record", () => {
  expect(Object.keys(stored).sort()).toEqual(Object.keys(EVENT_PAYLOADS).sort());
});

for (const [type, shapes] of Object.entries(stored))
  test(`${type}: every stored shape still reads`, () => {
    for (const { since, payload } of shapes) {
      const read = EVENT_PAYLOADS[type as EventType].safeParse(payload);
      expect(read.success, `${type} stored since ${since}: ${read.error?.message}`).toBe(true);
      // Read whole: nothing in a stored shape is dropped (a snapshot on record still reads).
      expect(readPayload(type as EventType, payload) as unknown).toEqual(read.data);
    }
  });

test("a snapshot is written whole; one that no longer reads is dropped when read, not its event", () => {
  const stored = {
    pageIndex: 3,
    exerciseKey: "s.x/c/00-01/ex-04",
    snapshot: {
      exercise: { key: "s.x/c/00-01/ex-04", type: "a_type_from_the_future" },
      locale: null,
    },
  };
  expect(EVENT_PAYLOADS.page_shown.safeParse(stored).success).toBe(false);
  expect(readPayload("page_shown", stored)).toEqual({
    pageIndex: 3,
    exerciseKey: "s.x/c/00-01/ex-04",
  } as never);
  expect(readPayload("page_shown", { pageIndex: -1 })).toBeUndefined();
});
