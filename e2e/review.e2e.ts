// Review: tabs — Study straight on the cards, Decks (per language and course, as in Anki, the decks
// to take, a deck file imported), My words — and the guide beside.
import { expect, test } from "@playwright/test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { beginCourse, post, put } from "./api.ts";
import { catalogs } from "./catalogs.ts";
import { E2E_DECK } from "./paths.ts";

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

test("a deck file imported in Decks, taken, studied as a course's deck; left and deleted after", async ({
  page,
  request,
}) => {
  // The projects share one profile: a deck an earlier run left is left and deleted first.
  const clear = async () => {
    const { decks } = await (await request.get("/api/decks")).json();
    for (const d of decks as Array<{ id: string }>) {
      await post(request, "/api/cards/decks/leave", { scope: `deck:${d.id}`, lang: "de" });
      const gone = await request.delete(`/api/decks/${d.id}`, { headers: { ...CLIENT_HEADERS } });
      expect(gone.ok()).toBe(true);
    }
  };
  await clear();
  await page.goto("/review/decks");
  await page.locator("input[type=file]").setInputFiles(E2E_DECK);
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Import a deck" })).toBeVisible();
  await expect(sheet.getByLabel("Name")).toHaveValue("E2E Wörter");
  await expect(sheet.getByText("3 words · no audio · 3 with examples")).toBeVisible();
  await expect(sheet.getByText("der Apfel")).toBeVisible();
  await sheet.getByRole("combobox", { name: "Words in" }).click();
  await page.getByRole("option", { name: "German" }).click();
  await sheet.getByRole("button", { name: "Import" }).click();
  await expect(sheet).toHaveCount(0);

  // Offered beside the courses; taken, it is under German in the decks.
  const offer = page.getByRole("listitem").filter({ hasText: "E2E Wörter" });
  const take = offer.getByRole("button", { name: /^(Take the deck|Add the other \d+)$/ });
  await take.click();
  await expect(take).toHaveCount(0);
  // Its words have no audio: read aloud by the server's engine (Piper on paper here) and kept.
  const missing = page.getByText("3 words without audio");
  await expect(missing).toBeVisible();
  await missing.locator("..").getByRole("button", { name: "Generate audio" }).click();
  await expect(page.getByText("All words have audio")).toBeVisible();
  // Its cards play what was read, from the deck's folder.
  const played = page.waitForResponse((r) =>
    /^\/decks\/[^/]+\/media\/read-[0-9a-f]{12}\.wav$/.test(new URL(r.url()).pathname),
  );
  await page.getByRole("button", { name: "E2E Wörter", exact: true }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText("Studying: E2E Wörter")).toBeVisible();
  const show = page.getByRole("button", { name: "Show answer" });
  await expect(show).toBeVisible();
  // The recording in the card's corner (played by itself where the browser lets it).
  await page.locator("div.relative:has(> [data-study-card])").getByRole("button").last().click();
  expect((await played).status()).toBeLessThan(300);
  await show.click();
  // The answer with the deck's own example sentence and its translation.
  const answer = page.locator("[data-study-card]").first();
  await expect(answer).toContainText(/apple|pear|table/);
  await expect(answer).toContainText(/I eat an apple\.|The pear is sweet\.|The table is new\./);
  await page.getByRole("button", { name: "Good", exact: true }).click();
  await expect(show).toBeVisible();
  await clear();
});

test("Settings → Review: daily limits kept, retention and card types, the rest said in a few lines", async ({
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
  await expect(page.getByRole("heading", { name: "Desired retention" })).toBeVisible();
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByRole("dialog").getByText(/comes back after 10 minutes/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Advanced")).toHaveCount(0);
  await perDay.fill("20");
  await perDay.press("Enter");
});

test("Settings' five tabs fit a phone in every interface language, nothing scrolled sideways", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  try {
    // Every catalog there is, English last (where the profile stays).
    const last = (c: { lang: string }) => c.lang === "en";
    for (const { lang, msg } of [...catalogs.filter((c) => !last(c)), ...catalogs.filter(last)]) {
      const ai = msg("settings.tabs.ai");
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
