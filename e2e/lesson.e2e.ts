import { expect, test } from "@playwright/test";
import { answerPicture, freshLessonRun, goToStep, openStep } from "./api.ts";

test.beforeEach(({ request }) => freshLessonRun(request));

test("open the course, go through the words, the grammar and an exercise, resume, finish", async ({
  page,
}) => {
  await page.goto("/catalog");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All courses");
  await expect(page.getByRole("heading", { name: "Demo course" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Start|Continue lesson/ }).first()).toBeVisible();
  // Courses the providers offer but not downloaded here come with their size and "Download".
  await expect(page.getByRole("button", { name: /^Download · ≈/ }).first()).toBeVisible();
  // Other projects share the server's profile, so open lesson 1 directly (it was just started anew).
  await page.goto("/lesson/sprachanker.fixture/demo/00-01");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Im Café");
  await expect(page.getByText("order a drink")).toBeVisible();
  await page.getByRole("button", { name: "Start lesson" }).click();

  // The lesson's words (studied in their own test; skipped here), then the grammar page, then the
  // exercises.
  await expect(page.getByRole("button", { name: "Show answer" })).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Articles" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Exercise 1 of 8")).toBeVisible();
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
  // Check waits until every item is answered, and says so.
  await expect(page.getByRole("button", { name: "Check", exact: true })).toBeDisabled();
  await expect(page.getByText("Answer every item · 1 of 2")).toBeVisible();
  await answerPicture(page);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("Correct");
  await expect(page.getByRole("status").nth(1)).toContainText("Not quite");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Exercise 2 of 8")).toBeVisible();
  // The item's audio has a player; the fixture's audio is not real sound, so it says so.
  const player = page.getByRole("group", { name: "Was bestellt Tom?" });
  await expect(player).toContainText("The audio could not be loaded.");

  // Leaving and coming back resumes the run on the same page.
  await page.goto("/lesson/sprachanker.fixture/demo/00-01");
  await expect(page.getByText("Exercise 2 of 8")).toBeVisible();

  const score = page.getByText(/Correct on the first try/);
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  const next = page.getByRole("button", { name: /^(Next|To the summary)$/ });
  for (let i = 0; i < 12; i++) {
    await score.or(skip).or(next).first().waitFor();
    if (await score.isVisible()) break;
    await ((await skip.isVisible()) ? skip : next).click();
  }
  // One right; the wrong picture and the skipped checked items count as wrong. Every step is listed.
  await expect(page.getByText("Correct on the first try: 1 of 9")).toBeVisible();
  await expect(
    page.locator("section").getByRole("button", { name: /Cafés in Germany/ }),
  ).toBeVisible();
});

test.describe("with a German browser", () => {
  test.use({ locale: "de-DE" });
  test("the interface is German", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meine Kurse");
  });
});

test("client routes load the app", async ({ page }) => {
  await page.goto("/course/sprachanker.fixture/demo");
  await expect(page.getByRole("heading", { level: 2 }).first()).toContainText("Unit 0");
});

test("a free answer is checked and shows the model answers", async ({ page, request }) => {
  await freshLessonRun(request, "sprachanker.fixture/demo/00-02");
  await page.goto("/lesson/sprachanker.fixture/demo/00-02");
  await page.getByRole("button", { name: "Start lesson" }).click();
  const box = page.getByPlaceholder("Your answer…");
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  const next = page.getByRole("button", { name: "Next", exact: true });
  for (let i = 0; i < 8; i++) {
    await box.or(skip).or(next).first().waitFor();
    if (await box.isVisible()) break;
    await ((await skip.isVisible()) ? skip : next).click();
  }
  await box.fill("Einen Kaffee, bitte.");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("Model answers")).toBeVisible();
  await expect(page.getByText("Ich hätte gern einen Tee.")).toBeVisible();
});

test("answers and skips are kept: reopening shows them", async ({ page, request }) => {
  await freshLessonRun(request);
  await openStep(page, "Lena at the café");
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
  await answerPicture(page);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Exercise 2 of 8")).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByText("Exercise 3 of 8")).toBeVisible();

  // After a reload the run resumes where it was; going back shows the checked answers.
  await page.reload();
  await expect(page.getByText("Exercise 3 of 8")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText("Exercise 1 of 8")).toBeVisible();
  await expect(page.getByRole("status").first()).toContainText("Correct");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("the summary before the end lists what is left and does not complete the lesson", async ({
  page,
  request,
}) => {
  await freshLessonRun(request);
  await openStep(page, "Lena at the café");
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
  await answerPicture(page);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await goToStep(page, "Summary");
  // The words, the grammar, seven exercises, the culture page (and AI practice, when the shared profile
  // has an assistant) are left.
  await expect(page.getByText(/^\d+ steps are still to do\.$/)).toBeVisible();
  await expect(page.getByText(/Correct on the first try/)).toBeHidden();
  await page.getByRole("button", { name: "Go to: Words of the lesson · 4" }).click();
  await expect(
    page
      .getByRole("heading", { name: "Words of the lesson" })
      .or(page.getByText("Words of the lesson", { exact: true }))
      .first(),
  ).toBeVisible();
  // Still the same run: after a reload the lesson resumes at the first step left.
  await page.reload();
  await expect(page).toHaveTitle("SprachAnker · Words");
});

test("resetting a lesson asks first and leaves it not started", async ({ page, request }) => {
  await freshLessonRun(request);
  await openStep(page, "Lena at the café");
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
  await answerPicture(page);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await goToStep(page, "Overview");
  await page.getByRole("button", { name: "Reset lesson progress" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("cannot be undone");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Reset lesson progress" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("button", { name: "Start lesson" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset lesson progress" })).toBeHidden();
});

test("matching: words are placed by tapping a word and then a place; Check waits for all", async ({
  page,
  request,
}) => {
  await freshLessonRun(request);
  await page.goto("/lesson/sprachanker.fixture/demo/00-01");
  await page.getByRole("button", { name: "Start lesson" }).click();
  const plan = page.getByRole("button", { name: "Lesson plan" });
  if (await plan.isVisible()) await plan.click();
  await page.getByRole("button", { name: "What is it?" }).click();
  const check = page.getByRole("button", { name: "Check", exact: true });
  const slots = page.getByRole("button", { name: /^Match for item/ });
  await page.getByRole("button", { name: "die Tasse" }).click();
  await slots.first().click();
  await expect(slots.first()).toContainText("die Tasse");
  await expect(check).toBeDisabled();
  await page.getByRole("button", { name: "der Kuchen" }).click();
  await slots.nth(1).click();
  await check.click();
  await expect(page.getByRole("status").first()).toBeVisible();
});

test("the window title says where you are", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveTitle("SprachAnker · Settings");
  await openStep(page, "Letters");
  await expect(page).toHaveTitle("SprachAnker · Ex 5/8");
  await goToStep(page, "Summary");
  await expect(page).toHaveTitle("SprachAnker · Summary");
});

test("words: studied as in Anki — the card plays itself, Show answer, ratings with intervals, undo", async ({
  page,
}) => {
  // Cards are shared by the projects' profile: the test takes its rating back, so they stay new.
  const played = page.waitForRequest(/kaffee\.mp3$/);
  await openStep(page, "Words of the lesson · 4");
  // The question: the word, its recording playing by itself; the counts new + learning + review.
  await expect(page.getByText("der Kaffee, die Kaffees")).toBeVisible();
  await played;
  await expect(page.getByText("coffee")).toBeHidden();
  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.getByText("coffee")).toBeVisible();
  // A new card's learning steps: 1m, 6m, 10m.
  for (const [name, interval] of [
    ["Again", "<1m"],
    ["Hard", "<6m"],
    ["Good", "<10m"],
  ] as const)
    await expect(page.getByRole("button", { name, exact: true })).toContainText(interval);
  await page.keyboard.press("3");
  await expect(page.getByText("die Tasse, die Tassen")).toBeVisible();
  await page.keyboard.press("u");
  await expect(page.getByText("der Kaffee, die Kaffees")).toBeVisible();
  await expect(page.getByText("coffee")).toBeHidden();
});
