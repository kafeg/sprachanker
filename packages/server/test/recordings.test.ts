import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const SPEAKING = "sprachanker.fixture/demo/00-02";

test("recordings: saved as recorded, played with ranges, counted, removed; bad ones refused", async () => {
  const { app, cookie, get, getJson, send, root } = await setup();
  const upload = (body: Uint8Array, type: string, headers: Record<string, string> = {}) =>
    app.request("/api/recordings", {
      method: "POST",
      headers: { cookie, "content-type": type, ...CLIENT_HEADERS, ...headers },
      body,
    });
  const audio = new Uint8Array(1000).map((_, i) => i % 256);
  const saved = await upload(audio, "audio/webm;codecs=opus");
  expect(saved.status).toBe(200);
  const { id } = (await saved.json()) as { id: string };
  const dir = join(root, "profiles/local/recordings");
  expect(readdirSync(dir)).toEqual([`${id}.webm`]);

  const whole = await get(`/api/recordings/${id}`);
  expect([whole.status, (await whole.arrayBuffer()).byteLength]).toEqual([200, 1000]);
  const part = await get(`/api/recordings/${id}`, { headers: { range: "bytes=10-19" } });
  expect(part.status).toBe(206);
  expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  ]);
  expect(await getJson("/api/recordings")).toEqual({ count: 1, bytes: 1000 });

  // Not audio, empty, too large, without the client header: refused; an unknown id is 404.
  expect((await upload(audio, "text/plain")).status).toBe(415);
  expect((await upload(new Uint8Array(0), "audio/mp4")).status).toBe(400);
  expect((await upload(audio, "audio/mp4", { "content-length": "6000000" })).status).toBe(413);
  const noHeader = await app.request("/api/recordings", {
    method: "POST",
    headers: { cookie, "content-type": "audio/mp4" },
    body: audio,
  });
  expect(noHeader.status).toBe(403);
  expect((await get(`/api/recordings/${ulid()}`)).status).toBe(404);

  expect(await (await send("DELETE", "/api/recordings", {})).json()).toEqual({ removed: 1 });
  expect(await getJson("/api/recordings")).toEqual({ count: 0, bytes: 0 });
});

test("a speaking item answered with a recording; resetting the lesson removes the recording", async () => {
  const { app, cookie, sendJson, getJson, root } = await setup();
  const saved = await app.request("/api/recordings", {
    method: "POST",
    headers: { cookie, "content-type": "audio/mp4", ...CLIENT_HEADERS },
    body: new Uint8Array([1, 2, 3]),
  });
  const { id } = (await saved.json()) as { id: string };
  const { run } = await sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: SPEAKING,
    edition: "ru-de",
  });
  const stored = await sendJson("POST", `/api/runs/${run.id}/events`, {
    events: [
      {
        id: ulid(),
        type: "answered",
        itemKey: `${SPEAKING}/ex-02#1`,
        payload: { answer: { recording: id }, attempt: 1, ms: 1 },
      },
    ],
  });
  expect(Object.values(stored.outcomes)).toMatchObject([{ result: "unscored" }]);
  // An answer from before recordings (a self-rating) still reads.
  await sendJson("POST", `/api/runs/${run.id}/events`, {
    events: [
      {
        id: ulid(),
        type: "answered",
        itemKey: `${SPEAKING}/ex-02#2`,
        payload: { answer: { rating: "good" }, attempt: 1, ms: 1 },
      },
    ],
  });
  expect(existsSync(join(root, "profiles/local/recordings", `${id}.m4a`))).toBe(true);
  await sendJson("POST", "/api/progress/reset", {
    series: FIXTURE_SERIES,
    course: "demo",
    lesson: SPEAKING,
  });
  expect(existsSync(join(root, "profiles/local/recordings", `${id}.m4a`))).toBe(false);
  expect(await getJson("/api/recordings")).toEqual({ count: 0, bytes: 0 });
});
