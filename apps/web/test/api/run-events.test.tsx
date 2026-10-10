import { expect, test } from "bun:test";
import type { TypedEvent } from "@sprachanker/schema";
import { QueryClient } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { StrictMode, useMemo } from "react";
import { runOutbox, type Stored, useRunOutbox, withStored } from "../../src/api/run-events.ts";

const answer = (id: string, attempt: number, outcome?: unknown) =>
  ({
    id,
    runId: "R",
    ts: 1,
    type: "answered",
    itemKey: "k#1",
    cardId: null,
    payload: { answer: {}, attempt, ms: 1, ...(outcome ? { outcome } : {}) },
  }) as TypedEvent;

test("the server's outcome and attempt of each answer replace the local ones; a mock exam's attempt alone", () => {
  const right = { result: "correct", score: 1 };
  const local = { result: "wrong", score: 0 };
  const events = [answer("a", 1, local), answer("b", 1), answer("c", 1, local)];
  const shown = withStored(events, { outcomes: { a: right as never }, attempts: { a: 2, b: 3 } });
  expect(
    shown.map((e) =>
      e.type === "answered" ? `${e.payload.attempt} ${e.payload.outcome?.result ?? "none"}` : "",
    ),
  ).toEqual(["2 correct", "3 none", "1 wrong"]);
  // Untouched events stay the same objects.
  expect(shown[2]).toBe(events[2] as TypedEvent);
});

test("nothing told otherwise than shown: the same events, the cached state left as it is", () => {
  const right = { result: "correct", score: 1 };
  const events = [answer("a", 1, right), answer("b", 2)];
  expect(withStored(events, { outcomes: { a: right as never }, attempts: { a: 1, b: 2 } })).toBe(
    events,
  );
});

/** A run's outbox as a page uses it, over a fake server: what was posted, with which options. */
function setup(profile = "P1") {
  const client = new QueryClient();
  client.setQueryData(["session"], { profile: { id: profile } });
  const key = ["exam-run", `R-${Math.random()}`];
  const posted: Array<{ runId: string; ids: string[]; init?: RequestInit }> = [];
  let reply: Stored = { outcomes: {}, attempts: {} };
  const outboxOf = () =>
    runOutbox<{ id: string }>(client, key, {
      runOf: () => "R",
      post: async (runId, batch, init) => {
        posted.push({ runId, ids: batch.map((e) => e.id), ...(init && { init }) });
        return reply;
      },
    });
  let shown: ReturnType<typeof outboxOf> | undefined;
  function Page() {
    const outbox = useMemo(outboxOf, []);
    useRunOutbox(outbox);
    shown = outbox;
    return null;
  }
  const open = () =>
    render(
      <StrictMode>
        <Page />
      </StrictMode>,
    );
  return {
    client,
    key,
    posted,
    outboxOf,
    open,
    shown: () => shown,
    answerWith: (stored: Stored) => {
      reply = stored;
    },
  };
}

test("a page mounted twice (StrictMode) keeps its run's one outbox; an idle one goes with the page, one with events waiting stays", async () => {
  const s = setup();
  const page = s.open();
  const outbox = s.shown();
  expect(s.outboxOf()).toBe(outbox as never);
  page.unmount();
  // Nothing waited in it: the run opened again has a new one.
  const again = s.open();
  expect(s.shown()).not.toBe(outbox);
  // Events waiting (not sent yet) keep it for the page opened again.
  const waiting = s.shown();
  waiting?.push([{ id: "e1" }]);
  again.unmount();
  s.open();
  expect(s.shown()).toBe(waiting);
  await act(() => waiting?.flush());
  expect(s.posted.map((p) => p.ids)).toEqual([["e1"]]);
});

test("the server's attempts replace the local ones; a reply telling nothing new leaves the cache as it is", async () => {
  const s = setup();
  s.open();
  s.client.setQueryData(s.key, { events: [answer("a", 1)] });
  s.answerWith({ outcomes: {}, attempts: { a: 2 } });
  const outbox = s.shown();
  outbox?.push([{ id: "a" }]);
  await act(() => outbox?.flush());
  const state = s.client.getQueryData<{ events: TypedEvent[] }>(s.key);
  const [first] = state?.events ?? [];
  expect(first?.type === "answered" && first.payload.attempt).toBe(2);
  outbox?.push([{ id: "a" }]);
  await act(() => outbox?.flush());
  expect(s.client.getQueryData(s.key) === state).toBe(true);
});

test("events of a profile signed out wait until it is back", async () => {
  const s = setup("P1");
  s.open();
  const outbox = s.shown();
  s.client.setQueryData(["session"], { profile: { id: "P2" } });
  outbox?.push([{ id: "e1" }]);
  void outbox?.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(s.posted).toEqual([]);
  expect(outbox?.pending()).toHaveLength(1);
  s.client.setQueryData(["session"], { profile: { id: "P1" } });
  await act(() => outbox?.flush());
  expect(s.posted.map((p) => p.ids)).toEqual([["e1"]]);
});

test("what is still queued goes out with keepalive as the page closes", () => {
  const s = setup();
  s.open();
  s.shown()?.push([{ id: "e1" }, { id: "e2" }]);
  window.dispatchEvent(new Event("pagehide"));
  expect(s.posted).toEqual([{ runId: "R", ids: ["e1", "e2"], init: { keepalive: true } }]);
});
