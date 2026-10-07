import { expect, test } from "bun:test";
import { exerciseResults, mistakesOf } from "@sprachanker/engine";
import { fireEvent } from "@testing-library/react";
import { MistakesStatus } from "../../src/lesson/mistakes-status.tsx";
import { renderApp } from "../render.tsx";
import { answered, lesson, locale } from "./lesson.ts";

test("the run counted: exercises worked, right at the first try, mistakes by exercise", async () => {
  // The first exercise wrong, then fixed; the second not worked yet.
  const events = [answered("ex-01#1", "b"), answered("ex-01#1", "a", 2)];
  const gone: string[] = [];
  const view = await renderApp(
    <MistakesStatus
      lesson={lesson}
      locale={locale}
      results={exerciseResults(events)}
      mistakes={mistakesOf([{ events }])}
      go={(id) => gone.push(id)}
    />,
  );
  expect(view.getByText("Exercises worked").nextElementSibling?.textContent).toBe("1 of 2");
  expect(view.getByText("Right at the first try").nextElementSibling?.textContent).toBe("0 of 1");
  const row = view.getByRole("button", { name: /First/ });
  expect(row.textContent).toContain("item 1");
  expect(row.textContent).toContain("1 fixed later");
  fireEvent.click(row);
  expect(gone).toEqual(["exercise:0"]);
});

test("nothing answered yet, and no mistakes, say so", async () => {
  const empty = await renderApp(
    <MistakesStatus lesson={lesson} locale={locale} results={{}} mistakes={[]} go={() => {}} />,
  );
  expect(empty.getByText(/Nothing answered yet/)).toBeTruthy();
  empty.unmount();
  const events = [answered("ex-01#1", "a")];
  const clean = await renderApp(
    <MistakesStatus
      lesson={lesson}
      locale={locale}
      results={exerciseResults(events)}
      mistakes={[]}
      go={() => {}}
    />,
  );
  expect(clean.getByText("No mistakes in this run.")).toBeTruthy();
});
