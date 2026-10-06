// Review: the cards made from the lessons' words, one at a time, rated by tap or keyboard.
import { expect, test } from "@playwright/test";
import { post, put } from "./api.ts";

test("review: the front, the answer on a tap, four ratings as in Anki; the keyboard does the same", async ({
  page,
  request,
}) => {
  // Cards are shared by the projects' one profile and a rated card waits for its due time; the demo
  // lessons have six words, so two projects review (both engines, both layouts).
  test.skip(
    !["chromium-desktop", "webkit-phone"].includes(test.info().project.name),
    "the demo course has words enough for two projects",
  );
  // Cards of both demo lessons, with room for every new one of the day.
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
  await expect(page.getByRole("button", { name: /Again\s*(in |tomorrow)/ })).toBeHidden();
  await page.getByRole("button", { name: "Show the answer" }).click();
  // Each rating says when the card comes back.
  await expect(page.getByRole("button", { name: /Good\s*(in |tomorrow)/ })).toContainText(
    /in \d+ minutes?|in \d+ hours?|tomorrow|in \d+ days/,
  );
  await page.getByRole("button", { name: /Good\s*(in |tomorrow)/ }).click();
  if (total === 1) {
    await expect(page.getByText("1 card reviewed")).toBeVisible();
    return;
  }
  await expect(page.getByText(`2 of ${total}`)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: /Again\s*(in |tomorrow)/ })).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByText(total > 2 ? `3 of ${total}` : "2 cards reviewed")).toBeVisible();
});
