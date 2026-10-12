// A course's card in a right-to-left interface: its title in its own
// direction, the lesson to go on with isolated in the line naming it.
import { expect, test } from "bun:test";
import { CourseCard } from "../../src/courses/card.tsx";
import { isolate } from "../../src/ui/direction.tsx";
import { renderApp } from "../render.tsx";

test("a title of its own keeps its direction and its marks in place inside the interface's line", async () => {
  const course = {
    key: "sprachanker.test/demo",
    series: "sprachanker.test",
    course: "demo",
    editions: ["en-de"],
    titles: { "en-de": "Demo A1" },
    nextTitles: { "en-de": "Hallo!" },
    next: "sprachanker.test/demo/01-01",
    lessons: 10,
    done: 0,
    started: true,
  };
  const view = await renderApp(<CourseCard course={course as never} edition="en-de" />, {
    path: "/",
    data: [
      [["downloads"], { available: true, jobs: [] }],
      [["catalog"], []],
    ],
  });
  expect(view.getByRole("heading", { name: "Demo A1" }).getAttribute("dir")).toBe("auto");
  expect(view.getByText("Hallo!").tagName).toBe("BDI");
  expect(isolate("Hallo!")).toBe("\u2068Hallo!\u2069");
});
