// HTTP client for importers (03): robots.txt, retries with backoff, identifiable User-Agent, stop on
// 403/429, optional minimum interval between request starts per host (none by default).
import { isAllowed, parseRobots, type RobotsRules } from "./robots.ts";

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
}

export interface PoliteFetcher {
  /** The whole body; a connection lost while reading it is retried like a failed request. */
  bytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  text(url: string): Promise<string>;
}

export function createPoliteFetcher(options: PoliteFetcherOptions): PoliteFetcher {
  const interval = options.intervalMs ?? 0;
  const retries = options.retries ?? 3;
  const doFetch = options.fetch ?? fetch;
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

  function rulesFor(url: URL): Promise<RobotsRules> {
    if (!options.robotsHosts?.includes(url.host)) return Promise.resolve([]);
    let rules = robots.get(url.host);
    if (!rules) {
      rules = onHost(url.host, async () => {
        const res = await doFetch(`${url.origin}/robots.txt`, { headers });
        return res.ok ? parseRobots(await res.text()) : [];
      });
      robots.set(url.host, rules);
    }
    return rules;
  }

  /** A request with retries; `read` turns the response into the result and is retried with it. */
  async function request<T>(href: string, read: (res: Response) => Promise<T>): Promise<T> {
    const url = new URL(href);
    const status = refused.get(url.host);
    if (status) throw new HostRefusedError(url.host, status);
    if (!isAllowed(await rulesFor(url), decodeURIComponent(url.pathname) + url.search)) {
      throw new FetchFailedError(href, "robots");
    }
    for (let attempt = 0; ; attempt++) {
      const res = await onHost(url.host, () => doFetch(url, { headers })).catch(() => null);
      if (res?.ok) {
        try {
          return await read(res);
        } catch {
          // The connection broke while reading the body: like a network failure.
          if (attempt >= retries) throw new FetchFailedError(href, "network");
          await sleep(2000 * 2 ** attempt);
          continue;
        }
      }
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

  return {
    bytes: (href) =>
      request(href, async (res) => ({
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "",
      })),
    text: (href) => request(href, (res) => res.text()),
  };
}
