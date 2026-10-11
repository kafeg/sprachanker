// The AI screens against the fake model (fake-llm.ts): "Why is this wrong?", the tutor, a writing check,
// going over mistakes, a deck's words given examples, a rating proposed for an exam's written answer, a
// speaking part held as a conversation.
import { expect, test } from "@playwright/test";
import { MODELL } from "@sprachanker/course-fixture";
import {
  answerPicture,
  beginCourse,
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
  await put(request, "/api/settings", { key: "llm.offIn", value: [] });
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

test("a deck's words given examples in Decks; a card and the word's sheet show them", async ({
  page,
  request,
}) => {
  await beginCourse(request);
  await post(request, "/api/cards/decks/take", {
    series: "sprachanker.fixture",
    course: "demo",
    edition: "en-de",
  });
  await page.goto("/review/decks");
  // The course's deck, made by the fake model (an earlier project may have made them already).
  const make = page.getByRole("button", { name: "Make examples" });
  const all = page.getByText("All words have examples");
  await expect(make.or(all).first()).toBeVisible();
  if (await make.isVisible()) {
    await expect(page.getByText(/\d+ words? without examples/).first()).toBeVisible();
    await make.click();
  }
  await expect(all).toBeVisible();

  // The word's sheet: its examples, "heute" not met in the course — marked, translated under them.
  await page.goto("/review/words");
  await page.getByPlaceholder("Find a word or translation").fill("kaffee");
  await page.getByRole("button", { name: /der Kaffee/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Hier ist der Kaffee heute.")).toBeVisible();
  await expect(sheet.getByText("FAKE: Here it is today.")).toBeVisible();
  await expect(sheet.getByText("New here: heute — today")).toBeVisible();
  await expect(sheet.locator("span[title=today]").first()).toHaveText("heute");
  await expect(sheet.getByText("Examples by the AI · fake-model")).toBeVisible();
  await page.keyboard.press("Escape");

  // A card of the deck shows them under its answer.
  await page.goto("/review/decks");
  await page.getByRole("button", { name: "Demo course", exact: true }).first().click();
  await page.getByRole("button", { name: "Show answer" }).click();
  const answer = page.locator("[data-study-card]").first();
  await expect(answer.getByText("FAKE: Here it is today.")).toBeVisible();
  await expect(answer.getByText("Examples by the AI · fake-model")).toBeVisible();
});

test("an answer said aloud is checked by the AI from what was heard on request, kept in the run", async ({
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
  // Asked for, not on its own.
  await free.getByRole("button", { name: "Check with AI" }).click();
  await expect(free.getByText("Small mistakes")).toBeVisible();
  await expect(free.getByText("FAKE: nearly there.")).toBeVisible();
  await expect(free.getByText(/FAKE: der Tag → guten Tag/)).toBeVisible();
  // The course's own answer, after one's own.
  await expect(free.getByRole("button", { name: "Sample" })).toBeVisible();

  const runs = await (
    await request.get(`/api/runs/lesson?series=sprachanker.fixture&lessonKey=${lesson}`)
  ).json();
  const kept = await (
    await request.get(`/api/llm/speaking?lessonKey=${lesson}&runId=${runs.state.run.id}`)
  ).json();
  expect(kept.checks.map((c: { input: string }) => c.input)).toEqual(["Hallo gute Tag"]);
});

test("a handed-in mock exam's note: the AI proposes its rating with reasons, the learner takes it", async ({
  page,
  request,
}) => {
  const exam = MODELL;
  const { run } = await post(request, "/api/exams/runs", {
    exam,
    edition: "en-de",
    mode: "test",
    module: "schreiben",
  });
  const answer = (id: string, value: unknown) => ({
    // A ULID's form (the event's id).
    id: crypto.randomUUID().replaceAll("-", "").slice(0, 26).toUpperCase(),
    type: "answered",
    itemKey: `${exam}/q-${id}`,
    payload: { answer: value, attempt: 1, ms: 1 },
  });
  await post(request, `/api/exams/runs/${run.id}/events`, {
    events: [
      answer("s3", { text: "Lieber Tom, ich komme um drei und bringe Kuchen mit. Bis bald!" }),
    ],
  });
  await post(request, `/api/exams/runs/${run.id}/finish`, {});

  await page.goto(`/exam/sprachanker.fixture/demo/modell/run/${run.id}`);
  await expect(page.getByText(/1 answer is not rated yet/)).toBeVisible();
  await page.getByRole("button", { name: "Propose a rating (AI)" }).click();
  await expect(page.getByText(/Proposed by the AI assistant/)).toBeVisible();
  await expect(page.getByText("FAKE: say who the cake is for.")).toBeVisible();
  await expect(page.getByText("FAKE: what, but not for whom.")).toBeVisible();
  // The proposal chosen: taken as it is.
  await expect(page.getByText("5.5 of 7")).toBeVisible();
  await page.getByRole("button", { name: "Save rating" }).click();
  await expect(page.getByText(/not rated yet/)).toBeHidden();
  const state = await (await request.get(`/api/exams/runs/${run.id}`)).json();
  const rated = state.events.find((e: { type: string }) => e.type === "exam_rated");
  expect(rated.payload).toMatchObject({ by: "assistant", model: "fake-model" });
});

test("a speaking part held as a conversation: the examiner opens, the learner answers, the part closes", async ({
  page,
}) => {
  await page.goto("/exams/downloaded");
  await page.getByRole("link", { name: /Model test/ }).click();
  await page.getByRole("button", { name: "Speaking" }).click();
  await page.getByRole("button", { name: /^Begin/ }).click();
  await expect(page).toHaveURL(/\/run\//);
  await expect(page.getByText("Wochenende?")).toBeVisible();
  await page.getByRole("button", { name: "Begin the part" }).click();
  await expect(page.getByText("FAKE: Bitte fragen Sie Ihren Partner.")).toBeVisible();
  await page.getByPlaceholder("Your answer…").fill("Was machst du am Wochenende?");
  await page.getByPlaceholder("Your answer…").press("Enter");
  await expect(page.getByText("FAKE: Ich gehe schwimmen.")).toBeVisible();
  await expect(page.getByText("The part is over.")).toBeVisible();
  // The conversation is the part's answer: handed in, it waits to be rated.
  await expect(page.getByText("1/1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hand in" }).filter({ visible: true }).first().click();
  await expect(page.getByText("1 answer is not rated yet", { exact: false })).toBeVisible();
  await expect(page.getByText("Me: Was machst du am Wochenende?")).toBeVisible();
});
