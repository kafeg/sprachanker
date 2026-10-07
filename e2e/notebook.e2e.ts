// The Notebook: lessons worked on with their passes, two passes compared, a pass in full, an item's
// history across passes.
import { expect, test } from "@playwright/test";
import { answerPicture, DEMO_LESSON, freshLessonRun, openStep, post } from "./api.ts";

test("the Notebook: a lesson's passes, compared, one in full, an item across passes", async ({
  page,
  request,
}) => {
  // Only this test's passes (projects share the profile).
  const [series, course] = DEMO_LESSON.split("/");
  await post(request, "/api/progress/reset", { series, course, lesson: DEMO_LESSON });
  for (let pass = 0; pass < 2; pass++) {
    await freshLessonRun(request);
    await openStep(page, "Lena at the café");
    await page.getByRole("button", { name: "Im Café.", exact: true }).click();
    await answerPicture(page);
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByRole("button", { name: "Why is this wrong?" }).first()).toBeVisible();
  }

  await page.goto("/notebook");
  await expect(page.getByRole("heading", { name: "Notebook" })).toBeVisible();
  await expect(page.getByText("Study days")).toBeVisible();
  const lesson = page.getByRole("button", { name: /0\.1 Im Café/ });
  await expect(lesson).toContainText("2 passes");
  await lesson.click();

  // Two passes, newest first; both ticked and compared side by side.
  const boxes = page.getByRole("checkbox");
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByText("Lena at the café")).toBeVisible();
  await expect(page.getByText("Total")).toBeVisible();
  await page.getByRole("button", { name: "Passes" }).click();

  // A pass in full: the exercise unfolds to its items as answered, each with its history.
  await page
    .getByRole("listitem")
    .filter({ has: page.getByRole("checkbox") })
    .first()
    .getByRole("button")
    .click();
  const exercise = page.getByRole("button", { name: /Lena at the café/ });
  await exercise.click();
  await expect(exercise).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Item history" }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: /^Pass of/ })).toHaveCount(2);
});
