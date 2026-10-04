// Bun-specific adapters. Everything else in the server stays runtime-agnostic (Node fallback).
import { statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { WebAssets } from "../web.ts";

export interface Listening {
  url: string;
  stop(): Promise<void>;
}

export function listen(
  fetch: (request: Request) => Response | Promise<Response>,
  options: { hostname: string; port: number },
): Listening {
  const server = Bun.serve({ fetch, hostname: options.hostname, port: options.port });
  return { url: server.url.href, stop: () => server.stop() };
}

/** Web assets read from a directory on disk; paths outside it are never served. */
export function directoryAssets(dir: string): WebAssets {
  const root = resolve(dir);
  return async (path) => {
    const full = resolve(root, `.${path}`);
    if (!full.startsWith(root + sep) || !statSync(full, { throwIfNoEntry: false })?.isFile()) {
      return undefined;
    }
    return Bun.file(full);
  };
}

/** Web assets from a URL path → file path map (files embedded in the compiled binary). */
export function fileAssets(files: Record<string, string>): WebAssets {
  return async (path) => {
    const file = files[path];
    return file === undefined ? undefined : Bun.file(file);
  };
}
