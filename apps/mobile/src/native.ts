// The app's native side (src-tauri): its files — listed, read through the `media` scheme, written
// whole, removed; paths relative to its data root — and Whisper in its process.

/** Where the native side serves the app's files (and a learner's recordings, by id); the desktop
 *  harness (scripts/dev.ts) serves them elsewhere. */
export const FILES =
  (globalThis as { sprachankerFiles?: string }).sprachankerFiles ??
  // iOS names a scheme of the app's as its own (`media://localhost`); Android as a host.
  (location.protocol === "tauri:" ? "media://localhost" : "http://media.localhost");

type Invoke = <T>(
  cmd: string,
  args?: unknown,
  options?: { headers: Record<string, string> },
) => Promise<T>;
const invoke: Invoke = (cmd, args, options) =>
  (globalThis as unknown as { __TAURI__: { core: { invoke: Invoke } } }).__TAURI__.core.invoke(
    cmd,
    args,
    options,
  );

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
};
