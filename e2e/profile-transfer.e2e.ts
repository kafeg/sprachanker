// A profile moved as a file (05, "Profile file"): exported from Settings → Profile, imported on who
// is studying as a new profile, opened there and studied on; deleted again so the server keeps one
// profile named E2E.
import { expect, test } from "@playwright/test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { answerPicture, beginCourse, DEMO_LESSON, freshLessonRun, goToStep } from "./api.ts";

test.skip(
  ({ isMobile }) => isMobile,
  "moving a profile is a desktop's matter; the screens are tested",
);

test("export a profile, import it as a new one, study on", async ({ page, request, browser }) => {
  // Something to carry: the demo course begun (its lesson anew, so it opens on its overview).
  await freshLessonRun(request);
  await beginCourse(request);
  await page.goto("/settings#profile");
  await expect(page.getByRole("heading", { name: "Move to another computer" })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export profile" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^E2E-\d{4}-\d{2}-\d{2}\.sprachanker-profile$/);
  const file = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await expect(page.getByText(/^Downloading “E2E-/)).toBeVisible();

  // Another device, signed in to nothing (this one stays E2E's).
  const { baseURL, locale } = test.info().project.use;
  const other = await browser.newContext({
    baseURL,
    locale,
    storageState: { cookies: [], origins: [] },
  });
  const there = await other.newPage();
  await there.goto("/");
  await expect(there.getByRole("heading", { name: "Who is studying?" })).toBeVisible();
  await there.locator('input[type="file"][accept^=".sprachanker-profile"]').setInputFiles(file);
  await expect(there.getByText("“E2E (2)” is here.")).toBeVisible();
  // The tile is there too, beside the profile it came from.
  await expect(there.getByRole("listitem").filter({ hasText: "E2E (2)" })).toBeVisible();
  await there.getByRole("button", { name: "Open “E2E (2)”" }).click();

  // Studied on: the course begun is in My courses; its lesson goes on, an exercise answered.
  await expect(there.getByRole("heading", { name: "Demo course" })).toBeVisible();
  await there.goto(`/lesson/${DEMO_LESSON}`);
  await expect(there.getByRole("heading", { level: 1 })).toHaveText("Im Café");
  // The run goes on where it was (an item skipped): the overview only if it had not begun.
  const start = there.getByRole("button", { name: "Start lesson" });
  if (await start.isVisible()) await start.click();
  await goToStep(there, "Lena at the café");
  await there.getByRole("button", { name: "Im Café.", exact: true }).click();
  await answerPicture(there);
  await there.getByRole("button", { name: "Check", exact: true }).click();
  await expect(there.getByRole("button", { name: "Try again" })).toBeVisible();

  // Gone again: the imported profile deleted, its device signed out.
  const gone = await there.request.delete("/api/profile", { headers: { ...CLIENT_HEADERS } });
  expect(gone.ok()).toBe(true);
  await other.close();
});
