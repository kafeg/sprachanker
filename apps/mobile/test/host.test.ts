// Another device's requests answered by the server's code in the page (src/host.ts) over a fake
// native side: the request as the browser sent it, the answer's body in parts, the session's cookie
// handed on and its header kept back, a file of the app's left to the native side, a body pulled as
// the server reads it, a device gone mid-answer.
import { expect, test } from "bun:test";
import {
  answerOthers,
  asksInstall,
  type HostMessage,
  type HostNative,
  NativeFile,
} from "../src/host.ts";

type Answer = {
  status: number;
  headers: [string, string][];
  native: unknown;
  body: boolean;
};

/** The native side as the page sees it: what it was told, a request body to give. */
function fakeNative(options: { upload?: Uint8Array[]; failWriteAfter?: number } = {}) {
  const answers = new Map<number, Answer>();
  const written = new Map<number, Uint8Array[]>();
  const ended = new Map<number, string | undefined>();
  const upload = [...(options.upload ?? [])];
  let writes = 0;
  let settle: () => void = () => {};
  const settled = new Promise<void>((r) => {
    settle = r;
  });
  const native: HostNative = {
    async answer(id, status, headers, at, body) {
      answers.set(id, { status, headers, native: at, body });
      if (!body) settle();
    },
    async write(id, bytes) {
      if (options.failWriteAfter !== undefined && ++writes > options.failWriteAfter)
        throw new Error("gone");
      written.set(id, [...(written.get(id) ?? []), bytes.slice()]);
    },
    async end(id, error) {
      ended.set(id, error);
      settle();
    },
    async pull() {
      const bytes = upload.shift() ?? new Uint8Array();
      return { bytes, end: upload.length === 0 };
    },
  };
  return { native, answers, written, ended, settled };
}

const head = (
  path: string,
  extra: [string, string][] = [],
  method = "GET",
  body = false,
): HostMessage => ({
  id: 1,
  method,
  path,
  headers: [["host", "192.0.2.10:4580"], ...extra],
  body,
});

const text = (parts: Uint8Array[] | undefined) =>
  new TextDecoder().decode(new Uint8Array((parts ?? []).flatMap((p) => [...p])));

test("a request as the browser sent it: its host, its headers whole, a GET's range left to the native side", async () => {
  const fake = fakeNative();
  let seen: Request | undefined;
  const listen = answerOthers(fake.native, async () => ({
    fetch(request) {
      seen = request;
      return new Response("hello", { headers: { "content-type": "text/plain" } });
    },
  }));
  listen(
    head("/api/courses?x=1", [
      ["cookie", "sprachanker_device=abc"],
      ["range", "bytes=0-1"],
      ["origin", "http://192.0.2.10:4580"],
    ]),
  );
  await fake.settled;
  expect(seen?.url).toBe("http://192.0.2.10:4580/api/courses?x=1");
  expect(seen?.headers.get("cookie")).toBe("sprachanker_device=abc");
  expect(seen?.headers.get("origin")).toBe("http://192.0.2.10:4580");
  expect(seen?.headers.get("range")).toBeNull();
  expect(fake.answers.get(1)).toMatchObject({ status: 200, native: null, body: true });
  expect(text(fake.written.get(1))).toBe("hello");
  expect(fake.ended.get(1)).toBeUndefined();
  expect(fake.ended.has(1)).toBe(true);
});

test("the session's header kept to the app's own page; the cookie the server set handed on", async () => {
  const fake = fakeNative();
  const listen = answerOthers(fake.native, async () => ({
    fetch: () =>
      new Response("{}", {
        headers: {
          "x-sprachanker-session": "secret-token",
          "x-sprachanker-cookie": "sprachanker_device=secret-token; Path=/; HttpOnly",
          "content-security-policy": "default-src 'self'",
        },
      }),
  }));
  listen(head("/api/session", [], "POST"));
  await fake.settled;
  const headers = fake.answers.get(1)?.headers ?? [];
  expect(headers.map(([name]) => name)).not.toContain("x-sprachanker-session");
  expect(headers.map(([name]) => name)).not.toContain("x-sprachanker-cookie");
  expect(headers).toContainEqual([
    "set-cookie",
    "sprachanker_device=secret-token; Path=/; HttpOnly",
  ]);
  expect(headers).toContainEqual(["content-security-policy", "default-src 'self'"]);
});

test("a file of the app's the server answers with is the native side's to send; its token never leaves", async () => {
  const fake = fakeNative();
  const listen = answerOthers(fake.native, async () => ({
    fetch: (request) =>
      new Response(
        new NativeFile({ file: "/data/library/x/media/film.mp4" }, async () => new Uint8Array([1])),
        { headers: { "content-type": "video/mp4", "content-length": "57" } },
      ),
  }));
  listen(head("/library/x/media/film.mp4", [["range", "bytes=100-"]]));
  await fake.settled;
  expect(fake.answers.get(1)).toMatchObject({
    status: 200,
    native: { file: "/data/library/x/media/film.mp4" },
    body: false,
  });
  expect(fake.written.size).toBe(0);
  // Read whole, it is the file's bytes.
  expect([
    ...(await new NativeFile({ file: "/f" }, async () => new Uint8Array([7, 8])).bytes()),
  ]).toEqual([7, 8]);
});

test("a body that only looks like a token is sent as it is", async () => {
  const fake = fakeNative();
  const forged = `\u0000sprachanker-native:${crypto.randomUUID()}`;
  const listen = answerOthers(fake.native, async () => ({ fetch: () => new Response(forged) }));
  listen(head("/api/recordings/x"));
  await fake.settled;
  expect(fake.answers.get(1)?.native).toBeNull();
  expect(text(fake.written.get(1))).toBe(forged);
});

test("a HEAD: asked as it is (an export's HEAD takes nothing), answered without a body, a file's with its size", async () => {
  const fake = fakeNative();
  let method = "";
  const listen = answerOthers(fake.native, async () => ({
    fetch(request) {
      method = request.method;
      return request.url.endsWith(".mp4")
        ? new Response(new NativeFile({ file: "/data/a.mp4" }))
        : new Response("a body");
    },
  }));
  listen(head("/index.html", [], "HEAD"));
  await fake.settled;
  expect(method).toBe("HEAD");
  expect(fake.answers.get(1)).toMatchObject({ status: 200, native: null, body: false });
  expect(new NativeFile({ file: "/data/a.mp4" }, undefined, 123_456).size).toBe(123_456);
});

test("a request's body pulled as the server reads it, its length as announced", async () => {
  const fake = fakeNative({
    upload: [new TextEncoder().encode("abc"), new TextEncoder().encode("def")],
  });
  let got = "";
  let length: string | null = "";
  let changes = 0;
  const listen = answerOthers(
    fake.native,
    async () => ({
      async fetch(request) {
        length = request.headers.get("content-length");
        got = await request.text();
        return new Response(null, { status: 204 });
      },
    }),
    () => changes++,
  );
  listen(head("/api/courses/import", [["content-length", "6"]], "POST", true));
  await fake.settled;
  await new Promise((r) => setTimeout(r, 5));
  expect(got).toBe("abcdef");
  expect(length).toBe("6");
  expect(fake.answers.get(1)).toMatchObject({ status: 204, body: false });
  // A request that may change something has the databases written at once.
  expect(changes).toBe(1);
});

test("a body the native side no longer has (its device gone) breaks off, never taken for whole", async () => {
  const fake = fakeNative();
  fake.native.pull = async () => {
    throw new Error("the request's body broke off (410)");
  };
  let failed = false;
  const listen = answerOthers(fake.native, async () => ({
    async fetch(request) {
      await request.arrayBuffer().catch(() => {
        failed = true;
      });
      return new Response(null, { status: 204 });
    },
  }));
  listen(head("/api/recordings", [["content-length", "6"]], "POST", true));
  await fake.settled;
  expect(failed).toBe(true);
});

test("a host a browser would not send is refused", async () => {
  const fake = fakeNative();
  let asked = false;
  const listen = answerOthers(fake.native, async () => ({
    fetch: () => {
      asked = true;
      return new Response("x");
    },
  }));
  for (const host of ["evil.example/path?", "a b", ""]) {
    listen({ id: 1, method: "GET", path: "/", headers: [["host", host]], body: false });
    await new Promise((r) => setTimeout(r, 5));
    expect(fake.answers.get(1)?.status).toBe(400);
  }
  expect(asked).toBe(false);
});

test("the newer version's install refused to another device however its path is spelt; the rest answered", async () => {
  const fake = fakeNative();
  const asked: string[] = [];
  const listen = answerOthers(fake.native, async () => ({
    fetch: (request: Request) => {
      asked.push(`${request.method} ${new URL(request.url).pathname}`);
      return new Response("x");
    },
  }));
  const spellings: Array<[string, string]> = [
    ["POST", "/api/update/install"],
    ["post", "/api/update/install"],
    ["POST", "/api/./update/install"],
    ["POST", "/api/x/../update/install"],
    ["POST", "/api/%2e/update/install"],
    ["POST", "/api/update/%69nstall"],
    ["POST", "/api/update/install?x=1"],
    ["POST", "/api/update/install#a"],
    ["POST", "/API/Update/Install/"],
    ["POST", "//api//update/install"],
    ["PUT", "/api/update/install"],
    ["POST", "/api/update/%E0%A4%A"],
  ];
  for (const [method, path] of spellings) {
    fake.answers.clear();
    listen(head(path, [], method));
    await new Promise((r) => setTimeout(r, 5));
    expect([method, path, fake.answers.get(1)?.status]).toEqual([method, path, 403]);
  }
  expect(asked).toEqual([]);
  listen(head("/api/update"));
  await new Promise((r) => setTimeout(r, 5));
  expect(asked).toEqual(["GET /api/update"]);
  expect(asksInstall(new Request("http://h/api/update/install"))).toBe(false);
});

test("the device gone: the server's body stopped mid-answer; a request not answered yet aborted", async () => {
  const fake = fakeNative({ failWriteAfter: 1 });
  let cancelled = false;
  const listen = answerOthers(fake.native, async () => ({
    fetch: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: async (c) => {
            await new Promise((r) => setTimeout(r, 1));
            c.enqueue(new Uint8Array(512 << 10));
          },
          cancel: () => {
            cancelled = true;
          },
        }),
      ),
  }));
  listen(head("/api/courses/export/x"));
  await fake.settled;
  expect(cancelled).toBe(true);
  expect(fake.ended.get(1)).toContain("gone");

  const waiting = fakeNative();
  let aborted = false;
  const answer = answerOthers(waiting.native, async () => ({
    fetch: (request) =>
      new Promise<Response>((resolve) =>
        request.signal.addEventListener("abort", () => {
          aborted = true;
          resolve(new Response(null, { status: 499 }));
        }),
      ),
  }));
  answer(head("/api/llm/explain", [], "POST"));
  await new Promise((r) => setTimeout(r, 5));
  answer({ gone: 1 });
  await new Promise((r) => setTimeout(r, 5));
  expect(aborted).toBe(true);
});

test("a long body goes in parts of a megabyte at most, all of it, in order", async () => {
  const fake = fakeNative();
  const parts = Array.from({ length: 40 }, (_, i) => new Uint8Array(100_000).fill(i));
  const listen = answerOthers(fake.native, async () => ({
    fetch: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            for (const p of parts) c.enqueue(p);
            c.close();
          },
        }),
      ),
  }));
  listen(head("/api/profile/export/x"));
  await fake.settled;
  const sent = fake.written.get(1) ?? [];
  expect(sent.every((p) => p.byteLength <= (1 << 20) + 100_000)).toBe(true);
  const all = new Uint8Array(sent.flatMap((p) => [...p]));
  expect(all.byteLength).toBe(4_000_000);
  expect(all[0]).toBe(0);
  expect(all[3_999_999]).toBe(39);
});
