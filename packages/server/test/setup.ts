// A test app over the fixture library and a fresh profile database.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixtureLibrary } from "@sprachanker/course-fixture";
import { openLibrary } from "@sprachanker/course-kit";
import { createApp } from "../src/app.ts";
import { mediaBlob, openProfileDb } from "../src/runtime/bun.ts";
import type { CourseInstaller } from "../src/services/downloads.ts";
import type { CliHost, LmStudioHost } from "../src/services/llm.ts";

const files: Record<string, Blob> = {
  "/index.html": new Blob(["<!doctype html>"], { type: "text/html" }),
  "/assets/app-1a2b.js": new Blob(["console.log(1)"], { type: "text/javascript" }),
};

export async function setup(
  options: {
    fetch?: typeof fetch;
    lmStudio?: LmStudioHost;
    cli?: CliHost;
    installer?: CourseInstaller;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-data-"));
  await writeFixtureLibrary(join(root, "library"));
  let clock = 1_000;
  const profile = openProfileDb(join(root, "profiles/local/profile.sqlite"));
  const app = createApp({
    webAssets: async (path) => files[path],
    library: openLibrary(join(root, "library")),
    profile,
    mediaBlob,
    appVersion: "test",
    secretKey: new Uint8Array(32).fill(7),
    fetch: options.fetch,
    lmStudio: options.lmStudio,
    cli: options.cli,
    installer: options.installer,
    now: () => (clock += 1000),
  });
  const get = (path: string, init?: RequestInit) => app.request(path, init);
  const send = (method: string, path: string, body: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", "x-sprachanker": "1" },
      body: JSON.stringify(body),
    });
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
  const getJson = async (path: string): Promise<any> => (await get(path)).json();
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
  const sendJson = async (method: string, path: string, body: unknown): Promise<any> =>
    (await send(method, path, body)).json();
  return { app, root, profile, get, send, getJson, sendJson };
}
