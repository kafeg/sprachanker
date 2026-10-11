// The Dialogue (spec 04 "AI practice in courses", 08, 09) against the fake model (fake-llm.ts): held by
// voice with the fake microphone and a fixed recognition — the partner's lines read aloud as they come
// by the device's (stubbed) voice, named; a line said, heard, sent as heard, judged; ended, summed up;
// kept and readable again — and typed where nothing hears it.
import { expect, type Page, test } from "@playwright/test";
import { DEMO_LESSON, fakeMicrophone, freshLessonRun, openStep, post, put } from "./api.ts";
import { FAKE_LLM_PORT } from "./fake-llm.ts";

const HEARD = "Einen Kaffe, bitte";

test.beforeEach(async ({ request }) => {
  await put(request, "/api/llm/providers/custom", {
    baseUrl: `http://127.0.0.1:${FAKE_LLM_PORT}/v1`,
  });
  await put(request, "/api/llm/route", { provider: "custom", model: "fake-model" });
  await put(request, "/api/settings", { key: "llm.offIn", value: [] });
  // No Dialogues of the lesson left from earlier tests (projects share the profile).
  const [series, course] = DEMO_LESSON.split("/");
  await post(request, "/api/progress/reset", { series, course, lesson: DEMO_LESSON });
  await freshLessonRun(request);
});

/** The device's voices, stubbed: what the page asks to say is kept on the page. */
async function deviceVoices(page: Page) {
  await page.addInitScript(() => {
    const said: Array<{ text: string; lang: string }> = [];
    const voices = [
      { voiceURI: "anna", name: "Anna", lang: "de-DE", localService: true, default: false },
      { voiceURI: "samantha", name: "Samantha", lang: "en-US", localService: true, default: true },
    ];
    Object.assign(globalThis, {
      said,
      SpeechSynthesisUtterance: class {
        lang = "";
        voice: unknown;
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
        speak: (u: { text: string; lang: string; onend?: () => void }) => {
          said.push({ text: u.text, lang: u.lang });
          setTimeout(() => u.onend?.(), 10);
        },
        cancel() {},
      },
    });
  });
  return () => page.evaluate(() => (globalThis as unknown as { said: unknown[] }).said);
}

/** Recognition on, as if a model were installed: what is "heard" is fixed. */
async function recognitionOn(page: Page) {
  await page.route("**/api/speech", async (route) => {
    const state = await (await route.fetch()).json();
    await route.fulfill({ json: { ...state, recognition: true, model: "small-q5_1" } });
  });
  await page.route("**/api/speech/transcribe?*", (route) =>
    route.fulfill({ json: { text: HEARD, ms: 5 } }),
  );
}

test("a Dialogue held by voice: lines read aloud as they come, a line heard and judged, ended and summed up, then readable again", async ({
  page,
}) => {
  const said = await deviceVoices(page);
  await fakeMicrophone(page);
  await recognitionOn(page);
  await openStep(page, "Dialogue");
  const step = page.locator("article");
  await step.getByRole("button", { name: "Start a dialogue" }).click();
  await expect(step.getByRole("heading", { name: "FAKE: Im Café" })).toBeVisible();
  await expect(step.getByText("Your goals")).toBeVisible();
  // What the partner knows stays hidden until the end.
  await expect(step.getByText("FAKE: Ein Kaffee kostet 2,50 Euro.")).toBeHidden();
  // The opening line read at once, in German, by the voice named over the lines.
  await expect(step.getByText("Read by this device · Anna")).toBeVisible();
  await expect
    .poll(said)
    .toContainEqual({ text: "FAKE: Guten Tag! Was möchten Sie?", lang: "de-DE" });

  // A line said: heard, shown, sent as heard (no box to edit it).
  await step.getByRole("button", { name: "Record yourself" }).click();
  // Long enough for the fake microphone's tone to be in the take under load.
  await page.waitForTimeout(2500);
  await step.getByRole("button", { name: "Stop recording" }).click();
  await expect(step.getByText("Heard:")).toBeVisible();
  await expect(step.getByText(HEARD)).toBeVisible();
  await expect(step.getByPlaceholder("Your line…")).toHaveCount(0);
  await step.getByRole("button", { name: "Send", exact: true }).click();

  // The partner answers (read at once), the line is judged and its mistake corrected, the goal ticked.
  await expect(step.getByText("FAKE: Gern. Sonst noch etwas?")).toBeVisible();
  await expect.poll(said).toContainEqual({ text: "FAKE: Gern. Sonst noch etwas?", lang: "de-DE" });
  await expect(step.getByText("FAKE: double e.")).toBeVisible();
  await expect(step.getByText("Understood")).toBeVisible();
  await expect(step.getByRole("button", { name: "Mine" })).toBeVisible();
  await expect(step.getByRole("listitem").filter({ hasText: "Order a coffee" })).toHaveClass(
    /text-correct/,
  );

  // Ended: the summary — goals met, what the partner knew, the key correction with a model line.
  await step.getByRole("button", { name: "End the dialogue" }).click();
  await expect(step.getByText("Dialogue ended.")).toBeVisible();
  await expect(step.getByText("What your partner knew")).toBeVisible();
  await expect(step.getByText("FAKE: Ein Kaffee kostet 2,50 Euro.")).toBeVisible();
  await expect(step.getByText("FAKE: Einen Kaffee, bitte.")).toBeVisible();
  await expect(step.getByText("FAKE: well asked.")).toBeVisible();
  await expect(step.getByRole("button", { name: "Record yourself" })).toHaveCount(0);

  // A new Dialogue: the earlier one is listed under it with its goals and opens to be read again.
  await step.getByRole("button", { name: "New dialogue" }).click();
  await expect(step.getByText("Earlier dialogues of this lesson")).toBeVisible();
  const earlier = step.getByRole("button", { name: /Goals: 1 of 2/ });
  await earlier.click();
  await expect(earlier).toHaveAttribute("aria-expanded", "true");
  await expect(step.getByText(HEARD)).toBeVisible();
  await expect(step.getByText("FAKE: well asked.")).toBeVisible();
});

test("without recognition the Dialogue's line is typed, the step saying why", async ({ page }) => {
  await page.route("**/api/speech", async (route) => {
    const state = await (await route.fetch()).json();
    await route.fulfill({ json: { ...state, recognition: false } });
  });
  await openStep(page, "Dialogue");
  const step = page.locator("article");
  await step.getByRole("button", { name: "Start a dialogue" }).click();
  await expect(step.getByText(/Speech recognition is off or not installed/)).toBeVisible();
  await expect(step.getByRole("button", { name: "Record yourself" })).toHaveCount(0);
  await step.getByPlaceholder("Your line…").fill("Einen Kaffe, bitte.");
  await step.getByRole("button", { name: "Send", exact: true }).click();
  await expect(step.getByText("FAKE: Gern. Sonst noch etwas?")).toBeVisible();
  await expect(step.getByText("FAKE: double e.")).toBeVisible();
  // Typed: no take to play.
  await expect(step.getByRole("button", { name: "Mine" })).toHaveCount(0);
});

test("the voices in Settings: each language read aloud with its best one", async ({ page }) => {
  await deviceVoices(page);
  await page.goto("/settings#speech");
  await expect(page.getByText("This device's voices")).toBeVisible();
  // The languages read aloud (the courses' here and the interface's): the best voice of each.
  await expect(page.getByRole("combobox", { name: "Voice for English" })).toHaveText(
    "Automatic — Samantha",
  );
});
