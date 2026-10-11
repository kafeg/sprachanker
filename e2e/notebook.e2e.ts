// The Notebook: progress and the study days (today's lesson work in the calendar), lessons worked on
// with their passes, two passes compared, a pass in full, an item's history across passes; its
// pictures over a span, a deck's words by state and a review day opening its answers.
import { expect, test } from "@playwright/test";
import { answerPicture, DEMO_LESSON, freshLessonRun, openStep, post } from "./api.ts";

test("the Notebook's pictures: cards answered, time spent, a deck's words by state; today's review day opens its answers", async ({
  page,
  request,
}) => {
  // The demo course's words as cards; two of them answered in Review (they stay: the Notebook shows them).
  await post(request, "/api/cards/lesson", {
    series: "sprachanker.fixture",
    lessonKey: DEMO_LESSON,
    edition: "en-de",
  });
  await page.goto("/review/decks");
  await page.getByRole("button", { name: "Demo course", exact: true }).click();
  await expect(page.getByText("Studying: Demo course")).toBeVisible();
  const show = page.getByRole("button", { name: "Show answer" });
  for (const rating of ["Again", "Good"]) {
    await show.click();
    await page.getByRole("button", { name: rating, exact: true }).click();
    await expect(show).toBeVisible();
  }

  await page.goto("/notebook");
  await expect(page.getByRole("heading", { name: "Notebook" })).toBeVisible();
  // Time spent: the cards' answers were timed.
  await expect(page.getByRole("img", { name: "Time spent" })).toBeVisible();
  const time = page.locator("p", { hasText: /^Time spent$/ }).locator("xpath=..");
  await expect(time).not.toContainText("—");
  // Review's section: the cards answered and the share remembered over the span, the deck's words.
  await expect(page.getByRole("img", { name: "Cards answered" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Remembered/ })).toBeVisible();
  await expect(
    page.getByRole("img", { name: /^Words by state: New \d+, Learning [1-9]/ }),
  ).toBeVisible();
  // The last 7 days: a bar a day.
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByText(/by day/).first()).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Cards answered" }).locator(":scope > div"),
  ).toHaveCount(7);

  // Today's review day, with its answers, opens its page: each answer with its rating and its time.
  await page
    .getByRole("button", { name: /\d+ answers?$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/notebook\/review\/[0-9A-Z]{26}\?lang=de$/);
  await expect(page.getByRole("heading", { name: /^Review of / })).toBeVisible();
  const answers = page.getByRole("main").getByRole("listitem");
  await expect(answers.filter({ hasText: "Again" }).first()).toBeVisible();
  await expect(answers.filter({ hasText: "Good" }).first()).toBeVisible();
  await expect(answers.last()).toContainText(/\d+ sec/);
  await expect(page.getByRole("button", { name: "Later day" })).toBeDisabled();
  await page.getByRole("button", { name: "Notebook" }).click();
  await expect(page).toHaveURL(/\/notebook$/);
});

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

  // In the lesson too: a checked item's earlier attempts, in every pass.
  await page.getByRole("button", { name: "Item history" }).first().click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /^Pass of/ })).toHaveCount(2);
  await page.keyboard.press("Escape");

  await page.goto("/notebook");
  await expect(page.getByRole("heading", { name: "Notebook" })).toBeVisible();
  await expect(page.getByText("Words known")).toBeVisible();
  await expect(page.getByRole("img", { name: "Study days over the last year" })).toBeVisible();
  // Today is the calendar's last day, in sight on a phone too, and holds the lesson work.
  await expect(page.getByTitle(/: lessons \d+/).last()).toBeInViewport();
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByText("Answers and steps").locator("..")).not.toContainText(/^0/);
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
