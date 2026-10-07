// The AI screens against the fake model (fake-llm.ts): "Why is this wrong?", the tutor, a writing check,
// going over mistakes.
import { expect, test } from "@playwright/test";
import {
  answerPicture,
  DEMO_LESSON,
  freshLessonRun,
  goToStep,
  openStep,
  post,
  put,
} from "./api.ts";
import { FAKE_LLM_PORT, FAKE_TEXT } from "./fake-llm.ts";

test.beforeEach(async ({ request }) => {
  await put(request, "/api/llm/providers/custom", {
    baseUrl: `http://127.0.0.1:${FAKE_LLM_PORT}/v1`,
  });
  await put(request, "/api/llm/route", { provider: "custom", model: "fake-model" });
  await freshLessonRun(request);
});

test("explain a mistake, ask the tutor, check a text", async ({ page, request }) => {
  await openStep(page, "Lena at the café");

  // The picture answered wrong: its explanation streams from the model.
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
  await answerPicture(page);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await page.getByRole("button", { name: "Why is this wrong?" }).first().click();
  await expect(page.getByText(FAKE_TEXT).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Explain again" })).toBeVisible();

  // The explanation is kept with the answer: after a reload it is shown without asking the model.
  let asked = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/llm/explain")) asked++;
  });
  await page.reload();
  await goToStep(page, "Lena at the café");
  await page.getByRole("button", { name: "Why is this wrong?" }).first().click();
  await expect(page.getByText(FAKE_TEXT).first()).toBeVisible();
  expect(asked).toBe(0);

  await page.getByRole("button", { name: "Tutor" }).click();
  await page.getByPlaceholder("Ask a question…").fill("Was heißt das?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  // The chat keeps earlier turns (projects share the profile): the newest reply is the last one.
  await expect(page.getByRole("dialog").getByText(FAKE_TEXT).last()).toBeVisible();
  await page.keyboard.press("Escape");

  // With an assistant the plan has the AI practice steps.
  await goToStep(page, "Write it yourself");
  const writing = page.getByPlaceholder("Your text…");
  await writing.fill("Ich heisse Lena.");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("FAKE: a good start.")).toBeVisible();
  await expect(page.getByText("FAKE: ß after a long vowel.")).toBeVisible();
  // A checked text marks the writing step done in the run (the event goes out from a queue).
  const steps = async () => {
    const res = await request.get(
      `/api/runs/lesson?series=sprachanker.fixture&lessonKey=${DEMO_LESSON}`,
    );
    const { state } = await res.json();
    return state.events
      .filter((e: { type: string }) => e.type === "step_done")
      .map((e: { payload: { step: string } }) => e.payload.step);
  };
  await expect.poll(steps).toContain("writing");

  // "Going over mistakes": the run counted by the app, its mistakes by exercise (a row opens the
  // exercise); then the tutor goes through them inline, in a new chat without the earlier question,
  // and its first reply marks the step done.
  await goToStep(page, "Going over mistakes");
  const step = page.locator("article");
  await expect(step.getByText("Mistakes by exercise")).toBeVisible();
  await expect(step.getByRole("button", { name: /Lena at the café/ })).toContainText("item 2");
  await step.getByRole("button", { name: "Go through my mistakes with the tutor" }).click();
  await expect(step.getByText("Please go through my mistakes in this lesson.")).toBeVisible();
  await expect(step.getByText(FAKE_TEXT).last()).toBeVisible();
  await expect(step.getByText("Was heißt das?")).toBeHidden();
  await expect.poll(steps).toContain("mistakes");
  // The walk-through goes on in the step: a follow-up is answered in the same chat.
  await step.getByPlaceholder("Ask a question…").fill("Noch ein Beispiel?");
  await step.getByRole("button", { name: "Send", exact: true }).click();
  await expect(step.getByText("Noch ein Beispiel?")).toBeVisible();
  // Back on the step later, the chat is there at once.
  await goToStep(page, "Write it yourself");
  await goToStep(page, "Going over mistakes");
  await expect(step.getByText("Noch ein Beispiel?")).toBeVisible();
});

test("a scene on its step page; a new one keeps the earlier one readable", async ({
  page,
  request,
}) => {
  // No scenes of the lesson left from earlier tests (projects share the profile).
  const [series, course] = DEMO_LESSON.split("/");
  await post(request, "/api/progress/reset", { series, course, lesson: DEMO_LESSON });
  await openStep(page, "Scene");
  const step = page.locator("article");
  await step.getByRole("button", { name: "Start a scene" }).click();
  await expect(step.getByRole("heading", { name: "FAKE: Im Café" })).toBeVisible();
  await expect(step.getByText("FAKE: Guten Tag! Was möchten Sie?")).toBeVisible();

  // A line: the partner answers, the mistake in the line is corrected, the goal is ticked off.
  await step.getByPlaceholder("Your line…").fill("Einen Kaffe, bitte.");
  await step.getByRole("button", { name: "Send", exact: true }).click();
  await expect(step.getByText("FAKE: Gern. Sonst noch etwas?")).toBeVisible();
  await expect(step.getByText("FAKE: double e.")).toBeVisible();
  await expect(step.getByRole("listitem").filter({ hasText: "Order a coffee" })).toHaveClass(
    /text-correct/,
  );
  await step.getByRole("button", { name: "Translation" }).last().click();
  await expect(step.getByText("FAKE: Sure. Anything else?")).toBeVisible();

  // A new scene: the earlier one is listed under it with its goals and opens to be read again.
  await step.getByRole("button", { name: "New scene" }).click();
  await expect(step.getByText("Earlier scenes of this lesson")).toBeVisible();
  await expect(step.getByText("Einen Kaffe, bitte.")).toBeHidden();
  const earlier = step.getByRole("button", { name: /Goals: 1 of 2/ });
  await earlier.click();
  await expect(earlier).toHaveAttribute("aria-expanded", "true");
  await expect(step.getByText("Einen Kaffe, bitte.")).toBeVisible();
});
