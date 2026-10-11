import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { StudySession } from "../../src/study/session.tsx";
import { renderApp } from "../render.tsx";

const study = {
  now: 0,
  counts: { new: 1, learning: 0, review: 0 },
  answersLeft: 1,
  answeredToday: 0,
  current: {
    cardId: "c1",
    face: "recognition",
    kind: "new",
    display: { target: "auch", translation: "also", series: "x", lessonKey: "x/c/00-01" },
    lang: "de",
    due: { 1: 60_000, 2: 360_000, 3: 600_000, 4: 345_600_000 },
    reps: 0,
    leech: false,
    flag: 0,
    marked: false,
  },
  nextLearning: null,
  newWaiting: false,
  reviewsWaiting: false,
  buried: 0,
  canUndo: false,
};

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

test("one action at a time: a second rating while the first is being stored sends nothing", async () => {
  const ratings: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/api/cards/c1/review") {
      ratings.push(pathname);
      await held;
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && pathname === "/api/cards/study")
      return Response.json({ ...study, current: null, counts: { new: 0, learning: 0, review: 0 } });
    throw new Error(`unexpected ${request.method} ${pathname}`);
  }) as typeof fetch;

  const view = await renderApp(<StudySession scope="all" />, {
    data: [[["study", "all"], study]],
    path: "/",
  });
  fireEvent.click(view.getByRole("button", { name: /Show answer/ }));
  const good = view.getByRole("button", { name: /Good/ });
  fireEvent.click(good);
  await waitFor(() => expect(ratings).toHaveLength(1));
  fireEvent.click(good);
  fireEvent.keyDown(document.body, { key: "3" });
  await act(async () => {
    release();
    await held;
  });
  await waitFor(() => expect(view.getByText(/Congratulations|finished/i)).toBeTruthy());
  expect(ratings).toHaveLength(1);
});

test("a rating carries how long its card was on screen", async () => {
  const sent: Array<{ ms?: number }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/api/cards/c1/review") {
      sent.push(await request.json());
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && pathname === "/api/cards/study")
      return Response.json({ ...study, current: null, counts: { new: 0, learning: 0, review: 0 } });
    throw new Error(`unexpected ${request.method} ${pathname}`);
  }) as typeof fetch;
  const view = await renderApp(<StudySession scope="all" />, {
    data: [[["study", "all"], study]],
    path: "/",
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  fireEvent.click(view.getByRole("button", { name: /Show answer/ }));
  fireEvent.click(view.getByRole("button", { name: /Good/ }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]?.ms).toBeGreaterThanOrEqual(25);
  expect(sent[0]?.ms).toBeLessThan(5_000);
});
