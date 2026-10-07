// HTTP client for importers (03): robots.txt, retries with backoff, identifiable User-Agent, stop on
// 403/429, optional minimum interval between request starts per host (none by default), and a limit on
// silence (a stalled connection is retried, never waited on forever).
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { isAllowed, parseRobots, type RobotsRules } from "./robots.ts";

/** Silence allowed before a response starts and between chunks of its body. */
const IDLE_MS = 60_000;

/** How every importer introduces itself (03: identifiable User-Agent). */
export const IMPORTER_USER_AGENT =
  "SprachAnker/0.1 (personal-use course importer; +https://github.com/kafeg/sprachanker)";

export class HostRefusedError extends Error {
  constructor(
    readonly host: string,
    readonly status: number,
  ) {
    super(`${host} refused with HTTP ${status}; stopped requests to this host`);
  }
}

export class FetchFailedError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | "network" | "robots",
  ) {
    super(`${url}: ${status}`);
  }
}

export interface PoliteFetcherOptions {
  userAgent: string;
  /** Minimum time between the starts of two requests to the same host; 0 (default) = no limit. */
  intervalMs?: number;
  retries?: number;
  /** Hosts whose robots.txt is checked; others (media CDNs) are only rate-limited. */
  robotsHosts?: string[];
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Silence allowed (tests shorten it). */
  idleMs?: number;
}

export interface PoliteFetcher {
  /** The whole body; a connection lost while reading it is retried like a failed request. */
  bytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  text(url: string): Promise<string>;
  /** The body streamed into `target` (large media never sit in memory); retried like `bytes`. */
  file(url: string, target: string): Promise<{ contentType: string }>;
}

/** Aborts after `ms` of silence; `alive()` restarts the count. */
function silence(ms: number) {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(), ms);
  };
  alive();
  return { signal: ctl.signal, alive, stop: () => clearTimeout(timer) };
}

/** The silence of one attempt: its signal, `alive()` when data arrives. */
type Quiet = ReturnType<typeof silence>;

/**
 * Reads a body chunk by chunk, telling `quiet` each time data arrives; silence for too long cancels
 * the read (whatever the fetch implementation does with the signal) and fails it.
 */
async function* chunks(res: Response, quiet: Quiet): AsyncIterable<Uint8Array> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  quiet.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (quiet.signal.aborted) throw new Error("the connection went silent");
      if (done) return;
      quiet.alive();
      yield value;
    }
  } finally {
    quiet.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export function createPoliteFetcher(options: PoliteFetcherOptions): PoliteFetcher {
  const interval = options.intervalMs ?? 0;
  const retries = options.retries ?? 3;
  const doFetch = options.fetch ?? fetch;
  const idleMs = options.idleMs ?? IDLE_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const queues = new Map<string, Promise<unknown>>();
  const last = new Map<string, number>();
  const refused = new Map<string, number>();
  const robots = new Map<string, Promise<RobotsRules>>();

  /**
   * Starts `task` at least `interval` after the previous start on the same host. Requests may
   * overlap (a slow response does not delay the next start), so callers can run several at once.
   */
  function onHost<T>(host: string, task: () => Promise<T>): Promise<T> {
    const slot = (queues.get(host) ?? Promise.resolve()).then(async () => {
      const wait = (last.get(host) ?? 0) + interval - Date.now();
      if (wait > 0) await sleep(wait);
      last.set(host, Date.now());
    });
    queues.set(host, slot);
    return slot.then(task);
  }

  const headers = { "User-Agent": options.userAgent };

  /** The host's robots rules, read once; a failure to read them is not kept (asked again next time),
   *  and a 403/429 on robots.txt stops the host like on any page. */
  function rulesFor(url: URL): Promise<RobotsRules> {
    if (!options.robotsHosts?.includes(url.host)) return Promise.resolve([]);
    let rules = robots.get(url.host);
    if (!rules) {
      rules = onHost(url.host, async () => {
        const res = await doFetch(`${url.origin}/robots.txt`, { headers }).catch(() => {
          throw new FetchFailedError(`${url.origin}/robots.txt`, "network");
        });
        if (res.status === 403 || res.status === 429) {
          refused.set(url.host, res.status);
          throw new HostRefusedError(url.host, res.status);
        }
        return res.ok ? parseRobots(await res.text()) : [];
      });
      robots.set(url.host, rules);
      rules.catch(() => robots.delete(url.host));
    }
    return rules;
  }

  /**
   * A request with retries; `read` turns the response into the result (told when data arrives) and
   * is retried with it. A response or body silent for too long counts as a failed connection.
   */
  async function request<T>(
    href: string,
    read: (res: Response, quiet: Quiet) => Promise<T>,
  ): Promise<T> {
    const url = new URL(href);
    const status = refused.get(url.host);
    if (status) throw new HostRefusedError(url.host, status);
    if (!isAllowed(await rulesFor(url), safeDecode(url.pathname) + url.search)) {
      throw new FetchFailedError(href, "robots");
    }
    for (let attempt = 0; ; attempt++) {
      const quiet = silence(idleMs);
      const res = await onHost(url.host, () =>
        doFetch(url, { headers, signal: quiet.signal }),
      ).catch(() => null);
      if (res?.ok) {
        try {
          return await read(res, quiet);
        } catch {
          // The connection broke (or went silent) while reading the body: like a network failure.
          if (attempt >= retries) throw new FetchFailedError(href, "network");
          await sleep(2000 * 2 ** attempt);
          continue;
        } finally {
          quiet.stop();
        }
      }
      quiet.stop();
      if (res && (res.status === 403 || res.status === 429)) {
        refused.set(url.host, res.status);
        throw new HostRefusedError(url.host, res.status);
      }
      const retryable = !res || res.status >= 500;
      if (!retryable || attempt >= retries) {
        throw new FetchFailedError(href, res ? res.status : "network");
      }
      await sleep(2000 * 2 ** attempt);
    }
  }

  const body = async (res: Response, quiet: Quiet) => {
    const parts: Uint8Array[] = [];
    for await (const part of chunks(res, quiet)) parts.push(part);
    return Buffer.concat(parts);
  };

  return {
    bytes: (href) =>
      request(href, async (res, quiet) => ({
        bytes: new Uint8Array(await body(res, quiet)),
        contentType: res.headers.get("content-type") ?? "",
      })),
    text: (href) =>
      request(href, async (res, quiet) => new TextDecoder().decode(await body(res, quiet))),
    file: (href, target) =>
      request(href, async (res, quiet) => {
        await mkdir(dirname(target), { recursive: true });
        const out = createWriteStream(target);
        try {
          for await (const part of chunks(res, quiet))
            if (!out.write(part)) await new Promise((r) => out.once("drain", r));
        } finally {
          await new Promise<void>((resolve, reject) =>
            out.end((error?: Error | null) => (error ? reject(error) : resolve())),
          );
        }
        return { contentType: res.headers.get("content-type") ?? "" };
      }),
  };
}

/** A URL path decoded for the robots rules; one with broken escapes is taken as written. */
function safeDecode(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
