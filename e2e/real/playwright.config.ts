// Run-throughs on real courses (10, "Run-throughs"): the compiled binary serving a clone of the real
// library (data.ts), Chromium at phone width with a fake microphone; on the Mac only, never in CI.
// `REAL_DESKTOP=1` adds a desktop run.
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { REAL_DATA } from "./data.ts";

const PORT = 4591;
const binary = resolve(import.meta.dirname, "../../apps/cli/dist/sprachanker");
const media = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
];

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.real.ts",
  workers: 1,
  timeout: 10 * 60_000,
  reporter: "list",
  outputDir: resolve(tmpdir(), "sprachanker-real-results"),
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-US",
    screenshot: "only-on-failure",
    // A control that never comes fails the step at once, not at the end of the test.
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    permissions: ["microphone"],
    launchOptions: { args: media },
  },
  webServer: {
    command: `"${binary}" serve --port ${PORT} --data "${REAL_DATA}"`,
    cwd: tmpdir(),
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
    ...(process.env.REAL_DESKTOP
      ? [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }]
      : []),
  ],
});
