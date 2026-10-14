// Reading and Listening against the fake model
// (fake-llm.ts, a draft in whatever form the genre drawn asks for), made into the course's practice
// and done as an exercise: what the text is, Listening's recording (Qwen3-TTS on paper) in the
// course's player with the text hidden, the questions answered and checked with the step bar's Check;
// then the title and the text with its glossed word open; the step done; the text with its answers in
// the Notebook's pass. Reading's text shown at once. A recording that cannot be had: the text heard by
// the device's (stubbed) voices.
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

/** The fake text's lines, in whatever form it was drawn. */
const LINES = [
  "Guten Morgen! Zwei Brötchen, bitte.",
  "Gern. Das macht 1,20 Euro.",
  "Hier bitte. Haben Sie auch Kaffee?",
  "Ja, heute nicht. Morgen wieder, am Morgen.",
  "Schade. Dann bis morgen und vielen Dank!",
  "Bitte sehr, schönen Tag noch!",
];

/** The step's text: one of the course's practice opens with the lesson; none yet, one is written. */
async function textOf(page: Page) {
  const step = page.locator("article");
  const write = step.getByRole("button", { name: "Write a text" });
  const text = step.getByText("FAKE: at a bakery");
  await expect(write.or(text)).toBeVisible({ timeout: 15_000 });
  if (await write.isVisible()) await write.click();
  await expect(text).toBeVisible({ timeout: 15_000 });
  return step;
}

test("Listening: what it is, heard, the questions answered and checked; then what it was about and the text; kept and in the Notebook", async ({
  page,
  request,
}) => {
  await openStep(page, "Listening");
  const step = await textOf(page);
  // What it is, nothing of what it says; the text hidden.
  await expect(step.getByText("FAKE: at a bakery")).toBeVisible();
  await expect(step.getByText("FAKE: Beim Bäcker")).toBeHidden();
  await expect(step.getByText(/Das macht 1,20 Euro/)).toBeHidden();

  // Recorded with the course's practice (Qwen3-TTS on paper): played in the course's player.
  await expect(step.getByText("Recorded with Qwen3-TTS.")).toBeVisible();
  await expect(step.getByRole("button", { name: "Play: The recording" })).toBeVisible();

  // Answered: true/false wrong, the price typed (in digits), the time and what she buys chosen —
  // nothing checked until Check.
  const check = step.getByRole("button", { name: "Check", exact: true });
  await expect(check).toBeDisabled();
  await step.getByRole("button", { name: "Richtig" }).click();
  await step.getByPlaceholder("in digits").fill("1,20");
  await step.getByRole("button", { name: "am Morgen" }).click();
  await step.getByRole("button", { name: "Brötchen", exact: true }).click();
  await expect(step.getByRole("status")).toHaveCount(0);
  await check.click();

  // Checked: what it was about, the text with its new word marked, the score.
  await expect(step.getByText("3 of 4 right")).toBeVisible();
  await expect(step.getByRole("heading", { name: "FAKE: Beim Bäcker" })).toBeVisible();
  await expect(step.getByText(/Das macht 1,20 Euro/)).toBeVisible();
  await expect(step.locator("mark", { hasText: "Brötchen" }).first()).toHaveAttribute(
    "title",
    "FAKE: rolls",
  );

  // The step is done in the run (the event goes out from a queue).
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
    .toContain("listening");

  // The pass in the Notebook: the text with its answers.
  const runId = (await lessonRun()).run.id;
  await page.goto(`/notebook/${DEMO_LESSON}?pass=${runId}`);
  // Reading's text is in the pass too: the lesson took it from the course's practice as it started.
  const text = page.locator("summary", { hasText: "FAKE: Beim Bäcker · 3 of 4 right" });
  await expect(text).toBeVisible();
  await text.click();
  await expect(
    page.locator("details", { has: text }).getByText("Wann gibt es wieder Kaffee?"),
  ).toBeVisible();
});

test("Reading: the text shown at once with its questions, nothing to listen to; checked with Check", async ({
  page,
}) => {
  await openStep(page, "Reading");
  const step = await textOf(page);
  await expect(step.getByText("FAKE: at a bakery")).toBeVisible();
  await expect(step.getByText(/Das macht 1,20 Euro/)).toBeVisible();
  await expect(step.getByRole("button", { name: "Listen" })).toBeHidden();
  await step.getByRole("button", { name: "Falsch" }).click();
  await step.getByPlaceholder("in digits").fill("1,20");
  await step.getByRole("button", { name: "am Morgen" }).click();
  await step.getByRole("button", { name: "Brötchen", exact: true }).click();
  await step.getByRole("button", { name: "Check", exact: true }).click();
  await expect(step.getByText("4 of 4 right")).toBeVisible();
  await expect(step.getByRole("heading", { name: "FAKE: Beim Bäcker" })).toBeVisible();
});

test("a text written again is listed under the new one with its score", async ({ page }) => {
  await openStep(page, "Listening");
  const step = await textOf(page);
  await step.getByRole("button", { name: "Falsch" }).click();
  await step.getByPlaceholder("in digits").fill("9");
  await step.getByRole("button", { name: "am Abend" }).click();
  await step.getByRole("button", { name: "Kuchen", exact: true }).click();
  await step.getByRole("button", { name: "Check", exact: true }).click();
  await expect(step.getByText("1 of 4 right")).toBeVisible();
  await step.getByRole("button", { name: "New text" }).click();
  await expect(step.getByText("Earlier texts of this lesson")).toBeVisible();
  const earlier = step.getByRole("button", { name: /1 of 4 right/ });
  await earlier.click();
  await expect(earlier).toHaveAttribute("aria-expanded", "true");
  await expect(step.getByText(/Das macht 1,20 Euro/).first()).toBeVisible();
});

test("Listening whose recording cannot be had, nothing on the server to read it again: heard by the device's voices, line by line", async ({
  page,
}) => {
  const said = await deviceVoices(page);
  await page.route("**/api/llm/understanding/audio?*", (route) =>
    route.fulfill({ status: 409, json: { error: "speech_unavailable" } }),
  );
  await openStep(page, "Listening");
  const step = await textOf(page);
  await expect(step.getByText(/^Read by this device/)).toBeVisible({ timeout: 15_000 });
  await expect(step.getByText(/Das macht 1,20 Euro/)).toBeHidden();
  // Heard to the end, every line; played again from the start, as often as wanted.
  await step.getByRole("button", { name: "Listen" }).click();
  await expect(step.getByText("Heard once")).toBeVisible();
  expect(((await said()) as Array<{ text: string }>).map((s) => s.text)).toEqual(LINES);
  await step.getByRole("button", { name: "Listen" }).click();
  await expect(step.getByText("Heard 2 times")).toBeVisible();
});
