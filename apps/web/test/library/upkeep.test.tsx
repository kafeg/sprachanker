import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { CourseRemove, CourseUpkeep } from "../../src/library/upkeep.tsx";
import { renderApp } from "../render.tsx";

const ready: Array<[unknown[], unknown]> = [
  [["downloads"], { available: true, jobs: [] }],
  [["catalog"], [{ series: "s", course: "c", state: "installed" }]],
];
const report = (problems: Array<{ kind: string; at: string; text: string }>, missing = 0) => ({
  lessons: 2,
  exercises: {},
  vocab: 0,
  problems,
  media: { missing, bytes: 0, byKind: {} },
});

test("a card's course is checked when asked, not on its own", async () => {
  // A request would fail the test: nothing is checked before "Check".
  const view = await renderApp(<CourseUpkeep series="s" course="c" />, { data: ready });
  expect(view.getByRole("button", { name: /^Check$/ })).toBeTruthy();
  expect(view.getByRole("button", { name: /^Sync$/ }).className).toContain("border-dashed");
});

test("problems found are shown on the card, listed on a tap, and the sync is marked", async () => {
  const view = await renderApp(<CourseUpkeep series="s" course="c" />, {
    data: [
      ...ready,
      [
        ["course-check", "s", "c"],
        report([
          {
            kind: "missingMedia",
            at: "media/audio/x.mp3",
            text: "media/audio/x.mp3: missing media",
          },
        ]),
      ],
    ],
  });
  const found = view.getByRole("button", { name: /1 problem/ });
  expect(found.className).toContain("text-wrong");
  expect(view.getByRole("button", { name: /^Sync$/ }).className).toContain("border-primary");
  fireEvent.click(found);
  // In the interface's language, the finding in full on hover.
  expect(view.getByText("File missing: media/audio/x.mp3").title).toBe(
    "media/audio/x.mp3: missing media",
  );
});

test("a whole course: the check says so and the sync stays quiet", async () => {
  const view = await renderApp(<CourseUpkeep series="s" course="c" />, {
    data: [...ready, [["course-check", "s", "c"], report([])]],
  });
  expect(view.getByRole("button", { name: /All downloaded/ }).className).toContain("text-correct");
  expect(view.getByRole("button", { name: /^Sync$/ }).className).toContain("border-dashed");
});

test("Remove from this computer: asked first — what goes and what stays —, then removed; none while it downloads", async () => {
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    asked.push(`${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`);
    return Response.json({ files: 3, bytes: 10 });
  }) as typeof fetch;
  try {
    const view = await renderApp(<CourseRemove series="s" course="c" title="Mini" exam />, {
      data: ready,
    });
    fireEvent.click(view.getByRole("button", { name: "Remove from this computer…" }));
    expect(view.getByText("Remove “Mini” from this computer?")).toBeTruthy();
    expect(view.getByText(/Your mock exams, practice and Notebook stay/)).toBeTruthy();
    expect(asked).toEqual([]);
    fireEvent.click(view.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(asked[0]).toBe("DELETE /api/course?series=s&course=c"));
    view.unmount();
  } finally {
    globalThis.fetch = real;
  }
  const busy = await renderApp(<CourseRemove series="s" course="c" title="Mini" />, {
    data: [
      [["downloads"], { available: true, jobs: [{ series: "s", course: "c", status: "running" }] }],
    ],
  });
  expect(busy.queryByRole("button", { name: "Remove from this computer…" })).toBeNull();
});
