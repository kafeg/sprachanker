// Speaking against the fake model (fake-llm.ts): a role-play
// by voice with the fake microphone and a fixed recognition — the partner's lines played as they come
// from their recordings (the course's practice, Qwen3-TTS on paper), each of the learner's said from
// its hint and kept, then Check in
// the step bar: each line's verdict, a correction, a good way to say it; and a monologue's card typed
// where nothing hears, checked as a writing check, with a model answer.
import { expect, type Page, test } from "@playwright/test";
import {
  DEMO_LESSON,
  fakeMicrophone,
  fillPractice,
  freshLessonRun,
  openStep,
  post,
  practiceTaken,
  put,
} from "./api.ts";
import { FAKE_LLM_PORT } from "./fake-llm.ts";

const HEARD = "Ja gern danke";

test.beforeEach(async ({ request }) => {
  await put(request, "/api/llm/providers/custom", {
    baseUrl: `http://127.0.0.1:${FAKE_LLM_PORT}/v1`,
  });
  await put(request, "/api/llm/route", { provider: "custom", model: "fake-model" });
  await put(request, "/api/settings", { key: "llm.offIn", value: [] });
  // The course's practice has both kinds: a card and a role-play (they take turns).
  await fillPractice(request, "speaking", 2);
  // No Speaking tasks of the lesson left from earlier tests (projects share the profile); the
  // lesson's start takes the first.
  const [series, course] = DEMO_LESSON.split("/");
  await post(request, "/api/progress/reset", { series, course, lesson: DEMO_LESSON });
  await freshLessonRun(request);
  await practiceTaken(request, "speaking");
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

/** The step's task of a kind: the course's practice's taken into the lesson's run, else another
 *  version of it — the kinds take turns. */
async function taskOf(page: Page, kind: "monologue" | "roleplay") {
  const step = page.locator("article");
  const card = step.getByText("Über mich");
  const play = step.getByText("You are: FAKE: a customer");
  await expect(card.or(play)).toBeVisible({ timeout: 15_000 });
  const wanted = kind === "monologue" ? card : play;
  for (let i = 0; i < 6 && !(await wanted.isVisible()); i++) {
    const taken = page.waitForResponse((r) => r.url().includes("/api/llm/talk?"));
    await step.getByRole("button", { name: "Another version" }).click();
    await taken;
  }
  await expect(wanted).toBeVisible({ timeout: 15_000 });
  return step;
}

test("a role-play by voice: the partner's lines read aloud as they come, each line said from its hint, then checked line by line", async ({
  page,
  request,
}) => {
  // The partner's lines are recorded with the course's practice (Qwen3-TTS on paper): fetched as
  // they come.
  const recordings: string[] = [];
  page.on("response", (r) => {
    if (r.ok() && /\/library\/sprachanker\.fixture\/practice\/.+\.wav$/.test(r.url()))
      recordings.push(r.url());
  });
  await deviceVoices(page);
  await fakeMicrophone(page);
  await recognitionOn(page);
  await openStep(page, "Speaking");
  const step = await taskOf(page, "roleplay");
  await expect(step.getByText("FAKE: Anna buys rolls.")).toBeVisible();
  await expect(step.getByText("Guten Morgen! Zwei Brötchen, bitte.")).toBeVisible();
  // The partner's next line comes only once the learner's is said.
  await expect(step.getByText("Hier bitte. Haben Sie auch Kaffee?")).toBeHidden();
  const check = page.getByRole("button", { name: "Check", exact: true });
  for (const n of [1, 3, 5]) {
    await expect(step.getByText(`Your line: FAKE: hint ${n}`)).toBeVisible();
    await step.getByRole("button", { name: "Record yourself" }).click();
    // Long enough for the fake microphone's tone to be in the take under load.
    await page.waitForTimeout(2500);
    await step.getByRole("button", { name: "Stop recording" }).click();
    await expect(step.getByText("Heard:")).toBeVisible();
    // Check waits until every line is said.
    await expect(check).toBeDisabled();
    await step.getByRole("button", { name: "Keep it" }).click();
    if (n === 1) {
      // The partner answers, its line's recording played at once.
      await expect(step.getByText("Hier bitte. Haben Sie auch Kaffee?")).toBeVisible();
      await expect.poll(() => recordings.length).toBe(1);
    }
  }
  await expect(step.getByText(HEARD)).toHaveCount(3);

  // Every line said: Check in the step bar; each line's verdict, its correction, a good way to say it.
  await check.click();
  await expect(step.getByText("3 of 3 lines fit")).toBeVisible();
  await expect(step.getByText("FAKE: well played.")).toBeVisible();
  await expect(step.getByText("FAKE: say how many.")).toBeVisible();
  await expect(step.getByText(/A good way to say it/)).toHaveCount(3);
  // A checked task marks the step done in the run.
  const steps = async () => {
    const res = await request.get(
      `/api/runs/lesson?series=sprachanker.fixture&lessonKey=${DEMO_LESSON}`,
    );
    const { state } = await res.json();
    return state.events
      .filter((e: { type: string }) => e.type === "step_done")
      .map((e: { payload: { step: string } }) => e.payload.step);
  };
  await expect.poll(steps).toContain("speaking");
});

test("a monologue typed where nothing hears: the card, the text kept, checked with a model answer", async ({
  page,
}) => {
  // A microphone here, recognition off: the only reason nothing hears.
  await fakeMicrophone(page);
  await page.route("**/api/speech", async (route) => {
    const state = await (await route.fetch()).json();
    await route.fulfill({ json: { ...state, recognition: false } });
  });
  await openStep(page, "Speaking");
  const step = await taskOf(page, "monologue");
  await expect(step.getByText("FAKE: About yourself")).toBeVisible();
  await expect(step.getByText("Woher?")).toBeVisible();
  await expect(step.getByText("Speak for about 30 seconds.")).toBeVisible();
  await expect(step.getByText(/Speech recognition is off or not installed/)).toBeVisible();
  await expect(step.getByRole("button", { name: "Record yourself" })).toHaveCount(0);
  await step.getByPlaceholder("Your line…").fill("Ich heisse Lena.");
  await step.getByRole("button", { name: "Keep it" }).click();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(step.getByText("FAKE: a good start.")).toBeVisible();
  await expect(step.getByText("FAKE: ß after a long vowel.")).toBeVisible();
  await expect(step.getByText("A model answer")).toBeVisible();
  await expect(step.getByText("FAKE: Ich heiße Mara. Ich komme aus Polen.")).toBeVisible();
});

test("reading aloud in Settings: Qwen3-TTS alone, each language's speaker", async ({ page }) => {
  await page.goto("/settings#speech");
  // Qwen3-TTS on paper, its small model there; no other engine to choose.
  await expect(page.getByText("Ready: a model downloaded")).toBeVisible();
  await expect(page.getByText("This device's voices")).toHaveCount(0);
  // The languages read aloud (the courses' here and the interface's): the default speaker of each.
  await expect(page.getByRole("combobox", { name: "Voice for German" })).toHaveText(
    "Automatic — Ryan",
  );
  // The voice for words: its Base model offered to download, nothing to choose before it is there.
  const words = page
    .getByRole("listitem")
    .filter({ hasText: "Base model (1.7B): a native voice for words" });
  await expect(words.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Another recording" })).toHaveCount(0);
});
