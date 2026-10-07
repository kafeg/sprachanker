// Review as in Anki: decks per language and course, the deck's overview, the study session.
import { expect, test } from "@playwright/test";
import { post } from "./api.ts";

test("review: decks, the overview, a card studied by tap and keys, undo", async ({
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
  await expect(page).toHaveTitle("SprachAnker · Review");
  // German, and under it the demo course, each with New / Learn / Due.
  await expect(page.getByRole("button", { name: /^German/ })).toBeVisible();
  await page.getByRole("button", { name: /^Demo course/ }).click();
  await expect(page.getByText("To Review")).toBeVisible();
  await page.getByRole("button", { name: "Study now" }).click();

  const show = page.getByRole("button", { name: "Show answer" });
  const card = page.locator("[aria-expanded]").first();
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
