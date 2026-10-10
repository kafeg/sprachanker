import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { WhoIsStudying } from "../../src/app/who-is-studying.tsx";
import { renderApp } from "../render.tsx";

const profile = (i: number) => ({
  id: `p${i}`,
  name: `Learner ${i}`,
  colour: "teal",
  onboarded: true,
});
const listOf = (n: number) =>
  [
    ["profiles"],
    { profiles: Array.from({ length: n }, (_, i) => profile(i + 1)), registration: true },
  ] as [unknown[], unknown];

test("five profiles to a page, New profile after them; ← / → and the arrow keys page", async () => {
  let added = 0;
  const view = await renderApp(<WhoIsStudying onNew={() => added++} />, { data: [listOf(7)] });
  // Each tile's name (its initial on the avatar left out).
  const names = () =>
    view
      .getAllByRole("listitem")
      .map((li) => li.querySelector("button > span:last-child")?.textContent);
  expect(names()).toEqual([
    "Learner 1",
    "Learner 2",
    "Learner 3",
    "Learner 4",
    "Learner 5",
    "New profile",
  ]);
  expect(view.getByText("1 of 2")).toBeTruthy();
  const previous = view.getByRole("button", { name: "Previous profiles" });
  expect(previous.hasAttribute("disabled")).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "More profiles" }));
  expect(names()).toEqual(["Learner 6", "Learner 7", "New profile"]);
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(names()[0]).toBe("Learner 1");
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(view.getByText("2 of 2")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: /New profile/ }));
  expect(added).toBe(1);
});

test("a single profile: no paging; the interface language stays on this screen", async () => {
  const view = await renderApp(<WhoIsStudying onNew={() => {}} />, { data: [listOf(1)] });
  expect(view.queryByRole("button", { name: "More profiles" })).toBeNull();
  expect(view.getByRole("group", { name: "Interface language" })).toBeTruthy();
  expect(view.getAllByRole("listitem")).toHaveLength(2);
});
