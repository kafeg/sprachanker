// Exams on the fixture course's mini exam (two general questions, one of the learner's state; pass
// marks 2 and 3): the Exams section, the state chosen, a mock exam drawn, answered, handed in, its
// result and the Notebook; practice with each answer checked at once.
import { expect, type Page, test } from "@playwright/test";

/** A quarter second of silence as a WAV (8 kHz, 8-bit mono): a recording a browser plays to its end
 *  (the fixture's media are markers, not sound). */
function silence(): Buffer {
  const samples = 2000;
  const b = Buffer.alloc(44 + samples, 0x80);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + samples, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples, 40);
  return b;
}

/** The right option of each of the mini exam's questions, by what it asks. */
async function answerRight(page: Page) {
  const items = page.getByRole("list", { name: "Items" }).locator(":scope > li");
  for (const item of await items.all()) {
    const text = (await item.textContent()) ?? "";
    if (text.includes("Wie viele Tage")) await item.getByRole("button", { name: "sieben" }).click();
    else if (text.includes("Tasse")) await item.locator("button:has(img[src*='tasse'])").click();
    else if (text.includes("Café")) await item.getByRole("button", { name: "rot" }).click();
    else await item.getByRole("button", { name: "Tee" }).click();
  }
}

async function openExam(page: Page) {
  await page.goto("/exams/downloaded");
  await expect(page.getByRole("heading", { name: "Exams" })).toBeVisible();
  await page.getByRole("link", { name: /Mini test/ }).click();
  await expect(page.getByRole("heading", { name: "Mini test" })).toBeVisible();
  // The state its questions are asked of.
  await page.getByRole("combobox", { name: "Federal state" }).click();
  await page.getByRole("option", { name: "Berlin" }).click();
  await expect(page.getByRole("combobox", { name: "Federal state" })).toHaveText("Berlin");
}

test("a mock exam: drawn for the state, answered without marks, handed in; the result, then the Notebook", async ({
  page,
}) => {
  await openExam(page);
  await page.getByRole("button", { name: /^Begin/ }).click();
  await expect(page).toHaveURL(/\/exam\/sprachanker\.fixture\/demo\/mini\/run\//);
  const items = page.getByRole("list", { name: "Items" }).locator(":scope > li");
  await expect(items).toHaveCount(3);
  // Berlin's question, not Bavaria's.
  await expect(page.getByText("Welche Farbe hat das Café im Bild?")).toBeVisible();
  await expect(page.getByText("Was trinkt Lena?")).toHaveCount(0);
  await answerRight(page);
  // Nothing is marked before the exam is handed in.
  await expect(page.getByRole("status").filter({ hasText: /^Correct$/ })).toHaveCount(0);
  await expect(page.getByText("Answered: 3 of 3").filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Hand in" }).filter({ visible: true }).click();

  await expect(page.getByRole("heading", { name: "Passed" })).toBeVisible();
  await expect(page.getByRole("img", { name: "3/3" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No mistakes" })).toBeVisible();
  await page.getByRole("button", { name: "Show all answers" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Correct$/ })).toHaveCount(3);
  // Nothing wider than the screen.
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(wide).toBeLessThanOrEqual(1);

  await page.goto("/notebook");
  await expect(page.getByRole("heading", { name: "Exams" })).toBeVisible();
  await expect(page.getByRole("button", { name: /3 of 3\s*Passed/ }).first()).toBeVisible();
});

test("practice: each answer checked at once; handed in early, scored over the answers given", async ({
  page,
}) => {
  await openExam(page);
  await page.getByRole("button", { name: "Practise" }).click();
  await expect(page).toHaveURL(/\/run\//);
  const first = page.getByRole("list", { name: "Items" }).locator(":scope > li").first();
  const wrong = (await first.textContent())?.includes("Wie viele Tage")
    ? "fünf"
    : (await first.textContent())?.includes("Café")
      ? "blau"
      : undefined;
  if (wrong) await first.getByRole("button", { name: wrong }).click();
  else await first.locator("button:has(img[src*='kuchen'])").click();
  // Checked at once: marked, the right answer shown.
  await expect(first.getByRole("status").filter({ hasText: /^Not quite$/ })).toBeAttached();
  await page.getByRole("button", { name: "End practice" }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "0 of 1 answer right" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1 mistake" })).toBeVisible();
});

test("a language exam: a module alone, then the whole — Teile with their material, recordings played as often as allowed, a result by module", async ({
  page,
}) => {
  await page.route("**/media/audio/*.mp3", (route) =>
    route.fulfill({ body: silence(), contentType: "audio/wav" }),
  );
  await page.goto("/exams/downloaded");
  await page.getByRole("link", { name: /Model test/ }).click();
  await expect(page.getByRole("heading", { name: "Model test" })).toBeVisible();

  // Reading alone: its three questions in 3 minutes, judged by no mark of its own.
  await page.getByRole("button", { name: "Reading" }).click();
  await expect(page.getByText("3 questions in 3 minutes", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /^Begin/ }).click();
  await expect(page).toHaveURL(/\/run\//);
  await expect(page.getByRole("heading", { name: "Model test · Reading" })).toBeVisible();
  await expect(page.getByText("Read the letter.")).toBeVisible();
  await expect(
    page.getByText("ich komme am Sonntag um drei Uhr ins Café.", { exact: false }),
  ).toBeVisible();
  const items = page.getByRole("list", { name: "Items" }).locator(":scope > li");
  await expect(items).toHaveCount(3);
  await items.nth(0).getByRole("button", { name: "Falsch" }).click();
  await items.nth(1).getByRole("button", { name: "um drei Uhr" }).click();
  await items.nth(2).getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: "Hand in" }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "3 of 3" })).toBeVisible();
  await expect(page.getByText("Reading", { exact: true }).locator("..")).toContainText("25 of 25");

  // The whole exam: Listening's example answered, its recordings limited.
  await page.getByRole("button", { name: "To the exam" }).click();
  await page.getByRole("button", { name: "Whole exam" }).click();
  await page.getByRole("button", { name: /^Begin/ }).click();
  await expect(page.getByRole("heading", { name: "Listening" })).toBeVisible();
  await expect(page.getByText("Example")).toBeVisible();
  const once = page.getByRole("group", { name: "Part 2" });
  await expect(once).toContainText("1 of 1 plays left");
  await once.getByRole("button").click();
  await expect(once).toContainText("0 of 1 plays left");
  await expect(once.getByRole("button")).toBeDisabled();
  const all = page.getByRole("list", { name: "Items" }).locator(":scope > li");
  await expect(all).toHaveCount(8);
  // The first answer of each (the example above the first is answered already, not to be touched).
  for (const i of [0, 1])
    await all.nth(i).locator("button[aria-pressed]:not([disabled])").first().click();
  await all.nth(2).getByRole("button", { name: "Richtig" }).click();
  await all.nth(3).getByRole("button", { name: "Falsch" }).click();
  await all.nth(4).getByRole("button", { name: "um drei Uhr" }).click();
  await all.nth(5).getByRole("button", { name: "b", exact: true }).click();
  await all.nth(6).getByRole("textbox").fill("Tom Weber");
  await all.nth(7).getByRole("textbox").fill("Kaffee");
  await page.getByRole("button", { name: "Hand in" }).filter({ visible: true }).click();
  // Writing, every mark: passed.
  await expect(page.getByRole("heading", { name: "Passed" })).toBeVisible();
  await expect(page.getByText("Writing", { exact: true }).locator("..")).toContainText("25 of 25");
});
