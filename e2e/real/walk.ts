/// <reference lib="dom" />
// Walking a lesson through as a learner does, by its screens only: the words
// rated, the reading pages read, every exercise answered and checked (any complete answer — what is
// checked is that it is stored as the engine marks it), speaking items recorded with the browser's fake
// microphone, and the summary reached. An exercise it could not answer fails the lesson (`unanswered`);
// a speaking item that cannot be recorded here by design (it needs recognition, off) is only listed
// (`blocked`). With `REAL_SHOTS` each checked exercise, reading page and the words step is kept.
// After each step: nothing past the screen's width, no error page.
import { readFileSync } from "node:fs";
import { type CDPSession, expect, type Locator, type Page } from "@playwright/test";
import type { Exercise } from "@sprachanker/schema";

/** The interface language of the run (`REAL_UI`, English by default) and its labels, which the
 *  screens are found by. */
export const UI = process.env.REAL_UI ?? "en";
const en = JSON.parse(
  readFileSync(new URL(`../../apps/web/src/i18n/${UI}.json`, import.meta.url), "utf8"),
);
/** A label's text before its first ICU argument ("Match for item {n}" → "Match for item"). */
const labelStart = (message: string) => message.split("{")[0]?.trim() ?? message;

/** Recordings play muted, one after another as the app plays them: playing is what counts as heard
 * . */
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

/** Exercises the walk could not answer completely (Check stayed disabled; it went on with Skip): each
 *  test fails on them once its lesson is walked through. */
export const unanswered: string[] = [];

/** Speaking items the walk left by design: their microphone waits for speech recognition, which the
 *  run has not (listed at the end, no failure). */
export const blocked: string[] = [];

/** The screen is whole: nothing wider than it, no error page. */
export async function expectWhole(page: Page, where: string) {
  // The layout's width, not the window's: a phone's window grows with content that sticks out.
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(wide, `${where}: the page is wider than the screen`).toBeLessThanOrEqual(1);
  const failed = new RegExp(labelStart(en.error.other).replace(/[:.]$/, ""), "i");
  await expect(page.getByText(failed), `${where}: an error page`).toHaveCount(0);
  await noteClipped(page, where);
}

/** A complete answer for one item, given through its card; false when it could not be given,
 *  "blocked" when the app holds it back by design (a phrase to say needs recognition). */
async function answerItem(
  page: Page,
  card: Locator,
  type: Exercise["type"],
): Promise<boolean | "blocked"> {
  const enabled = (l: Locator) => l.and(page.locator(":enabled"));
  switch (type) {
    case "single_choice":
    case "multi_choice":
      await card.locator("button[aria-pressed]").first().click();
      return true;
    case "gap_text":
      for (const field of await card.getByRole("textbox").all()) await field.fill("a");
      return true;
    case "dictation":
    case "respond":
      await card.locator("textarea").first().fill("a");
      return true;
    case "gap_choice": {
      const selects = await card.getByRole("combobox").all();
      if (selects.length) {
        for (const select of selects) {
          // A touch screen's is the system's picker (a native select), a mouse's the app's list.
          if ((await select.evaluate((e) => e.tagName)) === "SELECT") {
            await select.selectOption({ index: 1 });
          } else {
            // The list closed before the next one is opened (it fades out: a click meanwhile is
            // the closing list's).
            const list = page.getByRole("listbox");
            await select.click();
            await list.getByRole("option").first().click();
            await expect(list).toHaveCount(0);
          }
        }
        return true;
      }
      // A word bank: each tap fills the next empty gap.
      const words = enabled(card.locator("fieldset button"));
      while (await words.count()) await words.first().click();
      return true;
    }
    case "match": {
      const slots = await card
        .getByRole("button", { name: new RegExp(`^${labelStart(en.ex.matchFor)}`) })
        .all();
      for (const slot of slots) {
        await enabled(card.locator("fieldset button")).first().click();
        await slot.click();
      }
      return true;
    }
    case "order": {
      // A part used stays in the pool, disabled.
      const pool = enabled(card.getByRole("group", { name: en.ex.chips }).getByRole("button"));
      while (await pool.count()) await pool.first().click();
      return true;
    }
    case "speech_selfrate":
    case "speech_repeat": {
      const mic = card.getByRole("button", { name: en.speech.record });
      if (!(await mic.isEnabled()))
        return (await card.getByText(en.speech.needsRecognition).count()) ? "blocked" : false;
      await mic.click();
      await page.waitForTimeout(1200);
      await card.getByRole("button", { name: en.speech.stop }).click();
      // The take is kept once the recorder has stopped (a moment): the microphone is back.
      await expect(mic, "the microphone back after a take").toBeVisible();
      return true;
    }
    default:
      return true;
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

const touchSessions = new WeakMap<Page, CDPSession>();

/** A full-page screenshot. Chromium drops a phone's touch emulation taking one of a tall page (the
 *  pointer turns fine, no touch points): it is turned on again, so the walk goes on as on a phone. */
async function shoot(page: Page, path: string) {
  const touch = (await page.evaluate("navigator.maxTouchPoints")) as number;
  await page.screenshot({ path, fullPage: true });
  if (!touch || (await page.evaluate("navigator.maxTouchPoints"))) return;
  // The session stays open: closing it would drop the emulation again.
  let cdp = touchSessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    touchSessions.set(page, cdp);
  }
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: touch });
}

/** Walks the lesson from its overview to its summary; returns how many cards were rated. The words
 *  are gone through until none is left for now (each rated Good once), as the step asks. Each
 *  exercise is checked before moving on, its marks looked at whole too; with `shots` (a path's
 *  start) each exercise checked (or answered, where nothing is checked) is kept as a full-page
 *  screenshot, to look at. */
export async function walkLesson(
  page: Page,
  url: string,
  exercises: Exercise[],
  { rate = 500, shots }: { rate?: number; shots?: string } = {},
) {
  await page.goto(url);
  await page.getByRole("button", { name: en.lesson.start }).click();
  let rated = 0;
  const shot = new Set<string>();
  for (let guard = 0; guard < 200; guard++) {
    await page.waitForLoadState("networkidle");
    const step = new URL(page.url()).searchParams.get("step") ?? "";
    await expectWhole(page, step);
    // Reading pages and the words (their first card) kept too, once each.
    if (shots && step && !step.startsWith("exercise:") && !shot.has(step)) {
      shot.add(step);
      if (step === "words")
        await page
          .getByRole("button", { name: en.study.show })
          .waitFor({ timeout: 3000 })
          .catch(() => undefined);
      await shoot(page, `${shots}-${step.replace(/\W+/g, "-")}.png`);
    }
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
      // The items' own list (an exercise's text may hold lists too).
      const cards = await page
        .getByRole("list", { name: en.lesson.itemsList, exact: true })
        .locator(":scope > li")
        .all();
      let held = false;
      for (const [i, card] of cards.entries()) {
        const done = await answerItem(page, card, exercise?.type ?? "unknown");
        const where = `${url} ${step} (${exercise?.type}): item ${i + 1}`;
        if (done === "blocked") {
          blocked.push(`${where} needs speech recognition`);
          held = true;
        } else if (!done) unanswered.push(`${where} not answered`);
      }
      await expectWhole(page, `${step} answered`);
      const { main } = bar(page);
      if ((await main.textContent()) === en.lesson.check) {
        if (!(await main.isEnabled())) await playAll(page);
        if (await main.isEnabled()) {
          await main.click();
          await page.waitForTimeout(300);
          await expectWhole(page, `${step} checked`);
        } else {
          // What the bar says it waits for ("Answer every item · 1 of 4").
          const notes = [en.lesson.answerAll, en.lesson.listenFirst, en.lesson.listenItem].map(
            (m: string) => labelStart(m).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          );
          const waits = await page
            .getByText(new RegExp(`^(${notes.join("|")})`))
            .first()
            .textContent({ timeout: 1000 })
            .catch(() => null);
          // An item held back by design is listed already (`blocked`).
          if (!held)
            unanswered.push(
              `${url} ${step} (${exercise?.type}): ${waits ?? "Check stays disabled"}`,
            );
        }
      }
      // Checked, or answered where nothing is checked (speaking).
      if (shots) {
        // No hover left on what the last tap was over; transitions (colours, the blur) ended.
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        await shoot(page, `${shots}-${step.replace(":", "-")}.png`);
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
