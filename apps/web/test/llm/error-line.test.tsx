import { expect, test } from "bun:test";
import { ApiError, errorOf } from "../../src/api/client.ts";
import { ErrorLine } from "../../src/llm/parts.tsx";
import { renderApp } from "../render.tsx";

test("a provider's error in words, with the wait it gave", async () => {
  const view = await renderApp(
    <ErrorLine error={errorOf({ error: "llm_rate_limited", retryAfter: 20 }, "", 502)} />,
  );
  expect(view.container.textContent).toContain("The provider's limit is reached");
  expect(view.container.textContent).toContain("Try again in 20 sec.");
  view.unmount();
});

test("a refusal in words, without a wait when none was given", async () => {
  const view = await renderApp(<ErrorLine error={new ApiError("llm_refused", 502)} />);
  expect(view.container.textContent).toBe("The model declined to answer this.");
  view.unmount();
});
