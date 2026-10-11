// Understanding (spec 04 "AI practice in courses", 08, 09) against the fake model (fake-llm.ts): a
// dialogue written and read again, heard by the device's (stubbed) voices — its two speakers by two
// voices, both named —, answered by ear with the text hidden, then read with its glossed word marked
// and its reading question; the step done; the text with its answers in the Notebook's pass.
import { expect, type Page, test } from "@playwright/test";
import { DEMO_LESSON, freshLessonRun, openStep, post, put } from "./api.ts";
import { FAKE_LLM_PORT } from "./fake-llm.ts";

test.beforeEach(async ({ request }) => {
  await put(request, "/api/llm/providers/custom", {
    baseUrl: `http://127.0.0.1:${FAKE_LLM_PORT}/v1`,
  });
  await put(request, "/api/llm/route", { provider: "custom", model: "fake-model" });
  await put(request, "/api/settings", { key: "llm.offIn", value: [] });
  await put(request, "/api/settings", { key: "speech.readEngine", value: "device" });
  // No texts of the lesson left from earlier tests (projects share the profile).
  const [series, course] = DEMO_LESSON.split("/");
  await post(request, "/api/progress/reset", { series, course, lesson: DEMO_LESSON });
  await freshLessonRun(request);
});

/** The device's voices, stubbed — two German ones: what the page asks to say, and by which voice,
 *  is kept on the page. */
async function deviceVoices(page: Page) {
  await page.addInitScript(() => {
    const said: Array<{ text: string; voice: string }> = [];
    const voices = [
      { voiceURI: "anna", name: "Anna", lang: "de-DE", localService: true, default: false },
      { voiceURI: "markus", name: "Markus", lang: "de-DE", localService: true, default: false },
      { voiceURI: "samantha", name: "Samantha", lang: "en-US", localService: true, default: true },
    ];
    Object.assign(globalThis, {
      said,
      SpeechSynthesisUtterance: class {
        lang = "";
        voice: { name: string } | undefined;
        rate = 1;
        onend?: () => void;
        constructor(readonly text: string) {}
      },
    });
    Object.defineProperty(globalThis, "speechSynthesis", {
      value: {
        getVoices: () => voices,
        addEventListener() {},
        removeEventListener() {},
        speak: (u: { text: string; voice?: { name: string }; onend?: () => void }) => {
          said.push({ text: u.text, voice: u.voice?.name ?? "" });
          setTimeout(() => u.onend?.(), 10);
        },
        cancel() {},
      },
    });
  });
  return () => page.evaluate(() => (globalThis as unknown as { said: unknown[] }).said);
}

test("a dialogue heard by two voices, answered by ear with the text hidden, then read with its reading question; kept and in the Notebook", async ({
  page,
  request,
}) => {
  const said = await deviceVoices(page);
  await openStep(page, "Understanding");
  const step = page.locator("article");
  await step.getByRole("button", { name: "Write a text" }).click();
  await expect(step.getByRole("heading", { name: "FAKE: Beim Bäcker" })).toBeVisible();
  // Who reads it, both voices named; the text hidden while it is answered by ear.
  await expect(step.getByText("Read by this device · Anna and Markus")).toBeVisible();
  await expect(step.getByText(/Answer by ear/)).toBeVisible();
  await expect(step.getByText(/Das macht 1,20 Euro/)).toBeHidden();
  await expect(step.getByText("Wer verkauft?")).toBeHidden();

  // Heard: each speaker by a voice of their own, to the end.
  await step.getByRole("button", { name: "Listen" }).click();
  await expect(step.getByText("Heard once")).toBeVisible();
  expect(await said()).toEqual([
    { text: "Guten Morgen! Zwei Brötchen, bitte.", voice: "Anna" },
    { text: "Gern. Das macht 1,20 Euro.", voice: "Markus" },
  ]);
  // Played again from the start, as often as wanted.
  await step.getByRole("button", { name: "Listen" }).click();
  await expect(step.getByText("Heard 2 times")).toBeVisible();

  // By ear: true/false wrong, the price typed and checked, the time chosen.
  await step.getByRole("button", { name: "Richtig" }).click();
  await step.getByRole("textbox").fill("1,20");
  await step.getByRole("button", { name: "Check", exact: true }).click();
  await step.getByRole("button", { name: "am Morgen" }).click();

  // The text opens, its new word marked; the reading question follows.
  await expect(step.getByRole("heading", { name: "The text", exact: true })).toBeVisible();
  await expect(step.getByText(/Das macht 1,20 Euro/)).toBeVisible();
  await expect(step.locator("mark", { hasText: "Brötchen" }).first()).toHaveAttribute(
    "title",
    "FAKE: rolls",
  );
  await step.getByRole("button", { name: "der Verkäufer" }).click();
  await expect(step.getByText("3 of 4 right")).toBeVisible();

  // All answered: the step is done in the run (the event goes out from a queue).
  const lessonRun = async () => {
    const res = await request.get(
      `/api/runs/lesson?series=sprachanker.fixture&lessonKey=${DEMO_LESSON}`,
    );
    return (await res.json()).state;
  };
  await expect
    .poll(async () =>
      (await lessonRun()).events
        .filter((e: { type: string }) => e.type === "step_done")
        .map((e: { payload: { step: string } }) => e.payload.step),
    )
    .toContain("understanding");

  // The pass in the Notebook: the text with its answers.
  const runId = (await lessonRun()).run.id;
  await page.goto(`/notebook/${DEMO_LESSON}?pass=${runId}`);
  const text = page.locator("summary", { hasText: "FAKE: Beim Bäcker" });
  await expect(text).toContainText("3 of 4 right");
  await text.click();
  await expect(page.getByText("Wer verkauft?")).toBeVisible();
});

test("a text written again is listed under the new one with its score", async ({ page }) => {
  await deviceVoices(page);
  await openStep(page, "Understanding");
  const step = page.locator("article");
  await step.getByRole("button", { name: "Write a text" }).click();
  await step.getByRole("button", { name: "Falsch" }).click();
  await step.getByRole("button", { name: "New text" }).click();
  await expect(step.getByText("Earlier texts of this lesson")).toBeVisible();
  const earlier = step.getByRole("button", { name: /1 of 4 right/ });
  await earlier.click();
  await expect(earlier).toHaveAttribute("aria-expanded", "true");
  await expect(step.getByText(/Das macht 1,20 Euro/).first()).toBeVisible();
});
