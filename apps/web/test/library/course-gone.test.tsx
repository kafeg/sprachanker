// A lesson or exam whose course is not on this device: said so, with its offer to download again.
import { expect, test } from "bun:test";
import { CourseGone } from "../../src/library/course-gone.tsx";
import { renderApp } from "../render.tsx";

const offer = {
  series: "dw.nicos-weg",
  course: "a1",
  key: "dw.nicos-weg/a1",
  edition: "ru-de",
  kind: "course",
  title: "Nicos Weg A1",
  source: { publisher: "DW", url: "https://learngerman.dw.com/", licence: "free-access" },
  approxBytes: 6e7,
  installed: false,
  state: "available",
};

test("a course removed: said so, its offer there to download it again", async () => {
  const view = await renderApp(<CourseGone series="dw.nicos-weg" course="a1" />, {
    path: "/lesson",
    data: [
      [["downloads"], { available: true, jobs: [] }],
      [["catalog"], [offer, { ...offer, course: "a2", key: "dw.nicos-weg/a2", title: "A2" }]],
    ],
  });
  expect(view.getByText(/This course isn't on this device any more/)).toBeTruthy();
  expect(view.getByRole("heading", { name: "Nicos Weg A1" })).toBeTruthy();
  expect(view.queryByRole("heading", { name: "A2" })).toBeNull();
  expect(view.getByRole("button", { name: /Download/ })).toBeTruthy();
});

test("an exam nothing offers any more: said so, the way to what is available", async () => {
  const view = await renderApp(<CourseGone series="bamf.lid" course="lid" kind="exam" />, {
    path: "/exam",
    data: [
      [["downloads"], { available: true, jobs: [] }],
      [["catalog"], [offer]],
    ],
  });
  expect(view.getByText(/This exam isn't on this device any more/)).toBeTruthy();
  expect(view.getByRole("link", { name: "Available" }).getAttribute("href")).toBe("/exams/catalog");
});
