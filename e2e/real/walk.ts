/// <reference lib="dom" />
// Walking a lesson through as a learner does (10, "Run-throughs"), by its screens only: the words
// rated, the reading pages read, every exercise answered and checked (any complete answer — what is
// checked is that it is stored as the engine marks it), speaking items recorded with the browser's fake
// microphone, and the summary reached. After each step: nothing past the screen's width, no error page.
import { readFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";
import type { Exercise } from "@sprachanker/schema";

/** The interface in English: the labels the screens are found by. */
const en = JSON.parse(
  readFileSync(new URL("../../apps/web/src/i18n/en.json", import.meta.url), "utf8"),
);

/** Recordings play muted, one after another as the app plays them: playing is what counts as heard
 *  (09). */
async function playAll(page: Page) {
  await page.evaluate(async () => {
    for (const m of document.querySelectorAll<HTMLMediaElement>("audio, video")) {
      m.muted = true;
      await m.play().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 50));
      m.pause();
    }
  });
}

/** Labels cut short on the screen — buttons and links whose text does not fit them — to look at (not
 *  a failure: some are cut on purpose, with the whole text on hover). */
export const clipped: string[] = [];
async function noteClipped(page: Page, where: string) {
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("button, a, [role=tab]")]
      .filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1)
      .map((el) => (el.textContent ?? "").trim().slice(0, 50))
      .filter(Boolean),
  );
  for (const text of cut) clipped.push(`${where}: ${text}`);
}

/** The screen is whole: nothing wider than it, no error page. */
export async function expectWhole(page: Page, where: string) {
  // The layout's width, not the window's: a phone's window grows with content that sticks out.
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(wide, `${where}: the page is wider than the screen`).toBeLessThanOrEqual(1);
  await expect(page.getByText("Something went wrong"), `${where}: an error page`).toHaveCount(0);
  await noteClipped(page, where);
}

/** A complete answer for one item, given through its card. */
async function answerItem(page: Page, card: Locator, type: Exercise["type"]) {
  const enabled = (l: Locator) => l.and(page.locator(":enabled"));
  switch (type) {
    case "single_choice":
    case "multi_choice":
      await card.locator("button[aria-pressed]").first().click();
      return;
    case "gap_text":
      for (const field of await card.getByRole("textbox").all()) await field.fill("a");
      return;
    case "dictation":
    case "respond":
      await card.locator("textarea").first().fill("a");
      return;
    case "gap_choice": {
      const selects = await card.getByRole("combobox").all();
      if (selects.length) {
        for (const select of selects) {
          await select.click();
          await page.getByRole("option").first().click();
        }
        return;
      }
      // A word bank: each tap fills the next empty gap.
      const words = enabled(card.locator("fieldset button"));
      while (await words.count()) await words.first().click();
      return;
    }
    case "match": {
      const slots = await card.getByRole("button", { name: /^Match for item/ }).all();
      for (const slot of slots) {
        await enabled(card.locator("fieldset button")).first().click();
        await slot.click();
      }
      return;
    }
    case "order": {
      // A part used stays in the pool, disabled.
      const pool = enabled(card.getByRole("group", { name: en.ex.chips }).getByRole("button"));
      while (await pool.count()) await pool.first().click();
      return;
    }
    case "speech_selfrate":
    case "speech_repeat": {
      const mic = card.getByRole("button", { name: en.speech.record });
      if (!(await mic.isEnabled())) return;
      await mic.click();
      await page.waitForTimeout(1200);
      await card.getByRole("button", { name: en.speech.stop }).click();
      return;
    }
    default:
      return;
  }
}

/** The step bar's main button (Check, Next, To the summary) and its Skip. */
const MAIN = [en.lesson.check, en.lesson.next, en.lesson.toSummary];
const bar = (page: Page) => ({
  main: page.getByRole("button", { name: new RegExp(`^(${MAIN.join("|")})$`) }).last(),
  skip: page.getByRole("button", { name: en.lesson.skip, exact: true }),
});

/** Moves on from the step shown: the main button once it can be pressed, else Skip. */
async function goOn(page: Page) {
  const before = page.url();
  const { main, skip } = bar(page);
  for (let tries = 0; tries < 3 && page.url() === before; tries++) {
    if (await main.isEnabled()) await main.click();
    else {
      await playAll(page);
      if (await main.isEnabled()) await main.click();
      else if (await skip.count()) await skip.click();
    }
    // Check turns into Next: press it too.
    if (
      page.url() === before &&
      (await main.textContent()) !== en.lesson.check &&
      (await main.isEnabled())
    )
      await main.click();
    await page.waitForTimeout(150);
  }
}

/** Walks the lesson from its overview to its summary; returns how many cards were rated. The words
 *  are gone through until none is left for now (each rated Good once), as the step asks. Each
 *  exercise is checked before moving on, its marks looked at whole too; with `shots` (a path's
 *  start) each checked exercise is kept as a full-page screenshot, to look at. */
export async function walkLesson(
  page: Page,
  url: string,
  exercises: Exercise[],
  { rate = 500, shots }: { rate?: number; shots?: string } = {},
) {
  await page.goto(url);
  await page.getByRole("button", { name: en.lesson.start }).click();
  let rated = 0;
  for (let guard = 0; guard < 200; guard++) {
    await page.waitForLoadState("networkidle");
    const step = new URL(page.url()).searchParams.get("step") ?? "";
    await expectWhole(page, step);
    if (step === "summary") break;
    if (step === "words")
      for (let i = 0; i < rate; i++) {
        const show = page.getByRole("button", { name: en.study.show });
        // The next card, if there is one now (it may take a moment after a rating).
        await show.waitFor({ timeout: 3000 }).catch(() => undefined);
        if (!(await show.count())) break;
        await show.click();
        await page.getByRole("button", { name: en.study.rating.good, exact: true }).click();
        rated++;
      }
    if (step.startsWith("exercise:")) {
      const exercise = exercises[Number(step.slice("exercise:".length))];
      await playAll(page);
      const cards = await page.locator("article ol > li").all();
      for (const card of cards) await answerItem(page, card, exercise?.type ?? "unknown");
      await expectWhole(page, `${step} answered`);
      const { main } = bar(page);
      if ((await main.textContent()) === en.lesson.check && (await main.isEnabled())) {
        await main.click();
        await page.waitForTimeout(300);
        await expectWhole(page, `${step} checked`);
        if (shots)
          await page.screenshot({
            path: `${shots}-${step.replace(":", "-")}.png`,
            fullPage: true,
          });
      }
    }
    await goOn(page);
  }
  return { rated };
}

/** A review session: up to `count` cards shown and rated Good in Review; returns how many. */
export async function reviewSome(page: Page, count: number) {
  await page.goto("/review");
  let rated = 0;
  for (; rated < count; rated++) {
    const show = page.getByRole("button", { name: en.study.show });
    await show.waitFor({ timeout: 3000 }).catch(() => undefined);
    if (!(await show.count())) break;
    await expectWhole(page, `review card ${rated + 1}`);
    await show.click();
    await page.getByRole("button", { name: en.study.rating.good, exact: true }).click();
  }
  return rated;
}

/** The lesson's page in the Notebook: its passes listed, one of them the walk; it opens whole. */
export async function notebookShows(page: Page, lessonPath: string) {
  await page.goto(`/notebook/${lessonPath}`);
  const passes = page.getByRole("heading", { name: en.notebook.passes });
  await expect(passes, "the Notebook lists the lesson's passes").toBeVisible();
  await expectWhole(page, "notebook");
  await passes.locator("xpath=following::button[1]").click();
  await expectWhole(page, "notebook pass");
}
