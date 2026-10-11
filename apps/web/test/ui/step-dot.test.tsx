import { expect, test } from "bun:test";
import { StepDot, withPartial } from "../../src/ui/step-dot.tsx";
import { renderApp } from "../render.tsx";

test("an exercise with mistakes and some items right at once is partly right, with a mark of its own", async () => {
  expect(withPartial("wrong", 2)).toBe("partial");
  expect(withPartial("wrong", 0)).toBe("wrong");
  expect(withPartial("correct", 3)).toBe("correct");
  expect(withPartial(undefined)).toBeUndefined();
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
