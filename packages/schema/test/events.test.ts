import { expect, test } from "bun:test";
import { EVENT_PAYLOADS, EventInput, EventType } from "../src/learner.ts";

test("every event the client may send is a registered type, its payload read by the registry's schema", () => {
  const registered = new Set(Object.keys(EVENT_PAYLOADS));
  expect([...EventType.options].sort() as string[]).toEqual([...registered].sort());
  for (const option of EventInput.options) {
    const type = option.shape.type.value;
    expect(registered.has(type)).toBe(true);
  }
});

test("a step done as the client sends it is stored by the registry's schema", () => {
  const input = EventInput.parse({
    id: "01M4C0V28VBCDVAH2ET0Y22MWP",
    type: "step_done",
    payload: { step: "words" },
  });
  expect(EVENT_PAYLOADS[input.type].parse(input.payload)).toEqual({ step: "words" });
});
