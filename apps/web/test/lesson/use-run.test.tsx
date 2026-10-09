import { afterEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRun } from "../../src/lesson/use-run.ts";
import { queryClient } from "../render.tsx";

const LESSON = "sprachanker.test/run/00-01";
const run = {
  id: "R1",
  kind: "lesson",
  contextKey: LESSON,
  courseKey: "sprachanker.test/run",
  edition: "en-de",
  status: "active",
  endReason: null,
  startedAt: 1,
  finishedAt: null,
  result: null,
};

/** A server for one lesson run: reads count, events posted wait until `release`. */
function server() {
  const reads: string[] = [];
  const posted: Array<{ url: string; ids: string[] }> = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/runs/lesson") {
      reads.push(url.search);
      return Response.json({ state: { run, events: [], resumePage: 0 } });
    }
    if (request.method === "POST" && url.pathname.endsWith("/events")) {
      const body = (await request.json()) as { events: Array<{ id: string }> };
      await held;
      posted.push({ url: url.pathname, ids: body.events.map((e) => e.id) });
      return Response.json({ outcomes: {} });
    }
    throw new Error(`unexpected ${request.method} ${url.pathname}`);
  }) as typeof fetch;
  return { reads, posted, release, restore: () => (globalThis.fetch = real) };
}

let restore = () => {};
afterEach(() => restore());

test("a lesson opened again reads its run again and keeps the events still on their way; they go to their run", async () => {
  const s = server();
  restore = s.restore;
  const client = queryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const open = () => renderHook(() => useRun("sprachanker.test", LESSON, "en-de"), { wrapper });

  const first = open();
  await waitFor(() => expect(first.result.current.mode).toBe("active"));
  act(() => first.result.current.stepDone("words"));
  first.unmount();

  // Opened again while the event is still being sent: read anew, the event still shown as done.
  const again = open();
  await waitFor(() => expect(s.reads).toHaveLength(2));
  await waitFor(() => expect(again.result.current.done.get("words")).toBe("done"));

  s.release();
  await waitFor(() => expect(s.posted).toHaveLength(1));
  expect(s.posted[0]?.url).toBe("/api/runs/R1/events");
  again.unmount();
});

/** A server whose reads are answered when the test says (`answer`), or fail; events stored at once. */
function slowReads() {
  const posted: string[] = [];
  /** Events are not stored while the server is down (503). */
  const down = { now: false };
  const reads: Array<(r: Response) => void> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/runs/lesson")
      return new Promise<Response>((resolve) => reads.push(resolve));
    if (request.method === "POST" && url.pathname.endsWith("/events")) {
      if (down.now) return Response.json({ error: "internal" }, { status: 503 });
      const body = (await request.json()) as { events: Array<{ id: string }> };
      posted.push(...body.events.map((e) => e.id));
      return Response.json({ outcomes: {} });
    }
    throw new Error(`unexpected ${request.method} ${url.pathname}`);
  }) as typeof fetch;
  const state = () => Response.json({ state: { run, events: [], resumePage: 0 } });
  return {
    posted,
    reads,
    down,
    answer: (i: number, r = state()) => reads[i]?.(r),
    restore: () => (globalThis.fetch = real),
  };
}

test("an event stored while the run is being read again stays shown", async () => {
  const s = slowReads();
  restore = s.restore;
  const client = queryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const open = () => renderHook(() => useRun("sprachanker.test", LESSON, "en-de"), { wrapper });
  const first = open();
  await waitFor(() => expect(s.reads).toHaveLength(1));
  s.answer(0);
  await waitFor(() => expect(first.result.current.mode).toBe("active"));
  first.unmount();

  // Opened again: the run is read anew; meanwhile a step is done and stored, after the server read.
  const again = open();
  await waitFor(() => expect(s.reads).toHaveLength(2));
  act(() => again.result.current.stepDone("words"));
  await waitFor(() => expect(s.posted).toHaveLength(1));
  s.answer(1);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(again.result.current.done.get("words")).toBe("done");
  again.unmount();
});

test("a failed read tried again keeps the events still on their way", async () => {
  const s = slowReads();
  restore = s.restore;
  const client = queryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const lesson = "sprachanker.test/run/00-02";
  const open = () => renderHook(() => useRun("sprachanker.test", lesson, "en-de"), { wrapper });
  const first = open();
  await waitFor(() => expect(s.reads).toHaveLength(1));
  s.answer(
    0,
    Response.json({ state: { run: { ...run, contextKey: lesson }, events: [], resumePage: 0 } }),
  );
  await waitFor(() => expect(first.result.current.mode).toBe("active"));
  // The server goes down: the step done waits in the queue.
  s.down.now = true;
  act(() => first.result.current.stepDone("words"));
  first.unmount();
  // Opened again, the read fails; tried again, it reads; the server back, the step is stored.
  const again = open();
  await waitFor(() => expect(s.reads).toHaveLength(2));
  s.answer(1, Response.json({ error: "internal" }, { status: 500 }));
  await waitFor(() => expect(again.result.current.error).toBeTruthy());
  act(() => again.result.current.retry());
  await waitFor(() => expect(s.reads).toHaveLength(3));
  s.down.now = false;
  s.answer(
    2,
    Response.json({ state: { run: { ...run, contextKey: lesson }, events: [], resumePage: 0 } }),
  );
  await waitFor(() => expect(again.result.current.done.get("words")).toBe("done"));
  act(() => again.result.current.stepDone("grammar:1"));
  await waitFor(() => expect(s.posted).toHaveLength(2));
  again.unmount();
});
