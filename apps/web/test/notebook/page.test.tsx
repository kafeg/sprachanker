import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { NotebookPage } from "../../src/notebook/page.tsx";
import { renderApp } from "../render.tsx";

const DAY = 86_400_000;
const days = (counts: number[]) => counts.map((count, i) => ({ start: i * DAY, count }));

test("the Notebook: the study days as a strip, then the lessons worked on by course", async () => {
  const view = await renderApp(<NotebookPage />, {
    path: "/notebook",
    data: [
      [
        ["notebook"],
        {
          days: days([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 40]),
          courses: [
            {
              key: "sprachanker.test/demo",
              title: "Demo course",
              lastAt: 13 * DAY,
              lessons: [
                {
                  key: "sprachanker.test/demo/00-01",
                  course: "sprachanker.test/demo",
                  title: "Hallo",
                  passes: 2,
                  best: 0.75,
                  open: false,
                  lastAt: 13 * DAY,
                },
              ],
            },
          ],
        },
      ],
    ],
  });
  const strip = await view.findAllByRole("listitem");
  expect(strip.filter((d) => d.getAttribute("aria-label")?.includes("40 actions"))).toHaveLength(1);
  expect(view.getByText("Demo course")).toBeTruthy();
  const lesson = view.getByRole("button", { name: /0\.1 Hallo/ });
  expect(lesson.textContent).toContain("2 passes");
  expect(lesson.textContent).toContain("75%");
  fireEvent.click(lesson);
  await waitFor(() =>
    expect(view.router?.state.location.pathname).toBe("/notebook/sprachanker.test/demo/00-01"),
  );
});

test("an empty Notebook says what will appear", async () => {
  const view = await renderApp(<NotebookPage />, {
    path: "/notebook",
    data: [[["notebook"], { days: days(Array(14).fill(0)), courses: [] }]],
  });
  expect(await view.findByText(/Nothing yet/)).toBeTruthy();
});
