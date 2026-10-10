// Exams on the fixture course's mini exam (two general questions, one of the learner's state; pass
// marks 2 and 3): the Exams section, the state chosen, a mock exam drawn, answered, handed in, its
// result and the Notebook; practice with each answer checked at once.
import { expect, type Page, test } from "@playwright/test";

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
