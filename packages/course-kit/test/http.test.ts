import { expect, test } from "bun:test";
import { createPoliteFetcher, FetchFailedError, HostRefusedError } from "../src/http.ts";

function fake(responses: Record<string, number[]>) {
  const calls: string[] = [];
  const fetchFn = (async (input: URL | string) => {
    const url = String(input);
    calls.push(url);
    const queue = responses[url] ?? [200];
    const status = queue.length > 1 ? (queue.shift() as number) : (queue[0] as number);
    return new Response(url.endsWith("robots.txt") ? "User-agent: *\nDisallow: /secret" : "ok", {
      status,
    });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const opts = (fetchFn: typeof fetch) => ({
  userAgent: "test",
  intervalMs: 0,
  robotsHosts: ["a.test"],
  fetch: fetchFn,
  sleep: async () => {},
});

test("retries server errors, then succeeds", async () => {
  const { calls, fetchFn } = fake({ "https://b.test/x": [500, 503, 200] });
  const res = await createPoliteFetcher(opts(fetchFn)).get("https://b.test/x");
  expect(res.status).toBe(200);
  expect(calls).toEqual(["https://b.test/x", "https://b.test/x", "https://b.test/x"]);
});

test("respects robots.txt on listed hosts", async () => {
  const { fetchFn } = fake({});
  const fetcher = createPoliteFetcher(opts(fetchFn));
  await expect(fetcher.get("https://a.test/secret/1")).rejects.toBeInstanceOf(FetchFailedError);
  expect((await fetcher.get("https://a.test/open")).status).toBe(200);
});

test("403 stops the host for good, 404 fails one URL", async () => {
  const { calls, fetchFn } = fake({
    "https://b.test/forbidden": [403],
    "https://b.test/missing": [404],
  });
  const fetcher = createPoliteFetcher(opts(fetchFn));
  await expect(fetcher.get("https://b.test/missing")).rejects.toBeInstanceOf(FetchFailedError);
  await expect(fetcher.get("https://b.test/forbidden")).rejects.toBeInstanceOf(HostRefusedError);
  await expect(fetcher.get("https://b.test/other")).rejects.toBeInstanceOf(HostRefusedError);
  expect(calls).not.toContain("https://b.test/other");
});

test("starts are spaced by the interval while slow requests overlap", async () => {
  const starts: number[] = [];
  const slow = (async () => {
    starts.push(Date.now());
    await Bun.sleep(150);
    return new Response("ok");
  }) as unknown as typeof fetch;
  const fetcher = createPoliteFetcher({ userAgent: "test", intervalMs: 50, fetch: slow });
  const t0 = Date.now();
  await Promise.all([1, 2, 3].map((n) => fetcher.get(`https://c.test/${n}`)));
  const gaps = starts.slice(1).map((s, i) => s - (starts[i] as number));
  expect(gaps.every((g) => g >= 45)).toBe(true);
  expect(Date.now() - t0).toBeLessThan(3 * 150);
});
