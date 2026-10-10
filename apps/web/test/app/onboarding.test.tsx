import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { Onboarding } from "../../src/app/onboarding.tsx";
import { renderApp } from "../render.tsx";

const others = [
  ["profiles"],
  {
    profiles: [
      { id: "a", name: "Anna", colour: "amber", onboarded: true },
      { id: "b", name: "Boris", colour: "teal", onboarded: true },
    ],
    registration: true,
  },
] as [unknown[], unknown];
const progress = (view: Awaited<ReturnType<typeof renderApp>>) =>
  view.getByRole("list").getAttribute("aria-label");

test("a new profile: welcome, the sources, name and the first colour no profile uses; Back to who is studying", async () => {
  let back = 0;
  const view = await renderApp(
    <Onboarding profile={null} assistant={<p>slot</p>} onBack={() => back++} onDone={() => {}} />,
    { data: [others] },
  );
  expect(view.getByRole("heading", { level: 1 }).textContent).toBe("Welcome");
  expect(view.getByText(/straight from their publishers/)).toBeTruthy();
  expect(view.getByText(/Settings → General → Experimental/)).toBeTruthy();
  expect(view.queryByRole("group", { name: "Interface language" })).toBeNull();
  expect(progress(view)).toBe("Step 1 of 4");
  const pressed = (name: string) => view.getByRole("button", { name }).getAttribute("aria-pressed");
  expect(pressed("Rose")).toBe("true");
  fireEvent.click(view.getByRole("button", { name: "Lime" }));
  expect([pressed("Rose"), pressed("Lime")]).toEqual(["false", "true"]);
  const next = view.getByRole("button", { name: "Next" });
  expect(next.hasAttribute("disabled")).toBe(true);
  fireEvent.change(view.getByRole("textbox", { name: "Name or nickname" }), {
    target: { value: "Mila" },
  });
  expect(next.hasAttribute("disabled")).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Back" }));
  expect(back).toBe(1);
});

test("a named profile goes on at the assistant; one adopted without a name starts at its name", async () => {
  const named = { id: "n", name: "Mila", colour: "rose" as const, onboarded: false };
  const view = await renderApp(
    <Onboarding profile={named} assistant={<p>slot</p>} onDone={() => {}} />,
    { data: [others] },
  );
  expect(view.getByRole("heading", { level: 1 }).textContent).toBe("AI assistant");
  expect(progress(view)).toBe("Step 2 of 4");
  view.unmount();

  const adopted = { id: "local", name: "", colour: "amber" as const, onboarded: false };
  const first = await renderApp(<Onboarding profile={adopted} onDone={() => {}} />, {
    data: [others],
  });
  expect(first.getByRole("heading", { level: 1 }).textContent).toBe("Welcome");
  expect(progress(first)).toBe("Step 1 of 3");
  expect(first.getByRole("button", { name: "Amber" }).getAttribute("aria-pressed")).toBe("true");
  expect(first.queryByRole("button", { name: "Back" })).toBeNull();
});
