import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { directoryAssets } from "../src/runtime/bun.ts";

const files: Record<string, Blob> = {
  "/index.html": new Blob(["<!doctype html>"], { type: "text/html" }),
  "/assets/app-1a2b.js": new Blob(["console.log(1)"], { type: "text/javascript" }),
};
const app = createApp({ webAssets: async (path) => files[path] });
const get = (path: string) => app.request(path);

describe("api", () => {
  test("health", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("unknown api route is a JSON 404, not the web app", async () => {
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("web app", () => {
  test("index is served without caching", async () => {
    const res = await get("/");
    expect(await res.text()).toBe("<!doctype html>");
    expect(res.headers.get("content-type")).toStartWith("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  test("hashed assets are immutable", async () => {
    const res = await get("/assets/app-1a2b.js");
    expect(res.headers.get("content-type")).toStartWith("text/javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  test("client routes fall back to index, missing files do not", async () => {
    expect(await (await get("/course/a1/lesson/3")).text()).toBe("<!doctype html>");
    expect((await get("/missing.png")).status).toBe(404);
  });
});

test("directory assets never leave their directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-web-"));
  const web = join(root, "web");
  writeFileSync(join(root, "secret.txt"), "secret");
  await Bun.write(join(web, "index.html"), "<!doctype html>");
  const assets = directoryAssets(web);
  expect(await (await assets("/index.html"))?.text()).toBe("<!doctype html>");
  expect(await assets("/../secret.txt")).toBeUndefined();
  expect(await assets("/")).toBeUndefined();
});
