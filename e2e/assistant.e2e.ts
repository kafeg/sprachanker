// The AI screens against the fake model (fake-llm.ts): "Why is this wrong?", the tutor, a writing check.
import { expect, test } from "@playwright/test";
import { DEMO_LESSON, freshLessonRun, put } from "./api.ts";
import { FAKE_LLM_PORT, FAKE_TEXT } from "./fake-llm.ts";

test.beforeEach(async ({ request }) => {
  await put(request, "/api/llm/providers/custom", {
    baseUrl: `http://127.0.0.1:${FAKE_LLM_PORT}/v1`,
  });
  await put(request, "/api/llm/route", { provider: "custom", model: "fake-model" });
  await freshLessonRun(request);
});

test("explain a mistake, ask the tutor, check a text", async ({ page }) => {
  await page.goto(`/lesson/${DEMO_LESSON}`);
  await page.getByRole("button", { name: "Start lesson" }).click();

  // One item answered, the other left: that one is wrong, and its explanation streams from the model.
  await page.getByRole("button", { name: "Im Café.", exact: true }).click();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await page.getByRole("button", { name: "Why is this wrong?" }).first().click();
  await expect(page.getByText(FAKE_TEXT).first()).toBeVisible();

  await page.getByRole("button", { name: "Tutor" }).click();
  await page.getByPlaceholder("Ask a question…").fill("Was heißt das?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  // The chat keeps earlier turns (projects share the profile): the newest reply is the last one.
  await expect(page.getByRole("dialog").getByText(FAKE_TEXT).last()).toBeVisible();
  await page.keyboard.press("Escape");

  const writing = page.getByPlaceholder("Your text…");
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  const next = page.getByRole("button", { name: /^(Next|To the summary)$/ });
  for (let i = 0; i < 12; i++) {
    await writing.or(skip).or(next).first().waitFor();
    if (await writing.isVisible()) break;
    await ((await skip.isVisible()) ? skip : next).click();
  }
  await writing.fill("Ich heisse Lena.");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("FAKE: a good start.")).toBeVisible();
  await expect(page.getByText("FAKE: ß after a long vowel.")).toBeVisible();
});
