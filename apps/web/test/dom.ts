// A browser for the web's tests, loaded before anything else (bunfig.toml preload): React decides what
// the DOM supports as it loads, so happy-dom must be there first. The web's tests run on their own
// (`bun run test` in apps/web), never in the same process as the server's.

import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
  url: "http://127.0.0.1:4580/",
  settings: { navigator: { userAgent: "sprachanker-test" } },
});
Object.defineProperty(navigator, "languages", { value: ["en-US"], configurable: true });

// What a test rendered leaves the page before the next one (imported after the DOM exists).
const { cleanup } = await import("@testing-library/react");
afterEach(() => cleanup());
