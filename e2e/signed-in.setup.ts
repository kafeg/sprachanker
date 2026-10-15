// Before the tests: the profile they study as — made, onboarded and signed in, its device cookie kept
// for every project (playwright.config.ts `storageState`).
import { expect, test as setup } from "@playwright/test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { SIGNED_IN } from "./paths.ts";

setup("a profile, onboarded and signed in", async ({ request }) => {
  const made = await request.post("/api/profiles", {
    data: { name: "E2E" },
    headers: { ...CLIENT_HEADERS },
  });
  expect(made.ok()).toBe(true);
  const done = await request.put("/api/profile", {
    data: { onboarded: true },
    headers: { ...CLIENT_HEADERS },
  });
  expect(done.ok()).toBe(true);
  await request.storageState({ path: SIGNED_IN });
});
