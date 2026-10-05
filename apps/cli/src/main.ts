#!/usr/bin/env bun
// The `sprachanker` binary (spec 06, "CLI").
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  directoryAssets,
  fileAssets,
  importCourse,
  providerIds,
  resolveDataRoot,
  startServer,
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
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
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
  for (const [course, r] of Object.entries(report.normalised)) {
    log(
      `${course}: ${r.lessons} lessons, ${r.unknown} unknown exercises, ${r.problems} invalid files`,
    );
  }
  if (report.failedMedia.length) {
    log(`${report.failedMedia.length} media files failed (run again to retry):`);
    for (const line of report.failedMedia.slice(0, 20)) log(`  ${line}`);
    process.exitCode = 1;
  }
}

export async function main(argv: string[], embedded?: Embedded): Promise<void> {
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
    default:
      console.log(USAGE);
      process.exitCode = command === undefined || command === "help" ? 0 : 1;
  }
}

if (import.meta.main) await main(process.argv.slice(2));
