// Review: the cards made from the lessons' words, one at a time, rated by tap or keyboard.
import { expect, test } from "@playwright/test";
import { post, put } from "./api.ts";

test("review: the front, the answer on a tap, two ratings; the keyboard does the same", async ({
  page,
  request,
}) => {
  // Cards of both demo lessons; the projects share one profile, so allow enough new ones for each.
  await put(request, "/api/settings", { key: "srs.newPerDay", value: 100 });
  for (const lesson of ["00-01", "00-02"])
    await post(request, "/api/cards/lesson", {
      series: "sprachanker.fixture",
      lessonKey: `sprachanker.fixture/demo/${lesson}`,
      edition: "en-de",
      known: [],
    });

  await page.goto("/review");
  await expect(page).toHaveTitle("SprachAnker · Review");
  const position = page.getByText(/^1 of \d+$/);
  await expect(position).toBeVisible();
  const total = Number((await position.textContent())?.split(" of ")[1]);
  await expect(page.getByRole("button", { name: /^Forgot/ })).toBeHidden();
  await page.getByRole("button", { name: "Show the answer" }).click();
  // Each rating says when the card comes back.
  await expect(page.getByRole("button", { name: /^Remembered/ })).toContainText(
    /in \d+ minutes?|in \d+ hours?|tomorrow|in \d+ days/,
  );
  await page.getByRole("button", { name: /^Remembered/ }).click();
  if (total === 1) {
    await expect(page.getByText("1 card reviewed")).toBeVisible();
    return;
  }
  await expect(page.getByText(`2 of ${total}`)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: /^Forgot/ })).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByText(total > 2 ? `3 of ${total}` : "2 cards reviewed")).toBeVisible();
});
