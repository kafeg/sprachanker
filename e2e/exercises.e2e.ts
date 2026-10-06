// The exercise renderers in the player: answering by tap, drag and keyboard, and what each waits for.
import { expect, test } from "@playwright/test";
import { DEMO_LESSON, drag, freshLessonRun, goToStep, openStep } from "./api.ts";

const SPEAKING_LESSON = "sprachanker.fixture/demo/00-02";

test.beforeEach(async ({ request }) => {
  await freshLessonRun(request, DEMO_LESSON);
  await freshLessonRun(request, SPEAKING_LESSON);
});

/** A short silent WAV: a recording the browser can play (the fixture's are placeholders). */
function silentWav(seconds = 0.2, rate = 8000) {
  const samples = Math.round(seconds * rate);
  const buffer = Buffer.alloc(44 + samples);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return buffer;
}

test("order: parts are added by tapping and moved along the line by dragging", async ({ page }) => {
  await openStep(page, "Letters");
  const pool = page.getByRole("group", { name: "Words to place" });
  const line = page.getByRole("group", { name: "Your order" });
  for (const letter of ["T", "a", "e", "s", "s"])
    await pool
      .locator("button:enabled", { hasText: new RegExp(`^${letter}$`) })
      .first()
      .click();
  await expect(line.getByRole("button")).toHaveText(["T", "a", "e", "s", "s"]);
  await drag(page, line.getByRole("button", { name: "e" }), line.getByRole("button").last());
  await expect(line.getByRole("button")).toHaveText(["T", "a", "s", "s", "e"]);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByTitle("Correct")).toBeVisible();
});

test("word bank: a tapped gap takes the next word; a word can be dragged onto a gap", async ({
  page,
}) => {
  await openStep(page, "Introduce yourself");
  const gaps = page.getByRole("button", { name: /^Gap / });
  await gaps.nth(1).click();
  await page.getByRole("button", { name: "bestelle" }).click();
  await expect(gaps.nth(1)).toHaveText("bestelle");
  await drag(page, page.getByRole("button", { name: "heiße" }), gaps.first());
  await expect(gaps.first()).toHaveText("heiße");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByTitle("Correct")).toBeVisible();
});

test("choices: number keys answer the next item to answer; several choices count what is chosen", async ({
  page,
}) => {
  await openStep(page, "Lena at the café");
  const items = page.locator("ol > li");
  await page.keyboard.press("1");
  await expect(items.nth(0).locator("button[aria-pressed=true]")).toHaveCount(1);
  // The first item is answered: the keys go on to the second.
  await page.keyboard.press("2");
  await expect(items.nth(1).locator("button[aria-pressed=true]")).toHaveCount(1);
  await expect(items.nth(0).locator("button[aria-pressed=true]")).toHaveCount(1);

  await goToStep(page, "Tom's order");
  await page.keyboard.press("1");
  await page.keyboard.press("3");
  await expect(page.getByText("2 chosen")).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByText("1 chosen")).toBeVisible();
});

test("typed gaps: the letter row types at the cursor; Enter goes to the next gap, then checks", async ({
  page,
}) => {
  await openStep(page, "Ordering");
  const first = page.getByRole("textbox", { name: "Gap 1" });
  const second = page.getByRole("textbox", { name: "Gap 2" });
  await first.fill("M");
  await page.getByRole("button", { name: "ä", exact: true }).click();
  await expect(first).toHaveValue("Mä");
  await first.fill("Kaffee");
  await first.press("Enter");
  await expect(second).toBeFocused();
  // A gap grows with what is typed (its width tells nothing of the answer).
  const before = await second.evaluate((e) => e.getBoundingClientRect().width);
  await second.pressSequentially("Milch mit Zucker");
  expect(await second.evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(before);
  await second.fill("Milch");
  await second.press("Enter");
  await expect(page.getByTitle("Correct")).toBeVisible();
});

test("self-rating opens once the recording has been played", async ({ page }) => {
  await page.route("**/guten-tag.mp3", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav() }),
  );
  await openStep(page, "Repeat", SPEAKING_LESSON);
  const [withAudio, without] = [page.locator("ol > li").nth(0), page.locator("ol > li").nth(1)];
  await expect(withAudio.getByRole("button", { name: "Good" })).toBeDisabled();
  await expect(without.getByRole("button", { name: "Good" })).toBeEnabled();
  await withAudio.getByRole("button", { name: /^Play:/ }).click();
  await expect(withAudio.getByRole("button", { name: "Good" })).toBeEnabled();
});
