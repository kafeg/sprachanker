#!/usr/bin/env bun
// The `sprachanker` binary (spec 06, "CLI").
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  directoryAssets,
  fileAssets,
  importCourse,
  profileAdmin,
  providerIds,
  resolveDataRoot,
  startServer,
  verifyData,
  type WebAssets,
} from "@sprachanker/server";
import pkg from "../package.json" with { type: "json" };

const DEFAULT_PORT = 4580;
const USAGE = `Usage: sprachanker <command>

Commands:
  serve  [--data <dir>] [--host <address>] [--port <number>]
         start the server (default 127.0.0.1:${DEFAULT_PORT})
  import <provider> [--data <dir>] [--courses a1,a2] [--editions ru-de,en-de] [--refresh]
         download and normalise a course; re-running fetches only what is missing
         providers: ${providerIds().join(", ")}
  verify [--data <dir>] [--notes]
         check every installed course: schemas, keys, answers, locale texts, media
  profiles [--data <dir>]
         list the profiles; every profile is equal in the app, these are the server's matters:
  profiles registration on|off     let new profiles be made from the app, or not (on by default)
  profiles delete <id>             delete a profile with its data

The data root holds library/ and profiles/: --data, else $SPRACHANKER_DATA, else the app-data folder.`;

export interface Embedded {
  /** URL path → embedded file path of the built web app (set by the compiled binary's entry). */
  webFiles: Record<string, string>;
}

const list = (value: string | undefined) =>
  value
    ?.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const log = (line: string) => console.log(`${new Date().toTimeString().slice(0, 8)} ${line}`);

function serve(args: string[], webAssets: WebAssets): void {
  const { values } = parseArgs({
    args,
    options: {
      data: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: String(DEFAULT_PORT) },
    },
  });
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port) || port > 65535) {
    throw new Error(`invalid --port: ${values.port}`);
  }
  const dataRoot = resolveDataRoot(values.data);
  const server = startServer({
    hostname: values.host,
    port,
    webAssets,
    dataRoot,
    appVersion: pkg.version,
  });
  console.log(`SprachAnker is running at ${server.url} (data: ${dataRoot})`);
}

async function importCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      data: { type: "string" },
      courses: { type: "string" },
      editions: { type: "string" },
      refresh: { type: "boolean", default: false },
    },
  });
  const provider = positionals[0];
  if (!provider) throw new Error(`which provider? ${providerIds().join(", ")}`);
  const report = await importCourse(provider, {
    dataRoot: resolveDataRoot(values.data),
    courses: list(values.courses),
    editions: list(values.editions),
    refresh: values.refresh,
    log,
  });
  const normalised = Object.entries(report.normalised);
  if (!normalised.length) {
    // Nothing matched --courses / --editions (a typo selects nothing).
    log(`nothing imported: no course of ${provider} matches the --courses / --editions given`);
    process.exitCode = 1;
  }
  for (const [course, r] of normalised) {
    log(
      `${course}: ${r.lessons} lessons, ${r.unknown} unknown exercises, ` +
        `${r.leftOut ? `${r.leftOut} questions left out, ` : ""}${r.problems} invalid files`,
    );
    if (r.problems) process.exitCode = 1;
  }
  if (report.goneMedia.length) {
    log(`${report.goneMedia.length} media files are not at the source (left out):`);
    for (const line of report.goneMedia.slice(0, 20)) log(`  ${line}`);
  }
  if (report.failedMedia.length) {
    log(`${report.failedMedia.length} media files failed (run again to retry):`);
    for (const line of report.failedMedia.slice(0, 20)) log(`  ${line}`);
    process.exitCode = 1;
  }
}

async function verifyCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { data: { type: "string" }, notes: { type: "boolean", default: false } },
  });
  const dataRoot = resolveDataRoot(values.data);
  const reports = await verifyData(dataRoot);
  if (!reports.length) {
    console.log(`no courses installed in ${dataRoot} (is --data right?)`);
    process.exitCode = 1;
  }
  for (const r of reports) {
    const types = Object.entries(r.exercises)
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${type} ${n}`)
      .join(", ");
    console.log(
      `${r.problems.length ? "✗" : "✓"} ${r.series}/${r.course} [${r.editions.join(", ")}]: ` +
        `${r.units} units, ${r.lessons} lessons, ${r.exams ? `${r.exams} exams, ` : ""}` +
        `${r.items} items, ${r.vocab} words, ` +
        `media ${r.media.referenced - r.media.missing}/${r.media.referenced}`,
    );
    if (types) console.log(`    exercises: ${types}`);
    for (const p of r.problems.slice(0, 30)) console.log(`    problem: ${p.text}`);
    if (r.problems.length > 30) console.log(`    … ${r.problems.length - 30} more problems`);
    const notes = values.notes ? r.notes : r.notes.slice(0, 3);
    for (const n of notes) console.log(`    note: ${n}`);
    if (!values.notes && r.notes.length > 3)
      console.log(`    … ${r.notes.length - 3} more notes (--notes)`);
  }
  if (reports.some((r) => r.problems.length)) process.exitCode = 1;
}

async function profilesCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { data: { type: "string" } },
  });
  const profiles = profileAdmin(resolveDataRoot(values.data));
  const [action, arg] = positionals;
  switch (action) {
    case undefined:
      for (const p of profiles.list()) console.log(`${p.id}  ${p.name || "(no name yet)"}`);
      console.log(`registration: ${profiles.registrationOpen() ? "on" : "off"}`);
      return;
    case "registration":
      if (arg !== "on" && arg !== "off") throw new Error("registration on or off?");
      profiles.setRegistration(arg === "on");
      console.log(`registration: ${arg}`);
      return;
    case "delete":
      if (!arg) throw new Error("which profile? (sprachanker profiles lists them)");
      profiles.remove(arg);
      console.log(`${arg}: deleted`);
      return;
    default:
      throw new Error(`unknown: profiles ${action}`);
  }
}

/** Runs a command; a failure is one line and exit code 1, never a stack trace. */
export async function main(argv: string[], embedded?: Embedded): Promise<void> {
  try {
    await run(argv, embedded);
  } catch (error) {
    console.error(`sprachanker: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function run(argv: string[], embedded?: Embedded): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "serve":
      serve(
        rest,
        // From sources: the web build next to this app (`bun run build:web`).
        embedded
          ? fileAssets(embedded.webFiles)
          : directoryAssets(resolve(import.meta.dir, "../../web/dist")),
      );
      break;
    case "import":
      await importCommand(rest);
      break;
    case "verify":
      await verifyCommand(rest);
      break;
    case "profiles":
      await profilesCommand(rest);
      break;
    default:
      console.log(USAGE);
      process.exitCode = command === undefined || command === "help" ? 0 : 1;
  }
}

if (import.meta.main) await main(process.argv.slice(2));
