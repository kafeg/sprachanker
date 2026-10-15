// Requests the server's code makes to other hosts — a publisher's pages and media, a model's file, an
// LLM provider — made by the native side (Native.kt), where the WebView's CORS does not apply: a
// `fetch` handed to the server's code alone, never the page's own (the web app's requests stay the
// WebView's).
import { fromLatin1, later, latin1, needBridge } from "./bridge.ts";

interface Head {
  status: number;
  statusText: string;
  url: string;
  headers: Array<[string, string]>;
}

/** Headers a request may not set itself (the native side sets them). */
const OWN = new Set(["host", "content-length", "connection", "accept-encoding"]);

export const nativeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const b = needBridge();
  const request = new Request(input, init);
  const signal = request.signal;
  if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : latin1(new Uint8Array(await request.arrayBuffer()));
  // The headers as given, not as the page's Request keeps them: it drops those a page may not set
  // (Cookie, Referer, User-Agent), which the server's code sends (a session's cookies, a
  // publisher's own page as Referer, the importer's name). The type of a body made (a form) stays.
  const given = new Headers(input instanceof Request ? input.headers : undefined);
  for (const [name, value] of new Headers(init?.headers)) given.set(name, value);
  const type = request.headers.get("content-type");
  if (type && !given.has("content-type")) given.set("content-type", type);
  const headers = [...given].filter(([name]) => !OWN.has(name.toLowerCase()));

  let wake: (() => void) | undefined;
  let headOf: ((head: Head | { error: string }) => void) | undefined;
  const call = later((answer) => {
    if (answer === "more") wake?.();
    else headOf?.(answer as Head | { error: string });
  });
  const aborted = () => {
    b.netAbort(call.id);
    call.forget();
    wake?.();
  };
  signal?.addEventListener("abort", aborted, { once: true });
  const head = await new Promise<Head | { error: string }>((resolve) => {
    headOf = resolve;
    signal?.addEventListener("abort", () => resolve({ error: "EABORT aborted" }), { once: true });
    b.netOpen(
      call.id,
      request.url,
      JSON.stringify({ method: request.method, headers, manual: request.redirect === "manual" }),
      body,
    );
  });
  if ("error" in head) {
    signal?.removeEventListener("abort", aborted);
    call.forget();
    if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
    throw new TypeError(`fetch failed: ${head.error}`);
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (signal?.aborted) {
          controller.error(signal.reason ?? new DOMException("aborted", "AbortError"));
          return;
        }
        const part = b.netRead(call.id);
        if (part == null) {
          signal?.removeEventListener("abort", aborted);
          call.forget();
          const error = b.netError(call.id);
          if (error) controller.error(new TypeError(`the body broke off: ${error}`));
          else controller.close();
          return;
        }
        if (part) {
          controller.enqueue(fromLatin1(part));
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    cancel() {
      aborted();
    },
  });
  const nullBody = request.method === "HEAD" || [101, 204, 205, 304].includes(head.status);
  if (nullBody) void stream.cancel();
  const response = new Response(nullBody ? null : stream, {
    status: head.status,
    statusText: head.statusText,
    headers: head.headers.filter(([name]) => name.toLowerCase() !== "set-cookie"),
  });
  // What a Response made here cannot carry: the address it ended at, the cookies set.
  const cookies = head.headers.filter(([n]) => n.toLowerCase() === "set-cookie").map(([, v]) => v);
  Object.defineProperty(response, "url", { value: head.url });
  const getSetCookie = () => cookies;
  Object.defineProperty(response.headers, "getSetCookie", { value: getSetCookie });
  Object.defineProperty(response, "redirected", { value: head.url !== request.url });
  return response;
}) as typeof fetch;
