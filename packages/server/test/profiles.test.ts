import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_SERIES, writeFixtureLibrary } from "@sprachanker/course-fixture";
import { openLibrary } from "@sprachanker/course-kit";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { createApp } from "../src/app.ts";
import { profileAdmin } from "../src/index.ts";
import { mediaBlob, openProfileDb, openServerDb, profileFiles } from "../src/runtime/bun.ts";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
// biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
const read = async (res: Response | Promise<Response>): Promise<any> => (await res).json();
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

test("without a session only who is studying and signing in answer; the rest is 401", async () => {
  const { anonymous } = await setup();
  const list = await read(anonymous("GET", "/api/profiles"));
  expect(list).toEqual({
    profiles: [
      {
        id: "local",
        name: "Test",
        colour: "amber",
        onboarded: false,
      },
    ],
    registration: true,
  });
  expect((await anonymous("GET", "/api/session")).status).toBe(200);
  expect(await read(anonymous("GET", "/api/session"))).toEqual({ profile: null });
  for (const path of ["/api/courses", "/api/settings", "/api/llm", "/api/cards", "/api/notebook"])
    expect((await anonymous("GET", path)).status).toBe(401);
});

test("two profiles: each its own progress; choosing one signs it in", async () => {
  const { sendJson, anonymous } = await setup();
  await sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
  });
  const made = await anonymous("POST", "/api/profiles", { name: "Anna" });
  const anna = (await read(made)).profile;
  expect(anna).toMatchObject({ name: "Anna", colour: "teal", onboarded: false });
  const cookie = cookieOf(made);
  expect(cookie).toMatch(/^sprachanker_device=/);
  const asAnna = (path: string) => anonymous("GET", path, undefined, { cookie });
  // Anna's lesson has no run; the first profile's has one.
  const state = async (get: (p: string) => Response | Promise<Response>) =>
    (await read(get(`/api/runs/lesson?series=${FIXTURE_SERIES}&lessonKey=${LESSON}`))).state;
  expect(await state(asAnna)).toBeNull();
  expect(await read(asAnna("/api/session"))).toMatchObject({ profile: { id: anna.id } });
  // Signing in again from another device by choosing her profile.
  const again = await anonymous("POST", "/api/session", { profile: anna.id });
  expect(again.status).toBe(200);
  expect(cookieOf(again)).not.toBe(cookie);
});

test("a profile deletes itself with everything it holds; this device is signed out; the others stay", async () => {
  const { sendJson, anonymous, root } = await setup();
  await sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
  });
  const made = await anonymous("POST", "/api/profiles", { name: "Anna" });
  const anna = (await read(made)).profile;
  const cookie = cookieOf(made);
  const asAnna = (method: string, path: string) => anonymous(method, path, {}, { cookie });
  expect(existsSync(join(root, "profiles", anna.id, "profile.sqlite"))).toBe(true);
  const gone = await asAnna("DELETE", "/api/profile");
  expect(gone.status).toBe(200);
  expect(gone.headers.get("set-cookie")).toMatch(/sprachanker_device=;/);
  // Her folder and her place on the list are gone; her device no longer signs in.
  expect(existsSync(join(root, "profiles", anna.id))).toBe(false);
  const list = await read(anonymous("GET", "/api/profiles"));
  expect(list.profiles.map((p: { name: string }) => p.name)).toEqual(["Test"]);
  expect((await asAnna("GET", "/api/courses")).status).toBe(401);
  // The other profile keeps its progress.
  const state = await read(
    anonymous("GET", `/api/runs/lesson?series=${FIXTURE_SERIES}&lessonKey=${LESSON}`, undefined, {
      cookie: cookieOf(await anonymous("POST", "/api/session", { profile: "local" })),
    }),
  );
  expect(state.state).not.toBeNull();
});

test("devices: listed with the current one; one signed out; signing out ends the session", async () => {
  const { getJson, send, get, anonymous } = await setup();
  const other = cookieOf(await anonymous("POST", "/api/session", { profile: "local" }));
  const { devices } = await getJson("/api/profile/devices");
  expect(devices.map((d: { current: boolean }) => d.current).sort()).toEqual([false, true]);
  const theOther = devices.find((d: { current: boolean }) => !d.current);
  expect((await send("DELETE", `/api/profile/devices/${theOther.id}`, {})).status).toBe(200);
  expect((await anonymous("GET", "/api/courses", undefined, { cookie: other })).status).toBe(401);
  expect((await send("DELETE", "/api/session", {})).status).toBe(200);
  expect((await get("/api/courses")).status).toBe(401);
});

test("the server's matters: registration closed refuses new profiles; delete by the command", async () => {
  const { root, anonymous } = await setup();
  const admin = profileAdmin(root);
  admin.setRegistration(false);
  const refused = await anonymous("POST", "/api/profiles", { name: "Late" });
  expect([refused.status, await read(refused)]).toEqual([403, { error: "registration_closed" }]);
  expect((await read(anonymous("GET", "/api/profiles"))).registration).toBe(false);
  admin.setRegistration(true);
  const late = (await read(anonymous("POST", "/api/profiles", { name: "Late" }))).profile;
  admin.remove(late.id);
  expect(admin.list().map((p) => p.id)).toEqual(["local"]);
  expect(profileFiles(root).exists(late.id)).toBe(false);
});

test("the single profile from before profiles existed becomes the first one, not yet onboarded", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-data-"));
  await writeFixtureLibrary(join(root, "library"));
  openProfileDb(join(root, "profiles/local/profile.sqlite"));
  const app = createApp({
    webAssets: async () => undefined,
    library: openLibrary(join(root, "library")),
    server: openServerDb(join(root, "server.sqlite")),
    profiles: profileFiles(root),
    mediaBlob,
    appVersion: "test",
    secretKey: new Uint8Array(32).fill(7),
  });
  const { profiles } = await read(app.request("/api/profiles"));
  expect(profiles).toEqual([{ id: "local", name: "", colour: "amber", onboarded: false }]);
  const signedIn = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...CLIENT_HEADERS },
    body: JSON.stringify({ profile: "local" }),
  });
  expect(signedIn.status).toBe(200);
  // Adopted without a name, it ends its onboarding only once it has one.
  const finish = await app.request("/api/profile", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: cookieOf(signedIn), ...CLIENT_HEADERS },
    body: JSON.stringify({ onboarded: true }),
  });
  expect([finish.status, await read(finish)]).toEqual([400, { error: "name_required" }]);
});

test("a profile always has a name: none to create one, none to keep, none to end the onboarding", async () => {
  const { send, anonymous } = await setup();
  for (const name of ["", "   "])
    expect((await anonymous("POST", "/api/profiles", { name })).status).toBe(400);
  expect((await anonymous("POST", "/api/profiles", {})).status).toBe(400);
  expect((await send("PUT", "/api/profile", { name: " " })).status).toBe(400);
  const named = await read(send("PUT", "/api/profile", { name: "  Vitaly ", onboarded: true }));
  expect(named.profile).toMatchObject({ name: "Vitaly", onboarded: true });
});
