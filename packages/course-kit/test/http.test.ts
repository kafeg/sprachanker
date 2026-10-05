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
