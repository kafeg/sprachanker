// Review: tabs — Study straight on the cards, Decks (per language and course, as in Anki, and the decks
// to take), My words — and the guide beside.
import { expect, test } from "@playwright/test";
import { beginCourse, post, put } from "./api.ts";

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
  await expect(page).toHaveTitle("SprachAnker · Review");
  // Straight on the cards of the deck chosen last (the projects share a profile), else German.
  await expect(page.getByText(/^Studying: (German|Demo course)$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show answer" })).toBeVisible();
  // Decks lists German and under it the demo course, with New / Learn / Due; and the decks to take.
  await page.getByRole("link", { name: "Decks" }).click();
  await expect(page).toHaveURL(/\/review\/decks$/);
  await expect(page.getByRole("button", { name: "German", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Demo course", exact: true }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText("Studying: Demo course")).toBeVisible();

  const show = page.getByRole("button", { name: "Show answer" });
  const card = page.locator("[data-study-card]").first();
  await expect(show).toBeVisible();
  const first = await card.innerText();
  await show.click();
  await page.getByRole("button", { name: "Good", exact: true }).click();
  // The next card, on its question.
  await expect(show).toBeVisible();
  await expect.poll(() => card.innerText()).not.toBe(first);
  const second = await card.innerText();
  // The keyboard: Space shows the answer, Space again answers Good; Ctrl+Z and U undo.
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Again", exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(show).toBeVisible();
  await expect.poll(() => card.innerText()).not.toBe(second);
  await page.keyboard.press("Control+z");
  await expect(show).toBeVisible();
  await expect.poll(() => card.innerText()).toBe(second);
  await page.keyboard.press("u");
  await expect.poll(() => card.innerText()).toBe(first);
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
  await expect.poll(() => card.innerText()).not.toBe(buried);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Unbury" }).click();
  // The buried card is the deck's first new card again.
  await expect.poll(() => card.innerText()).toBe(buried);
});

test("a course that is not installed says so, with the way to the available courses", async ({
  page,
}) => {
  await page.goto("/course/sprachanker.fixture/nope");
  await expect(page.getByText("This course is not installed (any more).")).toBeVisible();
  await page.getByRole("link", { name: "Available" }).last().click();
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
  await page.goto("/review/decks");
  await page.getByRole("link", { name: "My words" }).click();
  await expect(page).toHaveURL(/\/review\/words$/);
  await expect(page.getByRole("link", { name: "My words" })).toHaveAttribute(
    "aria-current",
    "page",
  );

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

test("review: the guide explains the method beside; the decks to take are offered", async ({
  page,
  request,
}) => {
  await post(request, "/api/cards/lesson", {
    series: "sprachanker.fixture",
    lessonKey: "sprachanker.fixture/demo/00-01",
    edition: "en-de",
  });
  // Offered: the courses of My courses.
  await beginCourse(request);
  await page.goto("/review/decks");
  await expect(page.getByRole("heading", { name: "Decks to take" })).toBeVisible();
  // A course's deck with its language pair and what it does, at hand.
  await expect(page.getByText("English → German").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave deck…" }).first()).toBeVisible();
  await page.getByRole("button", { name: "How it works" }).click();
  const guide = page.getByRole("dialog");
  await expect(guide.getByRole("heading", { name: "How review works" })).toBeVisible();
  await expect(guide.getByRole("heading", { name: "Spaced repetition" })).toBeVisible();
  await expect(guide.getByRole("img", { name: /forgetting curves/ })).toBeVisible();
});

test("Settings → Review: Anki's deck options, the rarer ones under Advanced, kept; back to Anki's defaults", async ({
  page,
}) => {
  await page.goto("/settings#review");
  // Five tabs in one row, none narrower than its label.
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(5);
  await expect(page.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true");
  for (const tab of await tabs.all())
    expect(await tab.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  const perDay = page.getByRole("textbox", { name: "New cards per day" });
  await expect(perDay).toHaveValue("20");
  await perDay.fill("15");
  await perDay.press("Enter");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "New cards per day" })).toHaveValue("15");
  // The steps, retention and the day's start are under Advanced.
  await page.getByText("Advanced").click();
  await expect(page.getByRole("textbox", { name: "Learning steps", exact: true })).toHaveValue(
    "1m 10m",
  );
  await page.getByRole("button", { name: "Back to Anki's defaults" }).click();
  await expect(page.getByRole("textbox", { name: "New cards per day" })).toHaveValue("20");
});

test("Settings' five tabs fit a phone in every interface language, nothing scrolled sideways", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  try {
    for (const [lang, ai] of [
      ["ru", "ИИ-помощник"],
      ["de", "KI-Assistent"],
      ["en", "AI assistant"],
    ]) {
      await put(request, "/api/settings", { key: "uiLanguage", value: lang });
      await page.goto("/settings#ai");
      await page.reload();
      // The AI tab is short on a phone; its name stays whole.
      await expect(page.getByRole("tab", { name: ai })).toHaveAttribute("aria-selected", "true");
      await page.evaluate(() => document.fonts.ready);
      const bar = page.getByRole("tablist");
      expect(await bar.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      for (const tab of await bar.getByRole("tab").all())
        expect(await tab.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    }
  } finally {
    await put(request, "/api/settings", { key: "uiLanguage", value: "en" });
  }
});
