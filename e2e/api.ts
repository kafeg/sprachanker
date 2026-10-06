// Setting up server state for e2e tests. Projects share one profile, so each test starts from a known
// state instead of whatever an earlier (possibly failed) test left.
import { type APIRequestContext, expect, type Page } from "@playwright/test";

export const DEMO_LESSON = "sprachanker.fixture/demo/00-01";

async function send(
  request: APIRequestContext,
  method: "post" | "put",
  path: string,
  data: unknown,
) {
  // Mutations carry the app's client header (CSRF check, 06).
  const res = await request[method](path, { data, headers: { "x-sprachanker": "1" } });
  expect(res.ok()).toBe(true);
  return res.json();
}

export const put = (request: APIRequestContext, path: string, data: unknown) =>
  send(request, "put", path, data);

/** Starts the lesson anew (an empty active run), so it opens on its overview with nothing done. */
export async function freshLessonRun(request: APIRequestContext, lessonKey = DEMO_LESSON) {
  const series = lessonKey.split("/")[0];
  await send(request, "post", "/api/runs", { series, lessonKey, edition: "en-de", restart: true });
}

/** The picture question of the first exercise: Tom instead of Lena (wrong on purpose). */
export async function answerPicture(page: Page) {
  await page.locator("ol > li").nth(1).getByRole("button").nth(1).click();
}
