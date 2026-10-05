// Polite HTTP client for importers (03): ≤ 1 request per interval per host, robots.txt, retries with
// backoff, identifiable User-Agent, stop on 403/429.
import { isAllowed, parseRobots, type RobotsRules } from "./robots.ts";

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
  /** Minimum time between the starts of two requests to the same host. */
  intervalMs?: number;
  retries?: number;
  /** Hosts whose robots.txt is checked; others (media CDNs) are only rate-limited. */
  robotsHosts?: string[];
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface PoliteFetcher {
  get(url: string): Promise<Response>;
}

export function createPoliteFetcher(options: PoliteFetcherOptions): PoliteFetcher {
  const interval = options.intervalMs ?? 1000;
  const retries = options.retries ?? 3;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const queues = new Map<string, Promise<unknown>>();
  const last = new Map<string, number>();
  const refused = new Map<string, number>();
  const robots = new Map<string, Promise<RobotsRules>>();

  /** Runs `task` after the previous request to the same host, at least `interval` later. */
  function onHost<T>(host: string, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(host) ?? Promise.resolve()).then(async () => {
      const wait = (last.get(host) ?? 0) + interval - Date.now();
      if (wait > 0) await sleep(wait);
      last.set(host, Date.now());
      return task();
    });
    queues.set(
      host,
      run.catch(() => {}),
    );
    return run;
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

  return {
    async get(href) {
      const url = new URL(href);
      const status = refused.get(url.host);
      if (status) throw new HostRefusedError(url.host, status);
      if (!isAllowed(await rulesFor(url), decodeURIComponent(url.pathname) + url.search)) {
        throw new FetchFailedError(href, "robots");
      }
      for (let attempt = 0; ; attempt++) {
        const res = await onHost(url.host, () => doFetch(url, { headers })).catch(() => null);
        if (res?.ok) return res;
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
    },
  };
}
