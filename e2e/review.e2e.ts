// Review: straight on the cards; Decks lists the decks per language and course, as in Anki; My words
// under Decks.
import { expect, test } from "@playwright/test";
import { post } from "./api.ts";

test("review: the cards straight away, Decks to choose another, tap and keys, undo", async ({
  page,
  request,
}) => {
  // Cards of both demo lessons. The projects share one profile: the test takes its ratings back.
  for (const lesson of ["00-01", "00-02"])
    await post(request, "/api/cards/lesson", {
      series: "sprachanker.fixture",
      lessonKey: `sprachanker.fixture/demo/${lesson}`,
      edition: "en-de",
    });
  await page.goto("/review");
  // The window names the deck: the one chosen last (the projects share a profile), else German.
  await expect(page).toHaveTitle(/^SprachAnker · (German|Demo course)$/);
  // Straight on the cards; Decks lists German and under it the demo course, with New / Learn / Due.
  await expect(page.getByRole("button", { name: "Show answer" })).toBeVisible();
  await page.getByRole("button", { name: "Decks" }).click();
  await expect(page.getByRole("button", { name: /^German/ })).toBeVisible();
  await page.getByRole("button", { name: /^Demo course/ }).click();
  await expect(page.getByRole("heading", { name: "Demo course" })).toBeVisible();

  const show = page.getByRole("button", { name: "Show answer" });
  const card = page.locator("[data-study-card]").first();
  await expect(show).toBeVisible();
  const first = await card.innerText();
  await show.click();
  await page.getByRole("button", { name: "Good", exact: true }).click();
  // The next card, on its question.
  await expect(show).toBeVisible();
  await expect(card).not.toHaveText(first);
  const second = await card.innerText();
  // The keyboard: Space shows the answer, Space again answers Good; Ctrl+Z and U undo.
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Again", exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(show).toBeVisible();
  await expect(card).not.toHaveText(second);
  await page.keyboard.press("Control+z");
  await expect(show).toBeVisible();
  await expect(card).toHaveText(second);
  await page.keyboard.press("u");
  await expect(card).toHaveText(first);
});

test("review: a card buried from the More menu comes back with Unbury in the same menu", async ({
  page,
  request,
}) => {
  for (const lesson of ["00-01", "00-02"])
    await post(request, "/api/cards/lesson", {
      series: "sprachanker.fixture",
      lessonKey: `sprachanker.fixture/demo/${lesson}`,
      edition: "en-de",
    });
  await page.goto("/review");
  const card = page.locator("[data-study-card]").first();
  await expect(page.getByRole("button", { name: "Show answer" })).toBeVisible();
  const buried = await card.innerText();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: /Bury card/ }).click();
  await expect(card).not.toHaveText(buried);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Unbury" }).click();
  // The buried card is the deck's first new card again.
  await expect(card).toHaveText(buried);
});

test("a course that is not installed says so, with the way to all courses", async ({ page }) => {
  await page.goto("/course/sprachanker.fixture/nope");
  await expect(page.getByText("This course is not installed (any more).")).toBeVisible();
  await page.getByRole("link", { name: "All courses" }).last().click();
  await expect(page).toHaveURL(/\/catalog$/);
});

test("My words: the table under Decks, search, a word's sheet, suspend and back", async ({
  page,
  request,
}) => {
  await post(request, "/api/cards/lesson", {
    series: "sprachanker.fixture",
    lessonKey: "sprachanker.fixture/demo/00-01",
    edition: "en-de",
  });
  await page.goto("/review?decks=true");
  await page.getByRole("link", { name: "My words" }).click();
  await expect(page).toHaveURL(/\/review\/words$/);
  await expect(page.getByRole("heading", { name: "My words" })).toBeVisible();

  await page.getByPlaceholder("Find a word or translation").fill("kaffee");
  const row = page.getByRole("button", { name: /der Kaffee/ });
  await expect(row).toHaveCount(1);
  await row.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Word → meaning")).toBeVisible();
  await expect(sheet.getByRole("link", { name: /Lesson 0\.1/ })).toBeVisible();

  // Suspended from the sheet: the row says so, the Suspended filter finds it; restored after.
  await sheet.getByRole("button", { name: "Suspend" }).click();
  await expect(sheet.getByRole("button", { name: "Unsuspend" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row).toContainText("Suspended");
  await page.getByRole("button", { name: /^Suspended \d/ }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: /^New \d/ }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: /^All \d/ }).click();
  await row.click();
  await sheet.getByRole("button", { name: "Unsuspend" }).click();
  await expect(sheet.getByRole("button", { name: "Suspend" })).toBeVisible();
});
