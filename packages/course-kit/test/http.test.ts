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
  expect(await createPoliteFetcher(opts(fetchFn)).text("https://b.test/x")).toBe("ok");
  expect(calls).toEqual(["https://b.test/x", "https://b.test/x", "https://b.test/x"]);
});

test("respects robots.txt on listed hosts", async () => {
  const { fetchFn } = fake({});
  const fetcher = createPoliteFetcher(opts(fetchFn));
  await expect(fetcher.text("https://a.test/secret/1")).rejects.toBeInstanceOf(FetchFailedError);
  expect(await fetcher.text("https://a.test/open")).toBe("ok");
});

test("403 stops the host for good, 404 fails one URL", async () => {
  const { calls, fetchFn } = fake({
    "https://b.test/forbidden": [403],
    "https://b.test/missing": [404],
  });
  const fetcher = createPoliteFetcher(opts(fetchFn));
  await expect(fetcher.text("https://b.test/missing")).rejects.toBeInstanceOf(FetchFailedError);
  await expect(fetcher.text("https://b.test/forbidden")).rejects.toBeInstanceOf(HostRefusedError);
  await expect(fetcher.text("https://b.test/other")).rejects.toBeInstanceOf(HostRefusedError);
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
  await Promise.all([1, 2, 3].map((n) => fetcher.text(`https://c.test/${n}`)));
  const gaps = starts.slice(1).map((s, i) => s - (starts[i] as number));
  expect(gaps.every((g) => g >= 45)).toBe(true);
  expect(Date.now() - t0).toBeLessThan(3 * 150);
});

test("a connection lost while reading the body is retried; for good it fails the URL", async () => {
  let calls = 0;
  const broken = (n: number) =>
    (async () => {
      calls++;
      if (calls <= n)
        return new Response(
          new ReadableStream({
            start(c) {
              c.error(new Error("ECONNRESET"));
            },
          }),
        );
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
  const once = createPoliteFetcher(opts(broken(1)));
  expect(await once.bytes("https://b.test/img")).toEqual({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/png",
  });
  calls = 0;
  const always = createPoliteFetcher(opts(broken(99)));
  await expect(always.bytes("https://b.test/img")).rejects.toBeInstanceOf(FetchFailedError);
});

test("robots.txt that cannot be read is asked again; a 403 on it stops the host", async () => {
  let robotsCalls = 0;
  const flaky = (async (input: URL | string) => {
    const url = String(input);
    if (url.endsWith("robots.txt") && robotsCalls++ === 0) throw new TypeError("offline");
    return new Response("ok");
  }) as typeof fetch;
  const fetcher = createPoliteFetcher(opts(flaky));
  await expect(fetcher.text("https://a.test/x")).rejects.toThrow(FetchFailedError);
  expect(await fetcher.text("https://a.test/x")).toBe("ok");

  const refusing = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
  await expect(createPoliteFetcher(opts(refusing)).text("https://a.test/x")).rejects.toThrow(
    HostRefusedError,
  );
});

test("a body that goes silent is retried, then fails the URL", async () => {
  let calls = 0;
  const silent = (async () => {
    calls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("part"));
        },
      }),
    );
  }) as unknown as typeof fetch;
  const fetcher = createPoliteFetcher({ ...opts(silent), robotsHosts: [], retries: 1, idleMs: 30 });
  await expect(fetcher.text("https://b.test/x")).rejects.toThrow(FetchFailedError);
  expect(calls).toBe(2);
});
