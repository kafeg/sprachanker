import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { FAKE_LLM_PORT } from "./fake-llm.ts";

const PORT = 4590;
// Phone width required by apps/web/CLAUDE.md.
const phone = { width: 375, height: 812 };
// The compiled binary (`bun run build:cli`), started from an unrelated folder: everything it serves
// must come from inside the binary.
const binary = resolve(import.meta.dirname, "../apps/cli/dist/sprachanker");
// Written by fixture-data.ts before the run (same path).
const data = join(tmpdir(), "sprachanker-e2e");

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  // One profile on the server: tests run one after another.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: "en-US", trace: "retain-on-failure" },
  webServer: [
    {
      command: `"${binary}" serve --port ${PORT} --data "${data}"`,
      cwd: tmpdir(),
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bun fake-llm.ts",
      cwd: import.meta.dirname,
      url: `http://127.0.0.1:${FAKE_LLM_PORT}/v1/models`,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "chromium-phone", use: { ...devices["Pixel 7"], viewport: phone } },
    { name: "webkit-phone", use: { ...devices["iPhone 15"], viewport: phone } },
  ],
});
