import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4590;
// Phone width required by apps/web/CLAUDE.md.
const phone = { width: 375, height: 812 };
// The compiled binary (`bun run build:cli`), started from an unrelated folder: everything it serves
// must come from inside the binary.
const binary = resolve(import.meta.dirname, "../apps/cli/dist/sprachanker");

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: "en-US", trace: "retain-on-failure" },
  webServer: {
    command: `"${binary}" serve --port ${PORT}`,
    cwd: tmpdir(),
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "chromium-phone", use: { ...devices["Pixel 7"], viewport: phone } },
    { name: "webkit-phone", use: { ...devices["iPhone 15"], viewport: phone } },
  ],
});
