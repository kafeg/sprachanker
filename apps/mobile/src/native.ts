// The app's native side (src-tauri): its files — listed, read through the `media` scheme, written
// whole, removed; paths relative to its data root —, Whisper in its process, reading aloud's
// engines run as programs (src-tauri/src/engines.rs), and the listener other devices open the app at.
import { latin1 } from "./bridge.ts";
import type { HostMessage, HostNative } from "./host.ts";

/** Where the native side serves the app's files (and a learner's recordings, by id); the desktop
 *  harness (scripts/dev.ts) serves them elsewhere. */
export const FILES =
  (globalThis as { sprachankerFiles?: string }).sprachankerFiles ??
  // iOS names a scheme of the app's as its own (`media://localhost`); Android as a host.
  (location.protocol === "tauri:" ? "media://localhost" : "http://media.localhost");

type Tauri = {
  core: { invoke: Invoke; Channel: new () => { onmessage: (message: unknown) => void } };
};
const tauri = () => (globalThis as unknown as { __TAURI__: Tauri }).__TAURI__;

type Invoke = <T>(
  cmd: string,
  args?: unknown,
  options?: { headers: Record<string, string> },
) => Promise<T>;
const invoke: Invoke = (cmd, args, options) => tauri().core.invoke(cmd, args, options);

export interface Entry {
  /** Relative to the data root. */
  path: string;
  size: number;
  mtime: number;
}

/** Bytes as base64, in chunks (a large array spread at once overflows the stack). */
function toBase64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** The fetch the page had before the app's own replaced it (the files' scheme is not the app's). */
let netFetch: typeof fetch = globalThis.fetch.bind(globalThis);
export const setNetFetch = (f: typeof fetch) => {
  netFetch = f;
};

export const native = {
  /** The data root's absolute path. */
  root: () => invoke<string>("fs_root"),
  /** Every file under a folder of the root. */
  list: (path = "") => invoke<Entry[]>("fs_list", { path }),
  async read(path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const res = await netFetch(`${FILES}/${path}`);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : undefined;
  },
  async readText(path: string) {
    const res = await netFetch(`${FILES}/${path}`);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.text();
  },
  write: (path: string, bytes: Uint8Array) =>
    invoke<void>("fs_write", { path, base64: toBase64(bytes) }),
  remove: (path: string) => invoke<void>("fs_remove", { path }),
  /** Whether Whisper is built into this app (Android so far). */
  asrBuilt: () => invoke<boolean>("asr_built").catch(() => false),
  /** Loads a Whisper model file (absolute path): how long it took, in ms. */
  loadModel: (path: string) => invoke<number>("load", { path }),
  /** What was said in 16 kHz samples, in a language given. */
  transcribe: (samples: Float32Array, lang: string, threads: number) =>
    invoke<{ text: string; ms: number }>(
      "transcribe",
      new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
      { headers: { lang, threads: String(threads) } },
    ),
  /** Reading aloud's engines this app carries ("piper", "qwen"; Android). */
  enginesBuilt: () => invoke<string[]>("engines_built").catch(() => [] as string[]),
  /** An engine started with its arguments: its pid. */
  engineSpawn: (engine: "piper" | "qwen", args: string[]) =>
    invoke<number>("engine_spawn", { engine, args }),
  /** An engine's end: its exit code and the end of what it said on stderr. */
  engineWait: (pid: number) => invoke<{ code: number; log: string }>("engine_wait", { pid }),
  engineKill: (pid: number) => invoke<void>("engine_kill", { pid }),
  /** Every engine stopped (the page started again: none has its owner any more). */
  enginesStopAll: () => invoke<void>("engines_stop_all").catch(() => {}),
  /** The folder engines write what they make into (absolute). */
  engineOutputs: () => invoke<string>("engine_outputs"),
  /** A file an engine wrote there, read and removed. */
  engineOutput: (name: string) => invoke<ArrayBuffer>("engine_output", { name }),
  freePort: () => invoke<number>("free_port"),
  /** A request to an engine on 127.0.0.1 (a JSON body): two bytes of status, then the body. */
  localHttp: (port: number, method: string, path: string, body: string | null, timeout: number) =>
    invoke<ArrayBuffer>("local_http", { port, method, path, body, timeout }),
  /** A .tar.bz2 archive unpacked into a folder (absolute paths). */
  untarBz2: (archive: string, into: string) => invoke<void>("untar_bz2", { archive, into }),
};

/** The listener on all addresses (src-tauri/src/host.rs) started: its port, and its native side;
 *  `listen` gets its requests. */
export async function startHost(listen: (message: HostMessage) => void) {
  // Started with the page: Tauri's script may come a moment after this one (Android, a cold start).
  for (let waited = 0; !tauri()?.core && waited < 10_000; waited += 20)
    await new Promise((r) => setTimeout(r, 20));
  const page = new (tauri().core.Channel)();
  page.onmessage = (message) => listen(message as HostMessage);
  const port = await invoke<number>("host_start", { page });
  let pulls = 0;
  const host: HostNative = {
    answer: (id, status, headers, native, body) =>
      invoke("host_answer", { id, status, headers, native, body }),
    // Base64: Android's IPC carries strings, not bytes.
    write: (id, bytes) => invoke("host_write", { id, data: btoa(latin1(bytes)) }),
    end: (id, error) => invoke("host_end", { id, error: error ?? null }),
    async pull(id) {
      // Numbered: each pull a request of its own, never one the WebView kept.
      const res = await netFetch(`${FILES}/.host/${id}?n=${++pulls}`);
      if (!res.ok) throw new Error(`the request's body broke off (${res.status})`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        end: res.headers.get("x-end") === "1",
      };
    },
  };
  return { port, host };
}
