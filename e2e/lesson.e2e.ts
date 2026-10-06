import { expect, test } from "@playwright/test";
import { finishLessonRun } from "./api.ts";

test.beforeEach(({ request }) => finishLessonRun(request));

test("open the course, do an exercise, resume, finish with a summary", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My courses");
  await expect(page.getByRole("heading", { name: "Demo course" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Start|Continue lesson/ })).toBeVisible();
  // Other projects share the server's profile, so open lesson 1 directly (its run was just finished).
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

  const score = page.getByText(/Correct at first try/);
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  const next = page.getByRole("button", { name: /^(Next|To the summary)$/ });
  for (let i = 0; i < 12; i++) {
    await score.or(skip).or(next).first().waitFor();
    if (await score.isVisible()) break;
    await ((await skip.isVisible()) ? skip : next).click();
  }
  // The unanswered picture question is left out of the score, like a skipped one.
  await expect(page.getByText("Correct at first try: 1 of 1")).toBeVisible();
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
  await finishLessonRun(request, "sprachanker.fixture/demo/00-02");
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
