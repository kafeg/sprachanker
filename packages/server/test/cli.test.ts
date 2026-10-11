import { expect, test } from "bun:test";
import { environment } from "../src/runtime/cli.ts";

test("a command-line agent's environment: this process's, with the run's own set or removed", () => {
  process.env.SPRACHANKER_TEST_REMOVED = "high";
  try {
    const env = environment({ SPRACHANKER_TEST_REMOVED: undefined, SPRACHANKER_TEST_SET: "3" });
    expect(env.SPRACHANKER_TEST_SET).toBe("3");
    expect("SPRACHANKER_TEST_REMOVED" in env).toBe(false);
    expect(env.PATH).toBe(process.env.PATH);
    expect(process.env.SPRACHANKER_TEST_REMOVED).toBe("high");
  } finally {
    delete process.env.SPRACHANKER_TEST_REMOVED;
  }
});
