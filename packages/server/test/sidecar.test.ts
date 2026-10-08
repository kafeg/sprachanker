import { expect, test } from "bun:test";
import { createSidecar } from "../src/services/sidecar.ts";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Fake processes: each answers its health check once started; `exit` ends one. */
function machine(options: { idleMs?: number; healthy?: boolean; portMs?: number } = {}) {
  const spawned: Array<{ setup: string; port: number; killed: boolean; exit(): void }> = [];
  let port = 9000;
  const sidecar = createSidecar({
    spawn(setup, p) {
      let exit = () => {};
      const exited = new Promise<number>((r) => (exit = () => r(0)));
      const proc = { setup, port: p, killed: false, exit };
      spawned.push(proc);
      return {
        exited,
        kill: () => {
          proc.killed = true;
          exit();
        },
      };
    },
    freePort: async () => {
      if (options.portMs) await tick(options.portMs);
      return ++port;
    },
    fetch: (async (url: string) => {
      const proc = spawned.find((s) => url.startsWith(`http://127.0.0.1:${s.port}/`));
      return new Response(null, {
        status: proc && !proc.killed && options.healthy !== false ? 200 : 503,
      });
    }) as unknown as typeof fetch,
    failed: "speech_engine_failed",
    startMs: 300,
    idleMs: options.idleMs ?? 60_000,
  });
  return { sidecar, spawned };
}

test("requests arriving together start one process", async () => {
  const { sidecar, spawned } = machine();
  const urls = await Promise.all([1, 2, 3].map(() => sidecar.use("a", async (url) => url)));
  expect(spawned).toHaveLength(1);
  expect(new Set(urls).size).toBe(1);
});

test("another setup waits for the requests in flight, then replaces the process", async () => {
  const { sidecar, spawned } = machine();
  let finish = () => {};
  const long = sidecar.use("a", () => new Promise<string>((r) => (finish = () => r("done"))));
  await tick(10);
  const other = sidecar.use("b", async () => "b");
  await tick(30);
  // Still the first process: its request is not done.
  expect(spawned.map((s) => [s.setup, s.killed])).toEqual([["a", false]]);
  finish();
  expect(await long).toBe("done");
  expect(await other).toBe("b");
  expect(spawned.map((s) => [s.setup, s.killed])).toEqual([
    ["a", true],
    ["b", false],
  ]);
});

test("stopped after a while without requests; started again after it exits", async () => {
  const { sidecar, spawned } = machine({ idleMs: 20 });
  await sidecar.use("a", async () => {});
  await tick(40);
  expect(spawned[0]?.killed).toBe(true);
  expect(sidecar.setup()).toBeUndefined();
  await sidecar.use("a", async () => {});
  spawned[1]?.exit();
  await tick();
  await sidecar.use("a", async () => {});
  expect(spawned).toHaveLength(3);
});

test("a start that never becomes ready fails and leaves nothing running", async () => {
  const { sidecar, spawned } = machine({ healthy: false });
  await expect(sidecar.use("a", async () => {})).rejects.toThrow("speech_engine_failed");
  expect(spawned[0]?.killed).toBe(true);
  expect(sidecar.setup()).toBeUndefined();
});

test("stopped while it starts: the process is not left running", async () => {
  const { sidecar, spawned } = machine({ portMs: 20 });
  const use = sidecar.use("a", async () => {}).catch(() => {});
  await tick(5);
  sidecar.stop();
  await use;
  await tick(10);
  expect(spawned.every((s) => s.killed)).toBe(true);
  expect(sidecar.setup()).toBeUndefined();
});

test("a request failing with the engine's own failure replaces the engine for the next", async () => {
  const { sidecar, spawned } = machine();
  const { ServiceError } = await import("../src/errors.ts");
  await expect(
    sidecar.use("a", async () => {
      throw new ServiceError("speech_engine_failed", 502);
    }),
  ).rejects.toThrow("speech_engine_failed");
  expect(spawned[0]?.killed).toBe(true);
  await sidecar.use("a", async () => {});
  expect(spawned).toHaveLength(2);
});
