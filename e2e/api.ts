// Setting up server state for e2e tests. Projects share one profile, so each test starts from a known
// state instead of whatever an earlier (possibly failed) test left.
import { type APIRequestContext, expect } from "@playwright/test";

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

/** Ends the lesson's active run, so the lesson opens on its overview. */
export async function finishLessonRun(request: APIRequestContext, lessonKey = DEMO_LESSON) {
  const series = lessonKey.split("/")[0];
  const { run } = await send(request, "post", "/api/runs", { series, lessonKey, edition: "en-de" });
  await send(request, "post", `/api/runs/${run.id}/finish`, {});
}
