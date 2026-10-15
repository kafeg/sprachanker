// Exams on the fixture course's mini exam (two general questions, one of the learner's state; pass
// marks 2 and 3): the Exams section, the state chosen, a mock exam drawn, answered, handed in, its
// result and the Notebook; practice with each answer checked by Check, as in a lesson.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { put } from "./api.ts";

/** The run's list of questions: beside it on a wide screen, in the sheet its button opens on a phone
 *  (`done` closes the sheet again). */
async function withQuestions(page: Page, use: (list: Locator, column: Locator) => Promise<void>) {
  const open = page.getByRole("button", { name: "Questions", exact: true });
  // The page is there: the list beside the run, or its button on a phone.
  await open.or(page.locator("aside").getByRole("navigation")).first().waitFor();
  const phone = await open.isVisible();
  if (phone) await open.click();
  // The column: the phone's sheet, or the side beside the run.
  const column = phone ? page.getByRole("dialog") : page.locator("aside");
  await use(column.getByRole("navigation", { name: "Questions" }), column);
  if (phone && (await column.isVisible())) await page.keyboard.press("Escape");
}

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

/** The page's visible button of that name (the header and the bar below can both have one). */
const button = (page: Page, name: string | RegExp) =>
  page
    .getByRole("button", { name, exact: typeof name === "string" })
    .filter({ visible: true })
    .first();

/** The question on screen: its card (an example above it is answered already, not to be touched). */
const question = (page: Page) =>
  page
    .locator("main")
    .getByText(/^Question \d+ of \d+$/)
    .locator("..");

/** Answers the mini exam's question on screen rightly. */
async function answerRight(page: Page) {
  const main = page.locator("main");
  const text = (await main.textContent()) ?? "";
  if (text.includes("Wie viele Tage")) await main.getByRole("button", { name: "sieben" }).click();
  else if (text.includes("Tasse"))
    await main.locator("[role=button]:has(img[src*='tasse'])").click();
  else if (text.includes("Café")) await main.getByRole("button", { name: "rot" }).click();
  else await main.getByRole("button", { name: "Tee" }).click();
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

test("a mock exam: a question at a time, the grid above, nothing marked; handed in; the result, then the Notebook", async ({
  page,
}) => {
  await openExam(page);
  await page.getByRole("button", { name: /^Begin/ }).click();
  await expect(page).toHaveURL(/\/exam\/sprachanker\.fixture\/demo\/mini\/run\//);
  await withQuestions(page, (list) => expect(list.getByRole("button")).toHaveCount(3));
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    await expect(page.getByText(`Question ${i + 1} of 3`)).toBeVisible();
    seen.push((await page.locator("main").textContent()) ?? "");
    await answerRight(page);
    if (i < 2) await button(page, "Next").click();
  }
  // Berlin's question, not Bavaria's.
  expect(seen.some((t) => t.includes("Welche Farbe hat das Café im Bild?"))).toBe(true);
  expect(seen.some((t) => t.includes("Was trinkt Lena?"))).toBe(false);
  // Nothing is marked before the exam is handed in; the grid shows all answered.
  await expect(page.getByRole("status").filter({ hasText: /^Correct$/ })).toHaveCount(0);
  // Back to the first through the list (all answered there): its answer kept.
  await withQuestions(page, async (list, column) => {
    await expect(column.getByText("Answered: 3 of 3")).toBeVisible();
    await list.getByRole("button", { name: "Question 1" }).click();
  });
  await expect(page.getByText("Question 1 of 3")).toBeVisible();
  await expect(page.locator("main [role=button][aria-pressed='true']")).toHaveCount(1);
  await button(page, "Hand in").click();

  await expect(page.getByRole("heading", { name: "Passed" })).toBeVisible();
  // The points' share in the ring.
  await expect(page.getByRole("img", { name: "100%" })).toBeVisible();
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

test("practice: a question at a time, each checked with Check as in a lesson; ended early, scored over the answers given", async ({
  page,
}) => {
  await openExam(page);
  await page.getByRole("button", { name: "Practise" }).click();
  await expect(page).toHaveURL(/\/run\//);
  const main = page.locator("main");
  // The question is on screen (one of three drawn) before its text is read.
  await main
    .getByRole("button", { name: /fünf|blau/ })
    .or(main.locator("[role=button]:has(img[src*='kuchen'])"))
    .first()
    .waitFor();
  const text = (await main.textContent()) ?? "";
  const wrong = text.includes("Wie viele Tage")
    ? "fünf"
    : text.includes("Café")
      ? "blau"
      : undefined;
  if (wrong) await main.getByRole("button", { name: wrong }).click();
  else await main.locator("[role=button]:has(img[src*='kuchen'])").click();
  // Nothing checked until Check in the step bar, as in a lesson.
  await expect(main.getByRole("status").filter({ hasText: /^Wrong$/ })).toHaveCount(0);
  await button(page, "Check").click();
  // Checked: marked, the tally and the question wrong in the list.
  await expect(main.getByRole("status").filter({ hasText: /^Wrong$/ })).toBeAttached();
  await withQuestions(page, (_, column) =>
    expect(column.getByText(/0 right · 1 wrong/)).toBeVisible(),
  );
  await button(page, "End practice").click();
  await expect(page.getByRole("heading", { name: "0 of 1 answer right" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1 mistake" })).toBeVisible();
});

test("a language exam: a module alone, then the whole — each question with its Teil's material, recordings played as often as allowed, a result by module", async ({
  page,
  request,
}) => {
  // Without the assistant here: the speaking part is answered as any open answer (typed or said).
  await put(request, "/api/settings", { key: "llm.offIn", value: ["exam"] });
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
  await withQuestions(page, (_, column) =>
    expect(column.getByText("Model test · Reading")).toBeVisible(),
  );
  // The Teil's instructions and letter with every one of its questions.
  for (const [i, answer] of (["Falsch", "um drei Uhr", "b"] as const).entries()) {
    await expect(page.getByText(`Question ${i + 1} of 3`)).toBeVisible();
    if (i < 2) {
      await expect(page.getByText("Read the letter.")).toBeVisible();
      await expect(
        page.getByText("ich komme am Sonntag um drei Uhr ins Café.", { exact: false }),
      ).toBeVisible();
    }
    await question(page).getByRole("button", { name: answer, exact: true }).click();
    if (i < 2) await button(page, "Next").click();
  }
  await button(page, "Hand in").click();
  // On the exam's own scale: the module's scaled points, its tasks' points beside them.
  await expect(page.getByRole("heading", { name: "25 of 25" })).toBeVisible();
  const reading = page.getByText("Reading", { exact: true }).locator("..");
  await expect(reading).toContainText("25 of 25");
  await expect(reading).toContainText("tasks: 3 of 3");

  // The whole exam: Listening's example answered, a Teil's recording limited on every one of its
  // questions.
  await page.getByRole("button", { name: "To the exam" }).click();
  await page.getByRole("button", { name: "Whole exam" }).click();
  await page.getByRole("button", { name: /^Begin/ }).click();
  await withQuestions(page, (list) => expect(list.getByRole("button")).toHaveCount(10));
  await expect(page.getByRole("heading", { name: "Listening · Part 1" })).toBeVisible();
  await expect(page.getByText("Example")).toBeVisible();
  const answers: Array<(p: Page) => Promise<void>> = [
    (p) => question(p).locator("[role=button][aria-pressed]").first().click(),
    (p) => question(p).locator("[role=button][aria-pressed]").first().click(),
    (p) => question(p).getByRole("button", { name: "Richtig" }).click(),
    (p) => question(p).getByRole("button", { name: "Falsch" }).click(),
    (p) => question(p).getByRole("button", { name: "um drei Uhr" }).click(),
    (p) => question(p).getByRole("button", { name: "b", exact: true }).click(),
    (p) => question(p).getByRole("textbox").fill("Tom Weber"),
    (p) => question(p).getByRole("textbox").fill("Kaffee"),
    (p) =>
      question(p)
        .getByRole("textbox")
        .first()
        .fill("Lieber Tom, ich komme um drei und bringe Kuchen mit. Bis bald!"),
    // The speaking part: its card, the answer said aloud — here typed.
    async (p) => {
      await expect(p.getByText("Wochenende?")).toBeVisible();
      await question(p).getByRole("textbox").first().fill("Was machst du am Wochenende?");
    },
  ];
  for (const [i, answer] of answers.entries()) {
    await expect(page.getByText(`Question ${i + 1} of 10`)).toBeVisible();
    if (i === 2) {
      // Part 2's recording plays once.
      const once = page.getByRole("group", { name: "Part 2" });
      await expect(once).toContainText("1 of 1 plays left");
      await once.getByRole("button").click();
      await expect(once).toContainText("0 of 1 plays left");
      await expect(once.getByRole("button")).toBeDisabled();
    }
    await answer(page);
    if (i < answers.length - 1) await button(page, "Next").click();
  }
  await button(page, "Hand in").click();
  // The note and the speaking part not rated yet: under the writing mark, not passed.
  await expect(page.getByRole("heading", { name: "Not passed" })).toBeVisible();
  await expect(page.getByText("2 answers are not rated yet", { exact: false })).toBeVisible();
  await page
    .getByRole("group", { name: "The task" })
    .getByRole("button", { name: "4", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Language" })
    .getByRole("button", { name: "2", exact: true })
    .click();
  await expect(page.getByText("6 of 8", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save rating" }).last().click();
  await expect(page.getByText("1 answer is not rated yet", { exact: false })).toBeVisible();
  // Rated as the raters would: the result computed anew — passed.
  await page
    .getByRole("group", { name: "When you come" })
    .getByRole("button", { name: "3", exact: true })
    .click();
  await page
    .getByRole("group", { name: "What you bring" })
    .getByRole("button", { name: "1.5", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Greeting and closing" })
    .getByRole("button", { name: "1", exact: true })
    .click();
  await expect(page.getByText("5.5 of 7", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save rating" }).click();
  await expect(page.getByRole("heading", { name: "Passed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change rating" })).toHaveCount(2);
  await put(request, "/api/settings", { key: "llm.offIn", value: [] });
});

test("an exam removed from my exams: asked first, its runs gone, still downloaded", async ({
  page,
}) => {
  await page.goto("/exams");
  const cards = page.getByRole("button", { name: "Remove from my exams" });
  await expect(cards.first()).toBeVisible();
  const before = await cards.count();
  expect(before).toBeGreaterThan(0);
  await cards.first().click();
  await expect(page.getByRole("alertdialog")).toContainText("mock exams and practice are deleted");
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset" }).click();
  await expect(cards).toHaveCount(before - 1);
  await page.goto("/exams/downloaded");
  await expect(page.getByRole("link", { name: /Mini test|Model test/ }).first()).toBeVisible();
});

test("experimental exams: off until their section and source are turned on in Settings → General → Experimental; a source's ready ones shown always", async ({
  page,
  request,
}) => {
  await put(request, "/api/settings", { key: "experimental.on", value: [] });
  await page.goto("/exams/catalog");
  await expect(page.getByText("Leben in Deutschland").first()).toBeVisible();
  // Goethe's A1 is ready, its A2 and B1 experimental.
  await expect(page.getByText(/Goethe-Zertifikat A1/).first()).toBeVisible();
  await expect(page.getByText(/Goethe-Zertifikat (A2|B1)/)).toHaveCount(0);
  await page.goto("/settings#experimental");
  await expect(page.getByText("An experiment, not a way to prepare")).toBeVisible();
  const goethe = page.getByRole("checkbox", { name: /Goethe-Institut/ });
  await expect(goethe).toBeDisabled();
  // Each saved as it is ticked.
  const exams = page.getByRole("checkbox", { name: /^Exams/ });
  await exams.click();
  await expect(exams).toBeChecked();
  await goethe.click();
  await expect(goethe).toBeChecked();
  await page.goto("/exams/catalog");
  await expect(page.getByText(/Goethe-Zertifikat B1/).first()).toBeVisible();
  await put(request, "/api/settings", { key: "experimental.on", value: [] });
});
