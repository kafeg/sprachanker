import { expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "../../src/api/client.ts";
import type { ExportedCourse, ImportedCourse } from "../../src/api/courses.ts";
import { CourseExport, CourseImport } from "../../src/library/bundle.tsx";
import { CoursesPage } from "../../src/routes/courses.tsx";
import { renderApp } from "../render.tsx";

const READY = {
  id: "6f1c2a40-0000-4000-8000-000000000002",
  fileName: "dw.nicos-weg-a1-ru-ru-de-2026-10-11.sprachanker-course",
  bytes: 3_200_000_000,
  courses: [{ course: "dw.nicos-weg/a1-ru", editions: ["ru-de"] }],
} as ExportedCourse;

test("Export to a file: the card's edition made ready on the server, then downloaded under its name", async () => {
  const asked: unknown[] = [];
  const downloads: string[][] = [];
  const view = await renderApp(
    <CourseExport
      series="dw.nicos-weg"
      course="a1-ru"
      edition="ru-de"
      prepare={async (course) => {
        asked.push(course);
        return READY;
      }}
      check={async () => {}}
      download={(url, name) => void downloads.push([url, name])}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Export to a file" }));
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toBe(
      "Downloading “dw.nicos-weg-a1-ru-ru-de-2026-10-11.sprachanker-course” (3.2 GB).",
    ),
  );
  expect(asked).toEqual([{ series: "dw.nicos-weg", course: "a1-ru", edition: "ru-de" }]);
  expect(downloads).toEqual([[`/api/courses/export/${READY.id}`, READY.fileName]]);
});

test("Export to a file: one gone before its download said in words, never saved as the file", async () => {
  const downloads: string[] = [];
  const view = await renderApp(
    <CourseExport
      series="dw.nicos-weg"
      course="a1-ru"
      edition="ru-de"
      prepare={async () => READY}
      check={() => Promise.reject(new ApiError("course_export_gone", 404))}
      download={(url) => void downloads.push(url)}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Export to a file" }));
  await waitFor(() =>
    expect(view.getByText("This export is no longer here: export the course again.")).toBeTruthy(),
  );
  expect(downloads).toEqual([]);
});

/** A file chosen in the hidden picker. */
function choose(view: Awaited<ReturnType<typeof renderApp>>) {
  const input = view.getByLabelText("Import from a file…", {
    selector: "input",
  }) as HTMLInputElement;
  const file = new File(["zip"], "dw.nicos-weg-a1-ru-ru-de-2026-10-11.sprachanker-course");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

type Course = ImportedCourse["courses"][number];
const course = (status: Course["status"], problems = 0, id = "a1-ru", title = "Nicos Weg A1") => ({
  key: `dw.nicos-weg/${id}` as Course["key"],
  kind: "course" as const,
  editions: ["ru-de"],
  titles: { "ru-de": title },
  status,
  check: { problems, missing: 0 },
});
const result = (status: Course["status"], problems = 0): ImportedCourse => ({
  courses: [course(status, problems)],
  media: { added: 3, kept: 0 },
});

test("Import from a file: sent with its progress, checked, then the course installed and verified", async () => {
  let progress: (sent: number) => void = () => {};
  let finish: (result: ImportedCourse) => void = () => {};
  const view = await renderApp(
    <CourseImport
      upload={(_, onProgress) => {
        progress = onProgress;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }}
    />,
  );
  expect(view.getByText(/exported on your other device/)).toBeTruthy();
  choose(view);
  await waitFor(() => expect(view.getByText("Sending the file… 0%")).toBeTruthy());
  act(() => progress(0.5));
  expect(view.getByText("Sending the file… 50%")).toBeTruthy();
  act(() => progress(1));
  expect(view.getByText("Checking the file and installing it…")).toBeTruthy();
  await act(async () => finish(result("added")));
  expect(view.getByText("“Nicos Weg A1” is here.")).toBeTruthy();
  expect(view.getByText("Checked: every file is there.")).toBeTruthy();
});

test("Import from a file: the same course, a replaced one with its progress kept, problems found", async () => {
  for (const [status, problems, words, check] of [
    [
      "same",
      0,
      "“Nicos Weg A1” is here already, the same: nothing changed.",
      "Checked: every file is there.",
    ],
    [
      "replaced",
      2,
      "“Nicos Weg A1” is now the file's version; your progress is kept.",
      "Checked: 2 problems found — “Check” on its card lists them.",
    ],
  ] as const) {
    const view = await renderApp(<CourseImport upload={async () => result(status, problems)} />);
    choose(view);
    await waitFor(() => expect(view.getByText(words)).toBeTruthy());
    expect(view.getByText(check)).toBeTruthy();
    view.unmount();
  }
});

test("Import from a file: a file of two courses, each said with its check", async () => {
  const view = await renderApp(
    <CourseImport
      upload={async () => ({
        courses: [course("same"), course("added", 1, "a1-en", "Nico's Weg A1")],
        media: { added: 0, kept: 3 },
      })}
    />,
  );
  choose(view);
  await waitFor(() => expect(view.getByText("“Nico's Weg A1” is here.")).toBeTruthy());
  expect(view.getByText("“Nicos Weg A1” is here already, the same: nothing changed.")).toBeTruthy();
  expect(view.getByText("Checked: every file is there.")).toBeTruthy();
  expect(view.getByText("Checked: 1 problem found — “Check” on its card lists them.")).toBeTruthy();
});

test("Import from a file: an experimental course the server does not list is here — said, with how it is shown", async () => {
  const hidden = result("added");
  hidden.courses = hidden.courses.map((c) => ({ ...c, hidden: true as const }));
  const view = await renderApp(<CourseImport upload={async () => hidden} />, {
    path: "/exams/downloaded",
  });
  choose(view);
  await waitFor(() =>
    expect(
      view.getByText(/listed only when SprachAnker is started with --experimental/),
    ).toBeTruthy(),
  );
});

test("Import from a file: a course listed says nothing of --experimental", async () => {
  const view = await renderApp(<CourseImport upload={async () => result("added")} />);
  choose(view);
  await waitFor(() => expect(view.getByText("“Nicos Weg A1” is here.")).toBeTruthy());
  expect(view.queryByText(/--experimental/)).toBeNull();
});

test("Import from a file: a refused file said in words", async () => {
  const view = await renderApp(
    <CourseImport upload={() => Promise.reject(new ApiError("course_bundle_clash", 409))} />,
  );
  choose(view);
  await waitFor(() =>
    expect(view.getByText(/other files under the names of this course's media/)).toBeTruthy(),
  );
});

test("Downloaded with no course yet: the way to the catalogue, and a course file to import", async () => {
  const view = await renderApp(<CoursesPage tab="downloaded" />, {
    path: "/downloaded",
    data: [
      [["courses"], []],
      [["catalog"], []],
    ],
  });
  expect(view.getByRole("link", { name: "Choose a course" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Import from a file…" })).toBeTruthy();
});
