import { expect, test } from "bun:test";
import { setupProblem } from "../../src/llm/errors.ts";

test("a provider is checked only once it can be: tool installed, endpoint set, key given", () => {
  const p = { baseUrl: "https://x/v1", key: "optional" as const, hasKey: false };
  expect(setupProblem(p)).toBeUndefined();
  expect(setupProblem({ ...p, baseUrl: "" })).toBe("llm_no_endpoint");
  expect(setupProblem({ ...p, key: "required" })).toBe("llm_no_key");
  expect(setupProblem({ ...p, key: "required", hasKey: true })).toBeUndefined();
  // Command-line agents have no endpoint: only their tool matters.
  expect(setupProblem({ baseUrl: "", key: "none", hasKey: false, installed: false })).toBe(
    "llm_cli_missing",
  );
  expect(
    setupProblem({ baseUrl: "", key: "none", hasKey: false, installed: true }),
  ).toBeUndefined();
});
