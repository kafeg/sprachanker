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
  // Mutations carry the app's client header (CSRF check, 06).
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

/** The picture question of the first exercise: Tom instead of Lena (wrong on purpose). */
export async function answerPicture(page: Page) {
  await page.locator("ol > li").nth(1).getByRole("button").nth(1).click();
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
