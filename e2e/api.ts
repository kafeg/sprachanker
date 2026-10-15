// Setting up server state for e2e tests. Projects share one profile, so each test starts from a known
// state instead of whatever an earlier (possibly failed) test left.
import { type APIRequestContext, expect, type Locator, type Page } from "@playwright/test";
import { CLIENT_HEADERS } from "@sprachanker/schema";

export const DEMO_LESSON = "sprachanker.fixture/demo/00-01";

async function send(
  request: APIRequestContext,
  method: "post" | "put",
  path: string,
  data: unknown,
) {
  // Mutations carry the app's client header (CSRF check).
  const res = await request[method](path, { data, headers: { ...CLIENT_HEADERS } });
  expect(res.ok()).toBe(true);
  return res.json();
}

export const put = (request: APIRequestContext, path: string, data: unknown) =>
  send(request, "put", path, data);
export const post = (request: APIRequestContext, path: string, data: unknown) =>
  send(request, "post", path, data);

/** Starts the lesson anew (an empty active run), so it opens on its overview with nothing done. */
export async function freshLessonRun(request: APIRequestContext, lessonKey = DEMO_LESSON) {
  const series = lessonKey.split("/")[0];
  await send(request, "post", "/api/runs", { series, lessonKey, edition: "en-de", restart: true });
}

type PracticeStep = "reading" | "listening" | "writing" | "speaking";
const practiceIds = (lessonKey: string) => ({
  series: lessonKey.split("/")[0] as string,
  lessonKey,
  edition: "en-de",
});

/** At least `count` variants of a lesson step in the course's practice (a lesson makes none — owner,
 *  2026-10-15: the fake model makes them here, through a run of the lesson, which takes one). Before
 *  the test's own reset and fresh run: those leave the lesson's start to take its first. */
export async function fillPractice(
  request: APIRequestContext,
  step: PracticeStep,
  count = 1,
  lessonKey = DEMO_LESSON,
) {
  const ids = practiceIds(lessonKey);
  const query = new URLSearchParams(ids).toString();
  const made = (await (await request.get(`/api/llm/practice/lesson?${query}`)).json())[step].made;
  if (made >= count) return;
  await freshLessonRun(request, lessonKey);
  const path =
    step === "writing"
      ? "/api/llm/writing/task"
      : step === "speaking"
        ? "/api/llm/talk"
        : "/api/llm/understanding";
  const body = { ...ids, language: "en", count: count - made };
  await send(
    request,
    "post",
    path,
    step === "writing" || step === "speaking" ? body : { ...body, step },
  );
}

/** The lesson's start has taken the step's first variant into its run. */
export async function practiceTaken(
  request: APIRequestContext,
  step: PracticeStep,
  lessonKey = DEMO_LESSON,
) {
  const query = new URLSearchParams(practiceIds(lessonKey)).toString();
  const state =
    step === "writing"
      ? `/api/llm/writing?${query}`
      : step === "speaking"
        ? `/api/llm/talk?lessonKey=${lessonKey}`
        : `/api/llm/understanding?lessonKey=${lessonKey}&step=${step}`;
  await expect
    .poll(async () => {
      const shown = await (await request.get(state)).json();
      return step === "writing" || step === "speaking" ? !!shown.task : shown.texts.length > 0;
    })
    .toBe(true);
}

/** A fresh event id: a ULID (Crockford's base 32, 26 characters) of now and random bits. */
const eventId = () => {
  const ABC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i++, time = Math.floor(time / 32)) head = ABC[time % 32] + head;
  const tail = Array.from({ length: 16 }, () => ABC[Math.floor(Math.random() * 32)]).join("");
  return head + tail;
};

/** Begins the demo course for the profile (it is then in My courses): a lesson run with one item
 *  skipped. */
export async function beginCourse(request: APIRequestContext, lessonKey = DEMO_LESSON) {
  const series = lessonKey.split("/")[0];
  const { run } = await send(request, "post", "/api/runs", { series, lessonKey, edition: "en-de" });
  await send(request, "post", `/api/runs/${run.id}/events`, {
    events: [{ id: eventId(), type: "item_skipped", itemKey: `${lessonKey}/ex-01#1`, payload: {} }],
  });
}

/** The picture question of the first exercise: Lena instead of Tom (wrong on purpose). Found by its
 *  picture: options are shown in an order of their own in every pass. */
export async function answerPicture(page: Page) {
  await page.locator("ol > li").nth(1).locator("[role=button]:has(img[src*='lena'])").click();
}

/** Drags with small pointer moves, as a hand would (a drag starts after a short move). */
export async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("nothing to drag");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  // dnd-kit swallows clicks for 50 ms after a drop, so the drop is not also a tap; a hand is slower.
  await page.waitForTimeout(100);
}

/** Opens a lesson (started anew by the test) at one of its steps, by its title in the plan. */
export async function openStep(page: Page, step: string, lesson = DEMO_LESSON) {
  await page.goto(`/lesson/${lesson}`);
  await page.getByRole("button", { name: "Start lesson" }).click();
  await goToStep(page, step);
}

/** Goes to a step of the open lesson through its plan (a sheet on a phone, opened and closed). */
export async function goToStep(page: Page, step: string) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The player's header is there (after a reload the lesson loads first): only then does the plan's
  // button say whether this is a phone.
  await expect(page.getByRole("button", { name: "Reference" })).toBeVisible();
  const plan = page.getByRole("button", { name: "Lesson plan" });
  if (await plan.isVisible()) await plan.click();
  await page.getByRole("button", { name: step }).filter({ visible: true }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** A microphone for the page: a tone from WebAudio instead of a device (browsers under test have no
 *  reliable fake one), so recording runs the same in Chromium and WebKit. Where the browser has no
 *  MediaRecorder (Playwright's WebKit on Linux), one that hands over half a second of the tone as WAV. */
export async function fakeMicrophone(page: Page) {
  // A script for the page (the e2e code has no DOM types). On the prototype: WebKit gives
  // `navigator.mediaDevices` only once the page is a secure one.
  await page.addInitScript({
    content: `if (typeof MediaDevices !== "undefined")
      MediaDevices.prototype.getUserMedia = async () => {
        const context = new AudioContext();
        const tone = context.createOscillator();
        const out = context.createMediaStreamDestination();
        tone.connect(out);
        tone.start();
        return out.stream;
      };
    if (typeof MediaRecorder === "undefined") {
      const tone = () => {
        const rate = 16000, n = rate / 2, bytes = new DataView(new ArrayBuffer(44 + n * 2));
        const text = (at, s) => [...s].forEach((c, i) => bytes.setUint8(at + i, c.charCodeAt(0)));
        text(0, "RIFF"); bytes.setUint32(4, 36 + n * 2, true); text(8, "WAVEfmt ");
        bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
        bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 2, true);
        bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); text(36, "data");
        bytes.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++)
          bytes.setInt16(44 + i * 2, Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), true);
        return new Blob([bytes.buffer], { type: "audio/wav" });
      };
      globalThis.MediaRecorder = class {
        static isTypeSupported() { return false; }
        constructor(stream) { this.stream = stream; this.state = "inactive"; this.mimeType = "audio/wav"; }
        start() { this.state = "recording"; }
        stop() {
          if (this.state === "inactive") return;
          this.state = "inactive";
          setTimeout(() => { this.ondataavailable?.({ data: tone() }); this.onstop?.(); });
        }
      };
    }`,
  });
}
