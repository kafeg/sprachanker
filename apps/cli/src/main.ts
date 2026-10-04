#!/usr/bin/env bun
// The `sprachanker` binary (spec 06, "CLI").
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { directoryAssets, fileAssets, startServer, type WebAssets } from "@sprachanker/server";

const DEFAULT_PORT = 4580;
const USAGE = `Usage: sprachanker <command>

Commands:
  serve [--host <address>] [--port <number>]   start the server (default 127.0.0.1:${DEFAULT_PORT})`;

export interface Embedded {
  /** URL path → embedded file path of the built web app (set by the compiled binary's entry). */
  webFiles: Record<string, string>;
}

function serve(args: string[], webAssets: WebAssets): void {
  const { values } = parseArgs({
    args,
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: String(DEFAULT_PORT) },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port: ${values.port}`);
  }
  const server = startServer({ hostname: values.host, port, webAssets });
  console.log(`SprachAnker is running at ${server.url}`);
}

export function main(argv: string[], embedded?: Embedded): void {
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
    default:
      console.log(USAGE);
      process.exitCode = command === undefined || command === "help" ? 0 : 1;
  }
}

if (import.meta.main) main(process.argv.slice(2));
