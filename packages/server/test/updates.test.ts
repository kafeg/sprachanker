import { describe, expect, test } from "bun:test";
import {
  CHECK_EVERY_MS,
  createUpdates,
  isNewer,
  RELEASE_FILES,
  RELEASES_LATEST,
  RETRY_MS,
  type ReleaseFile,
  type UpdateHost,
  versionNumbers,
} from "../src/services/updates.ts";
import { setup } from "./setup.ts";

const APK = "SprachAnker-0.3.700-android.apk";
const SUM = "a".repeat(64);

/** GitHub's answer for the latest release. */
const release = (version: string, more: Record<string, unknown> = {}) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/kafeg/sprachanker/releases/tag/v${version}`,
  draft: false,
  prerelease: false,
  assets: [
    {
      name: APK,
      browser_download_url: `${RELEASE_FILES}v${version}/${APK}`,
      size: 1234,
      digest: `sha256:${SUM}`,
    },
    {
      name: "other-android.apk",
      browser_download_url: "https://example.com/other-android.apk",
      size: 1,
      digest: null,
    },
  ],
  ...more,
});

/** A fetch answering the latest release (or failing), keeping the addresses asked. */
function releases(answer: () => unknown) {
  const asked: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    asked.push(String(url));
    const body = answer();
    if (body instanceof Error) throw body;
    return Response.json(body);
  }) as typeof globalThis.fetch;
  return { asked, fetch };
}

/** The phone's way: its APK picked, what it was asked to install kept. */
function phoneHost(fail = false) {
  const installed: ReleaseFile[] = [];
  const host: UpdateHost = {
    pick: (files) => files.find((f) => f.name.endsWith("-android.apk")),
    install: async (file) => {
      if (fail) throw new Error("the download broke off");
      installed.push(file);
    },
  };
  return { installed, host };
}

const program = { by: "program", system: "macos" } as const;
const phone = (host: UpdateHost) => ({ by: "phone", system: "android", host }) as const;

describe("versions", () => {
  test("MAJOR.MINOR.N read, with or without a v", () => {
    expect(versionNumbers("0.1.512")).toEqual([0, 1, 512]);
    expect(versionNumbers("v1.2.3")).toEqual([1, 2, 3]);
    expect(versionNumbers("1.2")).toBeUndefined();
    expect(versionNumbers("1.2.3-beta")).toBeUndefined();
    expect(versionNumbers("test")).toBeUndefined();
  });

  test("only a later version is newer: never the same, an earlier or a malformed one", () => {
    expect(isNewer("0.1.513", "0.1.512")).toBe(true);
    expect(isNewer("0.2.1", "0.1.999")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    // Numbers, not text: 10 > 9.
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("0.1.512", "0.1.512")).toBe(false);
    expect(isNewer("0.1.511", "0.1.512")).toBe(false);
    expect(isNewer("0.1.999", "0.2.0")).toBe(false);
    expect(isNewer("1.0", "0.1.1")).toBe(false);
    expect(isNewer("9.9.9", "dev")).toBe(false);
  });
});

describe("the update check", () => {
  test("a newer release is said with its page, and asked again only hours later", async () => {
    let at = 0;
    const gh = releases(() => release("0.3.700"));
    const updates = createUpdates({
      version: "0.2.600",
      update: program,
      fetch: gh.fetch,
      now: () => at,
    });
    expect(await updates.status()).toEqual({
      version: "0.2.600",
      by: "program",
      system: "macos",
      newer: {
        version: "0.3.700",
        url: "https://github.com/kafeg/sprachanker/releases/tag/v0.3.700",
      },
      installs: false,
    });
    expect(gh.asked).toEqual([RELEASES_LATEST]);
    at += CHECK_EVERY_MS - 1;
    await updates.status();
    expect(gh.asked).toHaveLength(1);
    at += 1;
    await updates.status();
    expect(gh.asked).toHaveLength(2);
  });

  test("the same version, an earlier one, a draft or a pre-release is no update", async () => {
    for (const answer of [
      release("0.2.600"),
      release("0.2.599"),
      release("0.9.0", { draft: true }),
      release("0.9.0", { prerelease: true }),
    ]) {
      const updates = createUpdates({
        version: "0.2.600",
        update: program,
        fetch: releases(() => answer).fetch,
        now: () => 0,
      });
      expect((await updates.status()).newer).toBeUndefined();
    }
  });

  test("a check that fails says nothing and is tried again after a while", async () => {
    let at = 0;
    let down = true;
    const gh = releases(() => (down ? new Error("offline") : release("0.3.700")));
    const updates = createUpdates({
      version: "0.2.600",
      update: program,
      fetch: gh.fetch,
      now: () => at,
    });
    expect((await updates.status()).newer).toBeUndefined();
    down = false;
    at += RETRY_MS - 1;
    expect((await updates.status()).newer).toBeUndefined();
    at += 1;
    expect((await updates.status()).newer?.version).toBe("0.3.700");
    expect(gh.asked).toHaveLength(2);
  });

  test("questions at the same time share one request", async () => {
    const gh = releases(() => release("0.3.700"));
    const updates = createUpdates({
      version: "0.2.600",
      update: program,
      fetch: gh.fetch,
      now: () => 0,
    });
    await Promise.all([updates.status(), updates.status(), updates.status()]);
    expect(gh.asked).toHaveLength(1);
  });

  test("a build from the sources asks for no release", async () => {
    const gh = releases(() => release("9.0.0"));
    const updates = createUpdates({ version: "0.2.600", fetch: gh.fetch, now: () => 0 });
    expect(await updates.status()).toEqual({ version: "0.2.600", by: "source", installs: false });
    expect(gh.asked).toHaveLength(0);
  });

  test("the phone installs the release's own APK with its sha256, never a file from elsewhere", async () => {
    const p = phoneHost();
    const updates = createUpdates({
      version: "0.2.600",
      update: phone(p.host),
      fetch: releases(() => release("0.3.700")).fetch,
      now: () => 0,
    });
    expect((await updates.status()).installs).toBe(true);
    await updates.install();
    expect(p.installed).toEqual([
      { name: APK, url: `${RELEASE_FILES}v0.3.700/${APK}`, size: 1234, sha256: SUM },
    ]);
  });

  test("nothing newer, or no host: nothing installed", async () => {
    const p = phoneHost();
    const same = createUpdates({
      version: "0.3.700",
      update: phone(p.host),
      fetch: releases(() => release("0.3.700")).fetch,
      now: () => 0,
    });
    expect((await same.status()).installs).toBe(false);
    await expect(same.install()).rejects.toMatchObject({ code: "no_update", status: 409 });
    const noHost = createUpdates({
      version: "0.2.600",
      update: program,
      fetch: releases(() => release("0.3.700")).fetch,
      now: () => 0,
    });
    await expect(noHost.install()).rejects.toMatchObject({ code: "no_update" });
    expect(p.installed).toEqual([]);
  });

  test("an install that fails is said as such", async () => {
    const updates = createUpdates({
      version: "0.2.600",
      update: phone(phoneHost(true).host),
      fetch: releases(() => release("0.3.700")).fetch,
      now: () => 0,
    });
    await expect(updates.install()).rejects.toMatchObject({ code: "update_failed", status: 502 });
  });
});

describe("/api/update", () => {
  test("a signed-in device reads the status and asks for the install", async () => {
    const p = phoneHost();
    const t = await setup({
      fetch: releases(() => release("0.3.700")).fetch,
      update: phone(p.host),
      appVersion: "0.2.600",
    });
    expect(await t.getJson("/api/update")).toMatchObject({
      by: "phone",
      newer: { version: "0.3.700" },
      installs: true,
    });
    expect((await t.send("POST", "/api/update/install", {})).status).toBe(200);
    expect(p.installed).toHaveLength(1);
  });

  test("a device not signed in can do neither", async () => {
    const t = await setup({ update: program });
    expect((await t.anonymous("GET", "/api/update")).status).toBe(401);
    expect((await t.anonymous("POST", "/api/update/install", {})).status).toBe(401);
  });
});
