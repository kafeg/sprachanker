// The app open to other devices (Android): what another device's browser asks of the native side's
// listener (src-tauri/src/host.rs) answered here by the server's code, as the page's own requests
// are — the request made as it came (its headers whole: its cookie, its length, its host for the
// server's Host check), its body read as the server takes it; the answer's body sent back in parts,
// the device's cookie handed on as the server set it (a page's Response drops Set-Cookie: the
// server says it in COOKIE_HEADER), the session's header kept to the app's own page. What the server
// answers with a file of the app's (`NativeFile`: media, recordings, the web app's files) the native
// side sends from the disk itself, ranges and all.
import { COOKIE_HEADER, SESSION_HEADER } from "@sprachanker/server/portable";

/** A file the native side sends: one of the app's (an absolute path under its data root), or one of
 *  the web app's files built into the app. */
export type NativeAt = { file: string } | { asset: string };

/** What the listener says: a request's head, or that its device went away before its answer. */
export type HostMessage =
  | { id: number; method: string; path: string; headers: [string, string][]; body: boolean }
  | { gone: number };

/** The listener's native side (native.ts over Tauri; a fake in the tests). */
export interface HostNative {
  /** A request's status and headers, then a file sent natively, or a body to come (`body`). */
  answer(
    id: number,
    status: number,
    headers: [string, string][],
    native: NativeAt | null,
    body: boolean,
  ): Promise<void>;
  /** A part of the answer's body; fails once the device has gone. */
  write(id: number, bytes: Uint8Array): Promise<void>;
  /** The answer's body ended, or broken off (`error`). */
  end(id: number, error?: string): Promise<void>;
  /** What came of the request's body since (up to a megabyte), and whether it is all. */
  pull(id: number): Promise<{ bytes: Uint8Array; end: boolean }>;
}

const TOKEN = "\u0000sprachanker-native:";
/** The token's length: its prefix and a UUID. */
const TOKEN_LENGTH = TOKEN.length + 36;
/** The files made lately, by their token (the latest few hundred: one is taken by the answer it is in). */
const made = new Map<string, NativeAt>();
const MADE_KEPT = 256;

/** A file the native side sends when the server answers with it — its bytes are only a token that
 *  names it (never another's: a random one, known here only) —; its `size` the file's (`length`:
 *  what a HEAD is answered with); read whole (`arrayBuffer`, `bytes`) it gives the file's bytes, as
 *  the server reads a recording it hands on. */
export class NativeFile extends Blob {
  constructor(
    at: NativeAt,
    private readonly read: () => Promise<Uint8Array<ArrayBuffer> | undefined> = async () =>
      undefined,
    private readonly length?: number,
  ) {
    const token = TOKEN + crypto.randomUUID();
    super([token]);
    made.set(token, at);
    if (made.size > MADE_KEPT) made.delete(made.keys().next().value as string);
  }
  override get size() {
    return this.length ?? super.size;
  }
  override async arrayBuffer() {
    return ((await this.read()) ?? new Uint8Array()).buffer as ArrayBuffer;
  }
  override async bytes() {
    return (await this.read()) ?? new Uint8Array();
  }
}

/** A host as a browser names it (a name or an address, a port): anything else is refused. */
const HOST = /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i;
/** An answer's body is sent in parts of at most this size. */
const PART = 1 << 20;

const concat = (parts: Uint8Array[]) => {
  if (parts.length === 1) return parts[0] as Uint8Array;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

type Server = { fetch(request: Request): Response | Promise<Response> };

/** Answers the listener's requests with `server` (once it is ready): the handler of its messages.
 *  `changed` runs after a request that may change something (the databases written at once: a page
 *  put away writes them late, and the app may be closed meanwhile). */
export function answerOthers(
  native: HostNative,
  server: () => Promise<Server>,
  changed: () => unknown = () => {},
) {
  const going = new Map<number, AbortController>();
  return (message: HostMessage) => {
    if ("gone" in message) going.get(message.gone)?.abort();
    else void handle(message);
  };

  async function handle(m: Extract<HostMessage, { id: number }>) {
    const controller = new AbortController();
    going.set(m.id, controller);
    let answered = false;
    try {
      const request = requestOf(m, controller.signal);
      if (!request) {
        answered = true;
        return await native.answer(m.id, 400, [], null, false);
      }
      const response = await (await server()).fetch(request);
      answered = true;
      await send(m, response, controller.signal);
    } catch (error) {
      if (!answered && !controller.signal.aborted)
        await native.answer(m.id, 500, [], null, false).catch(() => undefined);
      else if (answered) await native.end(m.id, String(error)).catch(() => undefined);
    } finally {
      going.delete(m.id);
      if (m.method !== "GET" && m.method !== "HEAD") void changed();
    }
  }

  /** The request as the browser sent it: its headers on Headers made here (a page's Request drops
   *  Cookie, Content-Length, Origin…; the server reads them as they are). A GET's range is the native
   *  side's, applied to a file. */
  function requestOf(m: Extract<HostMessage, { id: number }>, signal: AbortSignal) {
    const headers = new Headers();
    for (const [name, value] of m.headers) headers.append(name, value);
    const host = headers.get("host");
    if (!host || !HOST.test(host)) return undefined;
    const { method } = m;
    const reading = method === "GET" || method === "HEAD";
    if (reading) {
      headers.delete("range");
      headers.delete("if-range");
    }
    const body = m.body && !reading ? bodyOf(m.id) : undefined;
    const request = new Request(`http://${host}${m.path}`, {
      method,
      body,
      signal,
      duplex: "half",
    } as RequestInit);
    Object.defineProperty(request, "headers", { value: headers });
    return request;
  }

  function bodyOf(id: number) {
    return new ReadableStream<Uint8Array>(
      {
        // Each pull answers soon, with nothing while nothing came (the device sends slowly).
        async pull(controller) {
          for (;;) {
            const { bytes, end } = await native.pull(id);
            if (bytes.byteLength) controller.enqueue(bytes);
            if (end) controller.close();
            if (bytes.byteLength || end) return;
          }
        },
      },
      { highWaterMark: 0 },
    );
  }

  async function send(
    m: Extract<HostMessage, { id: number }>,
    response: Response,
    signal: AbortSignal,
  ) {
    const headers: [string, string][] = [];
    for (const [name, value] of response.headers)
      if (name === COOKIE_HEADER) headers.push(["set-cookie", value]);
      else if (name !== SESSION_HEADER) headers.push([name, value]);
    const reader = response.body?.getReader();
    // A HEAD's answer has no body (a file's length is its size).
    if (!reader || m.method === "HEAD") {
      await reader?.cancel();
      return native.answer(m.id, response.status, headers, null, false);
    }
    // The start of the body: a file's token, or the first of the body itself (an answer that cannot
    // be a file's — JSON, a stream of events — sent as it comes).
    const first: Uint8Array[] = [];
    let size = 0;
    let done = false;
    const type = response.headers.get("content-type") ?? "";
    const maybeFile =
      response.status === 200 && !/^(application\/json|text\/event-stream)/.test(type);
    while (maybeFile && !done && size <= TOKEN_LENGTH) {
      const part = await reader.read();
      if (part.done) done = true;
      else {
        first.push(part.value);
        size += part.value.byteLength;
      }
    }
    if (done && size === TOKEN_LENGTH && response.status === 200) {
      const token = new TextDecoder().decode(concat(first));
      const at = made.get(token);
      if (at) {
        made.delete(token);
        return native.answer(m.id, 200, headers, at, false);
      }
    }
    await native.answer(m.id, response.status, headers, null, true);
    const stop = () => void reader.cancel().catch(() => undefined);
    signal.addEventListener("abort", stop);
    try {
      await pipe(m.id, reader, first, done);
    } catch (error) {
      stop();
      throw error;
    } finally {
      signal.removeEventListener("abort", stop);
    }
    await native.end(m.id);
  }

  /** The body sent in parts as it comes: one part on its way at a time, what comes meanwhile sent
   *  together after it. */
  async function pipe(
    id: number,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    first: Uint8Array[],
    ended: boolean,
  ) {
    let batch = first;
    let size = first.reduce((n, p) => n + p.byteLength, 0);
    let done = ended;
    let flight: Promise<void> | undefined;
    let busy = false;
    while (!done || size) {
      if (!done && size < PART) {
        const part = await reader.read();
        if (part.done) done = true;
        else {
          batch.push(part.value);
          size += part.value.byteLength;
        }
      }
      if (size && (done || !busy || size >= PART)) {
        await flight;
        const bytes = concat(batch);
        batch = [];
        size = 0;
        busy = true;
        flight = native.write(id, bytes).finally(() => {
          busy = false;
        });
        flight.catch(() => undefined);
      }
    }
    await flight;
  }
}
