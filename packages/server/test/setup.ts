// A test app over the fixture library: a fresh server database with one profile, signed in — every
// request carries its device cookie (`anonymous` sends one without it).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixtureLibrary } from "@sprachanker/course-fixture";
import { openLibrary } from "@sprachanker/course-kit";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { createApp } from "../src/app.ts";
import { mediaBlob, openServerDb, profileFiles } from "../src/runtime/bun.ts";
import { courseTransferFiles } from "../src/runtime/course-transfer.ts";
import { deckTransferFiles } from "../src/runtime/deck-transfer.ts";
import { apkgRuntime, deckFiles } from "../src/runtime/decks.ts";
import { practiceFiles } from "../src/runtime/practice.ts";
import { profileTransferFiles } from "../src/runtime/profile-transfer.ts";
import type { CourseTransferFiles } from "../src/services/course-transfer.ts";
import type { CourseInstaller } from "../src/services/downloads.ts";
import type { CliHost, LmStudioHost } from "../src/services/llm.ts";
import type { ReadingCache, SpeechHost } from "../src/services/local-engines.ts";
import type { ListensOn, NetworkHost } from "../src/services/network.ts";
import type { TransferFiles } from "../src/services/profile-transfer.ts";
import type { PiperHost } from "../src/services/read-aloud.ts";

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
    speech?: SpeechHost;
    piper?: PiperHost;
    readings?: ReadingCache;
    network?: NetworkHost;
    /** Where the server listens (default 127.0.0.1:4580). */
    listensOn?: ListensOn;
    /** Names given by `--allow-host`. */
    allowHosts?: string[];
    /** Profile files exported and imported: the runtime's over the data root unless given. */
    transfers?: (dataRoot: string) => TransferFiles;
    /** Course bundles exported and imported: the runtime's over the data root unless given. */
    courseTransfers?: (dataRoot: string) => CourseTransferFiles;
    /** Without the fixture course: an empty library (a second machine). */
    empty?: boolean;
    /** Changes the fixture library before the app opens it (an item the fixture course lacks). */
    editLibrary?: (libraryRoot: string) => void;
    /** What the AI practice draws (a text's genre, ideas, voices); Math.random unless given. */
    random?: () => number;
    /** The session also in a header both ways, as the phone app runs the server. */
    sessionInHeader?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-data-"));
  if (!options.empty) await writeFixtureLibrary(join(root, "library"));
  options.editLibrary?.(join(root, "library"));
  let clock = 1_000;
  const profiles = profileFiles(root);
  const app = createApp({
    webAssets: async (path) => files[path],
    library: openLibrary(join(root, "library")),
    server: openServerDb(join(root, "server.sqlite")),
    profiles,
    mediaBlob,
    decks: deckFiles(root),
    apkg: apkgRuntime,
    transfers: options.transfers?.(root) ?? profileTransferFiles(root),
    courseTransfers: options.courseTransfers?.(root) ?? courseTransferFiles(root),
    deckTransfers: deckTransferFiles(root),
    practice: practiceFiles(root),
    appVersion: "test",
    secretKey: new Uint8Array(32).fill(7),
    fetch: options.fetch,
    lmStudio: options.lmStudio,
    cli: options.cli,
    installer: options.installer,
    speech: options.speech,
    piper: options.piper,
    readings: options.readings,
    network: options.network,
    listensOn: options.listensOn ?? { hostname: "127.0.0.1", port: 4580 },
    allowHosts: options.allowHosts,
    now: () => (clock += 1000),
    random: options.random,
    sessionInHeader: options.sessionInHeader,
  });
  const json = { "content-type": "application/json", ...CLIENT_HEADERS };
  // The first profile, signed in on this "device".
  const made = await app.request("/api/profiles", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ name: "Test" }),
  });
  const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  /** The first sign-in's answer (its headers: where the session was given). */
  const signedIn = made;
  const profile = profiles.open("local");
  const withCookie = (init: RequestInit = {}) => ({
    ...init,
    headers: { cookie, ...(init.headers as Record<string, string>) },
  });
  const get = (path: string, init?: RequestInit) => app.request(path, withCookie(init));
  const send = (method: string, path: string, body: unknown) =>
    app.request(path, withCookie({ method, headers: json, body: JSON.stringify(body) }));
  /** A request from a device that is not signed in. */
  const anonymous = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      method,
      headers: { ...json, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
  const getJson = async (path: string): Promise<any> => (await get(path)).json();
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
  const sendJson = async (method: string, path: string, body: unknown): Promise<any> =>
    (await send(method, path, body)).json();
  /** Moves the server's clock on (each reading of it still adds a second). */
  const advance = (ms: number) => {
    clock += ms;
  };
  return {
    signedIn,
    app,
    root,
    profile,
    profiles,
    cookie,
    get,
    send,
    getJson,
    sendJson,
    anonymous,
    advance,
  };
}
