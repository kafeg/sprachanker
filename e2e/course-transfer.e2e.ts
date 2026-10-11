// A course moved as a file (02, "Course bundle"): exported from its Downloaded card, gone from this
// computer, imported back from Courses → Downloaded and studied; the fixture course put back whole
// after (the export carries the card's pair only, other tests study the other).
import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DEMO_LESSON } from "./api.ts";
import { E2E_DATA } from "./paths.ts";

test.skip(
  ({ isMobile }) => isMobile,
  "moving a course is a desktop's matter; the screens are tested",
);

const SERIES = join(E2E_DATA, "library", "sprachanker.fixture");
/** The fixture's series while it is gone: outside the library. */
const ASIDE = join(E2E_DATA, "fixture-aside");

test.afterEach(() => {
  if (!existsSync(ASIDE)) return;
  rmSync(SERIES, { recursive: true, force: true });
  renameSync(ASIDE, SERIES);
});

test("export the demo course, remove it, import it back, open a lesson", async ({ page }) => {
  await page.goto("/downloaded");
  await expect(page.getByRole("heading", { name: "Demo course" })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to a file" }).first().click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^sprachanker\.fixture-demo-en-de-\d{4}-\d{2}-\d{2}\.sprachanker-course$/,
  );
  const file = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await expect(page.getByText(/^Downloading “sprachanker\.fixture-demo-/)).toBeVisible();

  // Gone from this computer: its files and its media.
  renameSync(SERIES, ASIDE);
  await page.reload();
  await expect(page.getByText("No course is downloaded yet.")).toBeVisible();

  // Imported back: installed, checked whole, shown again.
  await page.locator('input[type="file"][accept^=".sprachanker-course"]').setInputFiles(file);
  await expect(page.getByText("“Demo course” is here.")).toBeVisible();
  await expect(page.getByText("Checked: every file is there.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo course" })).toBeVisible();

  // Studied: its first lesson opens with its texts and media.
  await page.goto(`/lesson/${DEMO_LESSON}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Im Café");
  const video = await page.request.get("/library/sprachanker.fixture/media/video/cafe-sd.mp4");
  expect(video.ok()).toBe(true);
});
