import { expect, test } from "bun:test";
import { StepDot } from "../../src/ui/step-dot.tsx";
import { renderApp } from "../render.tsx";

test("an exercise partly right has a mark of its own, apart from one with mistakes", async () => {
  const view = await renderApp(
    <>
      <StepDot state="partial" label={1} />
      <StepDot state="wrong" label={2} />
    </>,
  );
  const [partial, wrong] = [view.getByTitle("partly right"), view.getByTitle("with mistakes")];
  expect(partial.className).toContain("bg-wrong-soft");
  expect(wrong.className).toContain("bg-wrong ");
});
