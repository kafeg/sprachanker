import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { CourseUpkeep } from "../../src/courses/upkeep.tsx";
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
