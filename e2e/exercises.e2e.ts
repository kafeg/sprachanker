// The exercise renderers in the player: answering by tap, drag and keyboard, and what each waits for.
import { expect, test } from "@playwright/test";
import { DEMO_LESSON, drag, fakeMicrophone, freshLessonRun, goToStep, openStep } from "./api.ts";
import { E2E_HEARD } from "./paths.ts";

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
  // The result is read out (the card shows it on its edge); the pool is gone.
  await expect(page.getByRole("status").filter({ hasText: /^Correct$/ })).toBeAttached();
  await expect(pool).toHaveCount(0);
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
  // The result is read out (the card shows it on its edge); the bank is gone.
  await expect(page.getByRole("status").filter({ hasText: /^Correct$/ })).toBeAttached();
  await expect(page.getByRole("group", { name: "Words to place" })).toHaveCount(0);
});

test("drop-down gaps: one tap opens each, card after card (the system's picker on a touch screen); a prompt both items share shown once", async ({
  page,
}, info) => {
  await openStep(page, "Herr or Frau?");
  await expect(page.getByText("Herr oder Frau?", { exact: true })).toHaveCount(1);
  const gaps = await page.locator("ol > li").getByRole("combobox", { name: "Gap 1" }).all();
  expect(gaps).toHaveLength(2);
  const touch = !!info.project.use.hasTouch;
  for (const [gap, word] of [
    [gaps[0], "Frau"],
    [gaps[1], "Herr"],
  ] as const) {
    if (!gap) throw new Error("no gap");
    if (touch) {
      expect(await gap.evaluate((e) => e.tagName)).toBe("SELECT");
      await gap.tap();
      await gap.selectOption({ label: word });
      await expect(gap.locator("option:checked")).toHaveText(word);
    } else {
      await gap.click();
      await page.getByRole("option", { name: word }).click();
      await expect(gap).toHaveText(word);
    }
  }
  // The next tap is not swallowed: Check checks at once.
  const check = page.getByRole("button", { name: "Check", exact: true });
  if (touch) await check.tap();
  else await check.click();
  await expect(page.getByRole("status").filter({ hasText: /^Correct$/ })).toHaveCount(2);
  // Checked: the choices as text with their marks, no lists left.
  await expect(page.locator("ol > li").getByRole("combobox")).toHaveCount(0);
});

test("choices: number keys answer the next item to answer; the answer spoken once checked; several choices count what is chosen", async ({
  page,
}) => {
  await openStep(page, "Lena at the café");
  const items = page.locator("ol > li");
  await page.keyboard.press("1");
  await expect(items.nth(0).locator("[role=button][aria-pressed=true]")).toHaveCount(1);
  // The first item is answered: the keys go on to the second.
  await page.keyboard.press("2");
  await expect(items.nth(1).locator("[role=button][aria-pressed=true]")).toHaveCount(1);
  await expect(items.nth(0).locator("[role=button][aria-pressed=true]")).toHaveCount(1);
  // The answer, spoken, is offered once checked: before, it would give it away.
  const hear = items.nth(0).getByRole("button", { name: "Hear the right answer" });
  await expect(hear).toHaveCount(0);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(hear).toHaveCount(1);

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
  // A gap grows with what is typed beyond the room its exercise gives.
  const before = await second.evaluate((e) => e.getBoundingClientRect().width);
  await second.pressSequentially("Milch mit Zucker");
  await expect
    .poll(() => second.evaluate((e) => e.getBoundingClientRect().width))
    .toBeGreaterThan(before);
  await second.fill("Milch");
  await second.press("Enter");
  // The result is read out (the card shows it on its edge).
  await expect(page.getByRole("status").filter({ hasText: /^Correct$/ })).toBeAttached();
});

test("speaking: listen first, then record oneself and play it back; the phrase shows after", async ({
  page,
}) => {
  await fakeMicrophone(page);
  await page.route("**/guten-tag.mp3", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav() }),
  );
  await openStep(page, "Repeat", SPEAKING_LESSON);
  const [withAudio, without] = [page.locator("ol > li").nth(0), page.locator("ol > li").nth(1)];
  const mic = withAudio.getByRole("button", { name: "Record yourself" });
  // The phrase is hidden until the first try; the microphone waits for the original.
  await expect(withAudio.getByRole("button", { name: "Show the text" })).toBeVisible();
  await expect(mic).toHaveAttribute("aria-disabled", "true");
  await expect(without.getByRole("button", { name: "Record yourself" })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  await withAudio.getByRole("button", { name: /^Play:/ }).click();
  await expect(mic).toHaveAttribute("aria-disabled", "false");
  await mic.click();
  const stop = withAudio.getByRole("button", { name: "Stop recording" });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(1200);
  await stop.click();
  await expect(withAudio.getByRole("button", { name: /^Mine · 0:0\d/ })).toBeVisible();
  await expect(withAudio.getByText("Guten Tag!")).toBeVisible();
  // Kept in the profile: Settings → General → Storage counts it.
  await page.goto("/settings#general");
  await expect(page.getByText(/^\d+ recordings? · /)).toBeVisible();
});

test("an answer said aloud checked against the source's answer as heard, without a model: wrong, its right answer, Try again, right", async ({
  page,
  request,
}) => {
  await fakeMicrophone(page);
  await page.route("**/wie-geht-es-dir.mp3", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav() }),
  );
  // Recognition on, as if a model were installed: what is "heard" is fixed, take by take.
  const said = ["Guten Abend! Wie geht es dir?", "Guten Abend, danke gut, und dir"];
  await page.route("**/api/speech", async (route) => {
    const state = await (await route.fetch()).json();
    await route.fulfill({ json: { ...state, recognition: true, model: "small-q5_1" } });
  });
  await page.route("**/api/speech/transcribe?*", (route) =>
    route.fulfill({ json: { text: said.shift() ?? "", ms: 5 } }),
  );
  await openStep(page, "Repeat", SPEAKING_LESSON);
  const card = page.locator("ol > li").nth(2);
  await card.getByRole("button", { name: /^Play:/ }).click();
  const say = async () => {
    await card.getByRole("button", { name: "Record yourself" }).click();
    await page.waitForTimeout(1200);
    await card.getByRole("button", { name: "Stop recording" }).click();
  };
  // The right answer only once the answer is checked.
  await expect(card.getByText("Correct answer:")).toHaveCount(0);
  await say();
  await expect(
    card.getByText("Not the answer asked for: compare with the right answer"),
  ).toBeVisible();
  await expect(card.getByText("Correct answer:")).toBeVisible();
  await expect(card.getByText(E2E_HEARD.text)).toBeVisible();
  await expect(card.getByRole("button", { name: "Hear the right answer" })).toBeVisible();
  // Try again sits in the step bar, as every exercise has it.
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await say();
  await expect(card.getByText("You said it")).toBeVisible();
  // The server's outcomes alike: the first take wrong (the step's mark), the second right.
  const res = await request.get(
    `/api/runs/lesson?series=sprachanker.fixture&lessonKey=${SPEAKING_LESSON}`,
  );
  const { state } = await res.json();
  const spoken = state.events
    .filter(
      (e: { type: string; itemKey?: string }) =>
        e.type === "answered" && e.itemKey?.endsWith("ex-02#3"),
    )
    .map((e: { payload: { outcome: { spoken?: string } } }) => e.payload.outcome.spoken);
  expect(spoken).toEqual(["wrong", "correct"]);
});
