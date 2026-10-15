// The native side the shared code's adapters call on Android (src-tauri/gen/android: Native.kt, the
// page's `sprachankerNativeBridge`): its answers at once where the shared code is synchronous, bytes
// as Latin-1 strings (one char a byte), and what takes long answered later through
// `sprachankerNative.done`.

/** The bridge's methods (Native.kt). */
export interface NativeBridge {
  root(): string;
  work(on: boolean, text: string): void;
  stat(path: string): string;
  list(path: string): string;
  walk(path: string): string;
  dir(path: string): string;
  readText(path: string): string | null;
  readBytes(path: string, start: number, length: number): string | null;
  writeText(path: string, text: string): string;
  writeBytes(path: string, data: string): string;
  mkdir(path: string): string;
  rename(from: string, to: string): string;
  remove(path: string): string;
  removeDir(path: string): string;
  link(from: string, to: string): string;
  copy(from: string, to: string): string;
  touch(path: string): string;
  disk(path: string): string;
  openWrite(path: string): string;
  append(handle: number, data: string): string;
  closeWrite(handle: number, sync: boolean): string;
  abortWrite(handle: number): void;
  openDownload(name: string, mime: string): string;
  sums(id: number, path: string): void;
  sumsNow(path: string): string;
  netOpen(id: number, url: string, init: string, body: string | null): void;
  netRead(id: number): string | null;
  netError(id: number): string;
  netAbort(id: number): void;
}

/** The bridge, where the app has one (Android); iOS has none yet. */
export const bridge = (globalThis as { sprachankerNativeBridge?: NativeBridge })
  .sprachankerNativeBridge;

/** The bridge, or an error saying this phone lacks it. */
export function needBridge(): NativeBridge {
  if (!bridge) throw new Error("this phone's native side has no file bridge yet (iOS)");
  return bridge;
}

/** Bytes as a Latin-1 string (in parts: a large array spread at once overflows the stack). */
export function latin1(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return text;
}

/** A Latin-1 string's bytes. */
export function fromLatin1(text: string) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/** A failure the bridge answered ("CODE message") as Node's error, else nothing. */
export function check(answer: string) {
  if (!answer) return;
  const code = answer.split(" ", 1)[0] as string;
  throw Object.assign(new Error(answer), { code });
}

type Waiter = (answer: unknown) => void;
const waiters = new Map<number, Waiter>();
let nextId = 1;

/** A call answered later: its id, and the answers it gets (one, or several: a request's head, then
 *  each "more"). */
export function later(listen: Waiter) {
  const id = nextId++;
  waiters.set(id, listen);
  return { id, forget: () => waiters.delete(id) };
}

/** A call answered once. */
export function once<T>(start: (id: number) => void): Promise<T> {
  return new Promise<T>((resolve) => {
    const call = later((answer) => {
      call.forget();
      resolve(answer as T);
    });
    start(call.id);
  });
}

(globalThis as { sprachankerNative?: unknown }).sprachankerNative = {
  done(id: number, answer: unknown) {
    waiters.get(id)?.(answer);
  },
};
