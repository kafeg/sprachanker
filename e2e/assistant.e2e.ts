// The AI screens against the fake model (fake-llm.ts): "Why is this wrong?", the tutor, a writing check,
// going over mistakes, an example for a word.
import { expect, test } from "@playwright/test";
import {
  answerPicture,
  DEMO_LESSON,
  fakeMicrophone,
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
  // The History tab lists the lesson's chats; one opens to its turns and can be deleted.
  const tutor = page.getByRole("dialog");
  await tutor.getByRole("tab", { name: "History" }).click();
  const chat = tutor.getByRole("button", { name: /Was heißt das\?/ }).first();
  await chat.click();
  await expect(chat).toHaveAttribute("aria-expanded", "true");
  await tutor.getByRole("button", { name: "Delete chat" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete chat" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await tutor.getByRole("tab", { name: "Conversation" }).click();
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
  // The text is in the result now; "Fix it and check again" brings it back into the editor.
  await expect(writing).toHaveValue("");
  await page.getByRole("button", { name: "Fix it and check again" }).first().click();
  await expect(writing).toHaveValue("Ich heisse Lena.");
  await expect(writing).toBeFocused();
  await writing.fill("Ich heiße Lena.");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(writing).toHaveValue("");
  // The earlier text is listed under the latest check, with its criteria, and opens in full.
  const earlier = page.getByRole("button", { name: /Ich heisse Lena\./ }).first();
  await expect(earlier).toContainText("Small mistakes");
  await earlier.click();
  await expect(earlier).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Fix it and check again" })).toHaveCount(2);

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

test("read aloud: a scene's new line at once when asked, the speaker in its corner, the voices in Settings", async ({
  page,
  request,
}) => {
  // The device's voices, stubbed: what the page asks to say is kept on the page.
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
        constructor(readonly text: string) {}
      },
    });
    Object.defineProperty(globalThis, "speechSynthesis", {
      value: {
        getVoices: () => voices,
        addEventListener() {},
        removeEventListener() {},
        speak: (u: { text: string; lang: string }) => said.push({ text: u.text, lang: u.lang }),
        cancel() {},
      },
    });
  });
  const said = () => page.evaluate(() => (globalThis as unknown as { said: unknown[] }).said);
  const [series, course] = DEMO_LESSON.split("/");
  await post(request, "/api/progress/reset", { series, course, lesson: DEMO_LESSON });
  await put(request, "/api/settings", { key: "speech.readAtOnce", value: "scenes" });
  try {
    await openStep(page, "Scene");
    const step = page.locator("article");
    await step.getByRole("button", { name: "Start a scene" }).click();
    await expect(step.getByText("FAKE: Guten Tag! Was möchten Sie?")).toBeVisible();
    await expect.poll(said).toEqual([{ text: "FAKE: Guten Tag! Was möchten Sie?", lang: "de-DE" }]);
    // The line being read shows it in its corner: stopped, then read again from there.
    await step.getByRole("button", { name: "Stop reading" }).click();
    await step
      .getByRole("button", { name: /Read aloud/ })
      .first()
      .click();
    await expect.poll(async () => (await said()).length).toBe(2);
  } finally {
    await put(request, "/api/settings", { key: "speech.readAtOnce", value: "none" });
  }
  await page.goto("/settings#speech");
  await expect(page.getByText("This device's voices")).toBeVisible();
  // The profile's languages (this one has only its own set): the best voice of each.
  await expect(page.getByRole("combobox", { name: "Voice for English" })).toHaveText(
    "Automatic — Samantha",
  );
});

test("AI settings: providers as cards, the chosen one's model list without non-text models", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "AI assistant" }).click();
  const network = page.getByRole("button", { name: /Server on the network/ });
  await expect(network).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Any server with an OpenAI-compatible API/)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Connected" })).toBeVisible();
  // The fake server's image generator is left out: one chat model, the one in use.
  await expect(page.getByText("1 of 1 models")).toBeVisible();
  await expect(page.getByRole("button", { name: /fake-model/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // OpenRouter without a key says so on its card.
  await expect(page.getByRole("button", { name: /OpenRouter/ })).toContainText("needs a key");
});

test("an example for a word: asked for in its sheet, kept, another on request", async ({
  page,
  request,
}) => {
  await post(request, "/api/cards/lesson", {
    series: "sprachanker.fixture",
    lessonKey: DEMO_LESSON,
    edition: "en-de",
  });
  await page.goto("/review/words");
  await page.getByPlaceholder("Find a word or translation").fill("kaffee");
  await page.getByRole("button", { name: /der Kaffee/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Example" }).click();
  // The word is known; "heute" is not met in the course: marked, its translation under the sentence.
  await expect(sheet.getByText("Hier ist der Kaffee heute.")).toBeVisible();
  await expect(sheet.getByText("FAKE: Here it is today.").first()).toBeVisible();
  await expect(sheet.getByText("heute — today")).toBeVisible();
  await expect(sheet.locator("span[title=today]")).toHaveText("heute");

  // Kept: the sheet opened again shows it when asked, without asking the model; another on request.
  let made = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/llm/examples")) made++;
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /der Kaffee/ }).click();
  await sheet.getByRole("button", { name: "Example" }).click();
  await expect(sheet.getByText("Hier ist der Kaffee heute.")).toBeVisible();
  expect(made).toBe(0);
  await sheet.getByRole("button", { name: "Another example" }).click();
  await expect.poll(() => made).toBe(1);
  await expect(sheet.getByRole("button", { name: "Another example" })).toBeVisible();
});

test("an answer said aloud is checked by the AI from what was heard, kept in the run", async ({
  page,
  request,
}) => {
  const lesson = "sprachanker.fixture/demo/00-02";
  await freshLessonRun(request, lesson);
  await fakeMicrophone(page);
  // Recognition on, as if a model were installed: what is "heard" is fixed.
  await page.route("**/api/speech", async (route) => {
    const state = await (await route.fetch()).json();
    await route.fulfill({ json: { ...state, recognition: true, model: "small-q5_1" } });
  });
  await page.route("**/api/speech/transcribe?*", (route) =>
    route.fulfill({ json: { text: "Hallo gute Tag", ms: 5 } }),
  );
  await openStep(page, "Repeat", lesson);
  const free = page.locator("ol > li").nth(1);
  await free.getByRole("button", { name: "Record yourself" }).click();
  // Long enough for the fake microphone's tone to be in the take under load (a take with no sound
  // does not decode, and is "not heard").
  await page.waitForTimeout(2500);
  await free.getByRole("button", { name: "Stop recording" }).click();

  await expect(free.getByText("Hallo gute Tag")).toBeVisible();
  await expect(free.getByText("Small mistakes")).toBeVisible();
  await expect(free.getByText("FAKE: nearly there.")).toBeVisible();
  await expect(free.getByText(/FAKE: der Tag → guten Tag/)).toBeVisible();
  // The course's own answer, after one's own.
  await expect(free.getByRole("button", { name: "Sample answer" })).toBeVisible();

  const runs = await (
    await request.get(`/api/runs/lesson?series=sprachanker.fixture&lessonKey=${lesson}`)
  ).json();
  const kept = await (
    await request.get(`/api/llm/speaking?lessonKey=${lesson}&runId=${runs.state.run.id}`)
  ).json();
  expect(kept.checks.map((c: { transcript: string }) => c.transcript)).toEqual(["Hallo gute Tag"]);
});
