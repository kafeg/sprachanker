// A browser for the web's tests, loaded before anything else (bunfig.toml preload): React decides what
// the DOM supports as it loads, so happy-dom must be there first. The web's tests run on their own
// (`bun run test` in apps/web), never in the same process as the server's.

import { afterEach, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// An origin no server listens on: a test never reaches a real server (the owner's runs on 4580).
GlobalRegistrator.register({
  url: "http://sprachanker.test/",
  settings: { navigator: { userAgent: "sprachanker-test" } },
});
Object.defineProperty(navigator, "languages", { value: ["en-US"], configurable: true });

// Tests render with the query cache filled (test/render.tsx): a request means data a test forgot to
// fill. It fails, and the test that made it fails too.
const requested: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  requested.push(url);
  throw new Error(`a test asked the network: ${url}`);
}) as unknown as typeof fetch;

// What a test rendered leaves the page before the next one (imported after the DOM exists).
const { cleanup } = await import("@testing-library/react");
afterEach(() => {
  cleanup();
  const asked = requested.splice(0);
  expect(asked, "requests a test made (fill their data in the query cache)").toEqual([]);
});
