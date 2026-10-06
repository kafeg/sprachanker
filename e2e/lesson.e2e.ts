import { expect, test } from "@playwright/test";
import { freshLessonRun } from "./api.ts";

test.beforeEach(({ request }) => freshLessonRun(request));

test("open the course, do an exercise, resume, finish with a summary", async ({ page }) => {
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

  await expect(page.getByText("Exercise 1 of 8")).toBeVisible();
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
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
  // One right; the unanswered picture question and the skipped checked items count as wrong.
  await expect(page.getByText("Correct on the first try: 1 of 9")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New words of this lesson" })).toBeVisible();
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
  await page.goto("/lesson/sprachanker.fixture/demo/00-01");
  await page.getByRole("button", { name: "Start lesson" }).click();
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
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
  await page.goto("/lesson/sprachanker.fixture/demo/00-01");
  await page.getByRole("button", { name: "Start lesson" }).click();
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  const plan = page.getByRole("button", { name: "Lesson plan" });
  if (await plan.isVisible()) await plan.click();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await expect(page.getByText(/7 exercises are left/)).toBeVisible();
  await expect(page.getByText(/Correct on the first try/)).toBeHidden();
  await page.getByRole("button", { name: "Go to exercise 2" }).click();
  await expect(page.getByText("Exercise 2 of 8")).toBeVisible();
  // Still the same run: after a reload the lesson resumes instead of showing a finished run.
  await page.reload();
  await expect(page.getByText("Exercise 2 of 8")).toBeVisible();
});

test("resetting a lesson asks first and leaves it not started", async ({ page, request }) => {
  await freshLessonRun(request);
  await page.goto("/lesson/sprachanker.fixture/demo/00-01");
  await page.getByRole("button", { name: "Start lesson" }).click();
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
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
