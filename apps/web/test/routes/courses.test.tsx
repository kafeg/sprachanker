import { expect, test } from "bun:test";
import { CoursesPage } from "../../src/routes/courses.tsx";
import { ExamsPage } from "../../src/routes/exams.tsx";
import { renderApp } from "../render.tsx";

const failed: Array<[unknown[], Error]> = [[["catalog"], new Error("network down")]];

test('Available with a catalogue that failed: the error and Retry, not "all downloaded"', async () => {
  const courses = await renderApp(<CoursesPage tab="available" />, {
    path: "/catalog",
    data: [[["courses"], []]],
    failed,
  });
  expect(courses.getByText("Something went wrong: network down")).toBeTruthy();
  expect(courses.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(courses.queryByText("Every course on offer is downloaded.")).toBeNull();
  courses.unmount();

  const exams = await renderApp(<ExamsPage tab="available" />, {
    path: "/exams/catalog",
    data: [[["exams"], []]],
    failed,
  });
  expect(exams.getByText("Something went wrong: network down")).toBeTruthy();
  expect(exams.queryByText("Every exam on offer is downloaded.")).toBeNull();
});
