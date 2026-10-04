#!/usr/bin/env bun
// The `sprachanker` binary (spec 06, "CLI").
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { directoryAssets, startServer } from "@sprachanker/server";

const DEFAULT_PORT = 4580;
const USAGE = `Usage: sprachanker <command>

Commands:
  serve [--host <address>] [--port <number>]   start the server (default 127.0.0.1:${DEFAULT_PORT})`;

function serve(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: String(DEFAULT_PORT) },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`invalid --port: ${values.port}`);
  const server = startServer({
    hostname: values.host,
    port,
    // From sources: the web build next to this app. The compiled binary embeds it instead (stage 0 spike).
    webAssets: directoryAssets(resolve(import.meta.dir, "../../web/dist")),
  });
  console.log(`SprachAnker is running at ${server.url}`);
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "serve":
    serve(rest);
    break;
  default:
    console.log(USAGE);
    process.exitCode = command === undefined || command === "help" ? 0 : 1;
}
