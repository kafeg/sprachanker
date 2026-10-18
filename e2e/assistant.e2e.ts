// The AI screens against the fake model (fake-llm.ts): "Why is this wrong?", the tutor, a writing check,
// going over mistakes, a deck's words given examples, words selected kept in Finds, a rating proposed
// for an exam's written answer, a speaking part held as a conversation.
import { expect, test } from "@playwright/test";
import { MODELL } from "@sprachanker/course-fixture";
import {
  answerPicture,
  beginCourse,
  DEMO_LESSON,
  fakeMicrophone,
  fillPractice,
  freshLessonRun,
  goToStep,
  noExamRunGoing,
  openStep,
  post,
  practiceTaken,
  put,
} from "./api.ts";
import { FAKE_LLM_PORT, FAKE_TEXT } from "./fake-llm.ts";

test.beforeEach(async ({ request }) => {
  await put(request, "/api/llm/providers/custom", {
    baseUrl: `http://127.0.0.1:${FAKE_LLM_PORT}/v1`,
  });
  await put(request, "/api/llm/route", { provider: "custom", model: "fake-model" });
  await put(request, "/api/settings", { key: "llm.offIn", value: [] });
  await fillPractice(request, "writing");
  // No writing tasks or mistakes reviews of the lesson left from earlier tests (projects share the
  // profile): the lesson's start takes the course's task.
  const [series, course] = DEMO_LESSON.split("/");
  await post(request, "/api/progress/reset", { series, course, lesson: DEMO_LESSON });
  await freshLessonRun(request);
  await practiceTaken(request, "writing");
});

// A test that begins the fixture's exam and leaves it going must not leave it to the next one.
test.afterEach(async ({ request }) => {
  await noExamRunGoing(request, MODELL);
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

  // The plan has the AI practice steps the course's practice has. Writing: its task (taken into the
  // run): a situation, three points, the length of the course's level (the fixture names none: a
  // beginner's); a text on it checked: each point rated, the corrections, a model text.
  await goToStep(page, "Writing");
  const task = page.getByText("FAKE: You are meeting Lena at the café.");
  await expect(task).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("FAKE: say when you come")).toBeVisible();
  await expect(page.getByText("About 30 words.")).toBeVisible();
  const writing = page.getByPlaceholder("Your text…");
  await writing.fill("Ich heisse Lena.");
  await expect(page.getByText("3 words of about 30")).toBeVisible();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("FAKE: a good start.")).toBeVisible();
  await expect(page.getByText("FAKE: ß after a long vowel.")).toBeVisible();
  await expect(page.getByText("FAKE: no reason given.")).toBeVisible();
  await expect(page.getByText("Model text")).toBeVisible();
  await expect(page.getByText("FAKE: Hallo Lena, ich heiße Anna.")).toBeVisible();
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

  // "Going over mistakes" in the summary (the pass has a mistake): the mistakes by type, one type at a
  // time — the wrong part, an explanation, two new items checked at once; all answered, the score.
  await goToStep(page, "Summary");
  const step = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Going over mistakes" }) })
    .last();
  await step.getByRole("button", { name: "Go over my mistakes" }).click();
  await expect(step.getByText("Type 1 of 1")).toBeVisible();
  await expect(step.getByRole("heading", { name: "Choices" })).toBeVisible();
  await expect(step.getByText("FAKE: read the question again.")).toBeVisible();
  await step.getByRole("button", { name: "Im Café.", exact: true }).first().click();
  await expect(step.getByRole("status").filter({ hasText: "Correct" })).toHaveCount(1);
  await step.getByRole("button", { name: "Im Park.", exact: true }).last().click();
  await expect(step.getByText("1 of 2 right")).toBeVisible();
  // Back on the summary later, the review is there at once with its answers.
  await goToStep(page, "Writing");
  await goToStep(page, "Summary");
  await expect(step.getByText("1 of 2 right")).toBeVisible();
});

test("words selected translated: the bar's Translate shows the card and keeps it in Finds", async ({
  page,
  request,
}) => {
  await put(request, "/api/settings", { key: "uiLanguage", value: "en" });
  await openStep(page, "Lena at the café");
  // "Café" of an option selected, as a learner's drag selects it.
  await page.evaluate(() => {
    const option = [...document.querySelectorAll("[role=button]")].find(
      (e) => !!e.textContent?.includes("Im Café."),
    );
    const walker = document.createTreeWalker(option as Node, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && !text.textContent?.includes("Café")) text = walker.nextNode();
    const at = text?.textContent?.indexOf("Café") ?? 0;
    const range = document.createRange();
    range.setStart(text as Node, at);
    range.setEnd(text as Node, at + 4);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  const bar = page.getByRole("toolbar", { name: "Selected text" });
  await bar.getByRole("button", { name: "Translate" }).click();
  // The fake model keeps the words as they are; a project before this one kept them already.
  await expect(bar.getByText("FAKE: Café")).toBeVisible();
  await expect(bar.getByText(/Added to Finds|Already in your cards/)).toBeVisible();
  // Its audio made after (Qwen3-TTS on paper), then the play button.
  await expect(bar.getByRole("button", { name: "Listen" })).toBeVisible({ timeout: 20_000 });
  // Review → Decks: the learner's own deck, by its name.
  await page.goto("/review/decks");
  await expect(page.getByRole("button", { name: "Finds", exact: true })).toBeVisible();
});

test("going over mistakes is in the summary only once the pass has a mistake; no step of the plan", async ({
  page,
}) => {
  await openStep(page, "Lena at the café");
  const goingOver = page.getByRole("heading", { name: "Going over mistakes" });
  await goToStep(page, "Summary");
  await expect(page.getByText("Lena at the café").filter({ visible: true }).first()).toBeVisible();
  await expect(goingOver).toHaveCount(0);
  // A wrong answer: the summary offers going over it.
  await goToStep(page, "Lena at the café");
  await page.getByRole("button", { name: "Im Park.", exact: true }).click();
  await answerPicture(page);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await goToStep(page, "Summary");
  await expect(goingOver).toBeVisible();
  await expect(page.getByRole("button", { name: "Going over mistakes" })).toHaveCount(0);
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
  // The course's deck, made by the fake model from its row's "Audio and examples", in the pair taken
  // (an earlier project may have made them already); its row says how they stand.
  const entry = page
    .getByRole("listitem")
    .filter({ hasText: "Demo course" })
    .filter({ hasText: "English → German" });
  await entry.getByRole("button", { name: "Audio and examples" }).click();
  const make = entry.getByRole("button", { name: "Make examples" });
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
  // The row (its play button is named "Play: …").
  await page.getByRole("button", { name: /^der Kaffee/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Hier ist der Kaffee heute.")).toBeVisible();
  await expect(sheet.getByText("FAKE: Here it is today.")).toBeVisible();
  await expect(sheet.getByText("New here: heute — today")).toBeVisible();
  await expect(sheet.locator("span[title=today]").first()).toHaveText("heute");
  await expect(sheet.getByText("Examples by the AI · fake-model")).toBeVisible();
  await page.keyboard.press("Escape");

  // A card of the deck shows them under its answer, one at a time: "Example", again the next (its own
  // first, then the AI's).
  await page.goto("/review/decks");
  await page.getByRole("button", { name: "Demo course", exact: true }).first().click();
  await page.getByRole("button", { name: "Show answer" }).click();
  const answer = page.locator("[data-study-card]").first();
  const example = page
    .locator("div.relative:has(> [data-study-card])")
    .getByRole("button", { name: /^Example/ });
  const made = answer.getByText("FAKE: Here it is today.");
  await expect(made).toHaveCount(0);
  await expect(async () => {
    if (!(await made.isVisible())) await example.click();
    await expect(made).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(answer.getByText("Examples by the AI · fake-model")).toBeVisible();
});

test("an answer said aloud: its words against the source's answer, almost; the AI only on Why, kept in the run", async ({
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
  // Checked by its words, as a line repeated (owner, 2026-10-18): almost, the word misheard marked;
  // the right answer after the check. The AI not by itself.
  await expect(free.getByText("Almost: compare your words with the right answer")).toBeVisible();
  await expect(free.getByRole("button", { name: "Hear the right answer" })).toBeVisible();
  const runs = await (
    await request.get(`/api/runs/lesson?series=sprachanker.fixture&lessonKey=${lesson}`)
  ).json();
  const checks = async () =>
    (
      await (
        await request.get(`/api/llm/speaking?lessonKey=${lesson}&runId=${runs.state.run.id}`)
      ).json()
    ).checks.map((c: { input: string }) => c.input);
  await page.waitForTimeout(500);
  expect(await checks()).toEqual([]);
  await expect(free.getByText("Small mistakes")).toHaveCount(0);
  // Asked why: the AI's check.
  await free.getByRole("button", { name: "Why is this wrong?" }).click();
  await expect(free.getByText("Small mistakes")).toBeVisible();
  await expect(free.getByText("FAKE: nearly there.")).toBeVisible();
  await expect(free.getByText(/FAKE: der Tag → guten Tag/)).toBeVisible();
  expect(await checks()).toEqual(["Hallo gute Tag"]);
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
  // Gone over as an examiner does: the task's points, the error corrected, a model text.
  await expect(page.getByText("When you come.")).toBeVisible();
  await expect(page.getByText("FAKE: a cake, for whom?")).toBeVisible();
  await expect(page.getByText("FAKE: a time with Uhr.")).toBeVisible();
  await expect(page.getByText(/FAKE: Lieber Tom, ich komme um drei Uhr/)).toBeVisible();
  // The proposal chosen, not counted until accepted: taken as it is.
  await expect(page.getByText("5.5 of 7", { exact: true })).toBeVisible();
  await expect(page.getByText(/Not accepted yet: the result counts 0 of 7/)).toBeVisible();
  await page.getByRole("button", { name: "Accept the proposal" }).click();
  await expect(page.getByText(/Not accepted yet/)).toBeHidden();
  await expect(page.getByText(/not rated yet/)).toBeHidden();
  const state = await (await request.get(`/api/exams/runs/${run.id}`)).json();
  const rated = state.events.find((e: { type: string }) => e.type === "exam_rated");
  expect(rated.payload).toMatchObject({ by: "assistant", model: "fake-model" });
});

test("a speaking part said from its script: the examiner and the partner speak, the learner says their places — a mock exam without hints, practice with them and Check", async ({
  page,
}) => {
  await page.goto("/exams/downloaded");
  await page.getByRole("link", { name: /Model test/ }).click();
  await page.getByRole("button", { name: "Speaking" }).click();
  await page.getByRole("button", { name: /^Begin/ }).click();
  await expect(page).toHaveURL(/\/run\//);
  // The module's minute to prepare: the Teil's task and card, notes written; then the Teil with them.
  await expect(page.getByRole("heading", { name: "Preparation: Speaking" })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("left to prepare");
  await expect(page.getByText("Wochenende?")).toBeVisible();
  await page.getByRole("textbox").fill("Schwimmen? Kino?");
  await page.getByRole("button", { name: "Begin the parts" }).click();
  await expect(page.getByText("Your notes from the preparation")).toBeVisible();
  await expect(page.getByText("Schwimmen? Kino?")).toBeVisible();
  await page.getByRole("button", { name: "Begin the part" }).click();
  await expect(page.getByText("FAKE: Bitte fragen Sie Ihren Partner.")).toBeVisible();
  // The Teil's time, running at the learner's turn.
  await expect(page.getByRole("timer")).toContainText("left for this part");
  // A mock exam gives the cards only, never the hints; the partner's line comes once the learner's
  // is said (typed here: nothing hears in the test).
  await expect(page.getByText("FAKE: ask about the weekend")).toHaveCount(0);
  await expect(page.getByText("FAKE: Ich gehe schwimmen.")).toHaveCount(0);
  await page.getByPlaceholder("Your line…").fill("Was machst du am Wochenende?");
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByText("FAKE: Ich gehe schwimmen.")).toBeVisible();
  await expect(page.getByText("FAKE: Danke. Das war Teil 1.")).toBeVisible();
  // Typed where nothing hears: marked so.
  await expect(page.getByText("Typed, not said")).toBeVisible();
  // Said through: the part is the answer; handed in, it waits to be rated.
  await expect(page.getByText("1/1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hand in" }).filter({ visible: true }).first().click();
  await expect(page.getByText("1 answer is not rated yet", { exact: false })).toBeVisible();
  await expect(
    page.getByText("Was machst du am Wochenende?", { exact: true }).first(),
  ).toBeVisible();

  // Practice: the hints shown; Check sends the part, the examiner rates it at once; each line said
  // with the script's good line.
  await page.goto("/exams/downloaded");
  await page.getByRole("link", { name: /Model test/ }).click();
  await page.getByRole("button", { name: "Speaking" }).click();
  await page.getByRole("button", { name: "Practise" }).click();
  await page.getByRole("button", { name: "Begin the parts" }).click();
  await page.getByRole("button", { name: "Begin the part" }).click();
  await expect(page.getByText("FAKE: ask about the weekend").first()).toBeVisible();
  const check = page.getByRole("button", { name: "Check", exact: true }).filter({ visible: true });
  await expect(check).toBeDisabled();
  await page.getByPlaceholder("Your line…").fill("Was du machst am Wochenende?");
  await page.getByRole("button", { name: "Keep it" }).click();
  await check.click();
  await expect(page.getByText(/A good way to say it/)).toBeVisible();
  await expect(page.getByText(/Proposed by the AI assistant/)).toBeVisible();
});

test("a speaking part by voice: each place said into the microphone, heard and kept, nothing marked typed; a mock exam's part ended by the examiner when its time is over", async ({
  page,
}) => {
  // Recognition on, as if a model were installed: what is heard is fixed.
  await fakeMicrophone(page);
  await page.route("**/api/speech", async (route) => {
    const state = await (await route.fetch()).json();
    await route.fulfill({ json: { ...state, recognition: true, model: "small-q5_1" } });
  });
  await page.route("**/api/speech/transcribe?*", (route) =>
    route.fulfill({ json: { text: "Was machst du am Wochenende?", ms: 5 } }),
  );
  await page.clock.install();
  await page.goto("/exams/downloaded");
  await page.getByRole("link", { name: /Model test/ }).click();
  await page.getByRole("button", { name: "Speaking" }).click();
  await page.getByRole("button", { name: "Practise" }).click();
  await page.getByRole("button", { name: "Begin the parts" }).click();
  await page.getByRole("button", { name: "Begin the part" }).click();
  await page.getByRole("button", { name: "Record yourself" }).click();
  // Long enough for the fake microphone's tone to be in the take under load.
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByText("Heard:")).toBeVisible();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByText("FAKE: Ich gehe schwimmen.")).toBeVisible();
  await expect(page.getByText("Was machst du am Wochenende?", { exact: true })).toBeVisible();
  await expect(page.getByText("Typed, not said")).toHaveCount(0);

  // A mock exam: the Teil's minute runs out at the learner's turn — the examiner ends the part,
  // nothing said kept as the answer.
  await page.goto("/exams/downloaded");
  await page.getByRole("link", { name: /Model test/ }).click();
  await page.getByRole("button", { name: "Speaking" }).click();
  await page.getByRole("button", { name: /^Begin/ }).click();
  await page.getByRole("button", { name: "Begin the parts" }).click();
  await page.getByRole("button", { name: "Begin the part" }).click();
  await expect(page.getByRole("button", { name: "Record yourself" })).toBeVisible();
  // Running once the examiner's line is read.
  await expect(page.getByRole("timer")).toContainText("0:5");
  await page.clock.fastForward("01:05");
  await expect(page.getByText("Time is up: the examiner ended the part.")).toBeVisible();
  await expect(page.getByText("FAKE: Danke. Das war Teil 1.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record yourself" })).toHaveCount(0);
  await expect(page.getByText("1/1", { exact: true })).toBeVisible();
  // To look at (E2E_SHOTS: a folder): the part its time ended.
  if (process.env.E2E_SHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SHOTS}/time-up-${test.info().project.name}.png`,
    });
  // Handed in: the part ended by its time, nothing said.
  await page.getByRole("button", { name: "Hand in" }).filter({ visible: true }).first().click();
  await expect(page.getByText("Time is up: the examiner ended the part.")).toBeVisible();
});
