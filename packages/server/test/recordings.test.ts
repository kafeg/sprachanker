import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { decodeTime, ulid } from "ulid";
import type { RecordingFiles } from "../src/services/profiles.ts";
import { createRecordings } from "../src/services/recordings.ts";
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
  expect(whole.headers.get("content-type")).toBe("video/webm");
  const part = await get(`/api/recordings/${id}`, { headers: { range: "bytes=10-19" } });
  expect(part.status).toBe(206);
  expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  ]);
  // The oldest kept: a recording made before it is gone.
  expect(await getJson("/api/recordings")).toEqual({
    count: 1,
    bytes: 1000,
    oldest: decodeTime(id),
  });

  // Not audio, empty, too large, without the client header: refused; an unknown id is 404.
  expect((await upload(audio, "text/plain")).status).toBe(415);
  expect((await upload(new Uint8Array(0), "audio/mp4")).status).toBe(400);
  expect((await upload(audio, "audio/mp4", { "content-length": "6000000" })).status).toBe(413);
  // Not announced: stopped while it streams.
  const streamed = await app.request("/api/recordings", {
    method: "POST",
    headers: { cookie, "content-type": "audio/mp4", ...CLIENT_HEADERS },
    body: new ReadableStream({
      start(controller) {
        for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(1_000_000));
        controller.close();
      },
    }),
  });
  expect(streamed.status).toBe(413);
  const noHeader = await app.request("/api/recordings", {
    method: "POST",
    headers: { cookie, "content-type": "audio/mp4" },
    body: audio,
  });
  expect(noHeader.status).toBe(403);
  expect((await get(`/api/recordings/${ulid()}`)).status).toBe(404);

  expect(await (await send("DELETE", "/api/recordings", {})).json()).toEqual({ removed: 1 });
  expect(await getJson("/api/recordings")).toEqual({ count: 0, bytes: 0, oldest: null });
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
  expect(await getJson("/api/recordings")).toEqual({ count: 0, bytes: 0, oldest: null });
});

test("takes no answer holds go once a day old; those answers hold, and newer ones, stay", () => {
  const day = 24 * 60 * 60_000;
  const now = Date.UTC(2026, 9, 9);
  const held = ulid(now - 3 * day);
  const unheld = ulid(now - 2 * day);
  const recent = ulid(now - 60_000);
  let names = [held, unheld, recent].map((id) => `${id}.webm`);
  const recordings = createRecordings(
    {
      list: () => names.map((name) => ({ name, size: 1 })),
      remove: (gone: string[]) => {
        names = names.filter((n) => !gone.includes(n));
      },
    } as unknown as RecordingFiles,
    () => now,
  );
  expect(recordings.removeUnused(new Set([held]), now - day)).toBe(1);
  expect(names).toEqual([`${held}.webm`, `${recent}.webm`]);
});
