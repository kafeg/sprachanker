import { describe, expect, test } from "bun:test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { commandOutput } from "../src/runtime/network.ts";
import {
  ADDRESSES_MS,
  createNetwork,
  type ListensOn,
  type NetworkHost,
  TAILNET_REREAD_MS,
  TAILNET_RETRY_MS,
} from "../src/services/network.ts";
import { setup } from "./setup.ts";

const NAME = "study-mac.tail0000.ts.net";
const TAILNET_IP = "100.64.0.7";

/** What `tailscale status --json` says of this machine, running and logged in. */
const running = (dnsName = `${NAME}.`) => ({
  BackendState: "Running",
  MagicDNSSuffix: "tail0000.ts.net",
  Self: { DNSName: dnsName, HostName: "Study-Mac", TailscaleIPs: [TAILNET_IP, "fd7a:115c::7"] },
});

/** `tailscale serve status --json`: HTTPS on `httpsPort` proxied to `target`. */
const serving = (target: string, httpsPort = 443) => ({
  TCP: { [httpsPort]: { HTTPS: true } },
  Web: { [`${NAME}:${httpsPort}`]: { Handlers: { "/": { Proxy: target } } } },
});

/** A machine whose networks and Tailscale the test sets; counts how often Tailscale is asked. */
function fakeHost(state: {
  status?: unknown;
  serve?: unknown;
  ipv4?: string[];
  localName?: string;
}) {
  const asked = { status: 0, serve: 0 };
  const host: NetworkHost = {
    ipv4: () => state.ipv4 ?? [],
    localName: async () => state.localName,
    async tailscale(command) {
      asked[command]++;
      if (state.status === "fails") throw new Error("no tailscale");
      if (state.status === "hangs") return new Promise(() => {});
      return command === "status" ? state.status : (state.serve ?? {});
    },
  };
  return { host, asked };
}

function network(
  host: NetworkHost | undefined,
  listensOn: ListensOn = { hostname: "127.0.0.1", port: 4580 },
) {
  let clock = 0;
  const net = createNetwork({ host, listensOn, now: () => clock, askMs: 20 });
  return { net, advance: (ms: number) => (clock += ms) };
}

describe("the Host check and the tailnet", () => {
  test("this machine's tailnet name is answered, another tailnet's name is not", async () => {
    const { app } = await setup({ network: fakeHost({ status: running() }).host });
    expect((await app.request(`http://${NAME}/api/health`)).status).toBe(200);
    expect((await app.request(`http://STUDY-MAC.tail0000.ts.net.:4580/api/health`)).status).toBe(
      200,
    );
    for (const host of [
      "other-mac.tail9999.ts.net",
      "study-mac.tail9999.ts.net",
      `${NAME}.rebound.example`,
      "rebound.example",
    ])
      expect((await app.request(`http://${host}/api/health`)).status).toBe(421);
  });

  test("Tailscale absent, failing or logged out: no name, no error", async () => {
    for (const status of [undefined, "fails", { ...running(), BackendState: "NeedsLogin" }, {}]) {
      const { net } = network(fakeHost({ status }).host);
      expect(await net.knows(NAME)).toBe(false);
      expect((await net.addresses()).tailnet).toBeUndefined();
    }
    const { net } = network(undefined);
    expect(await net.knows(NAME)).toBe(false);
  });

  test("Tailscale that never answers is given up", async () => {
    const host = {
      ...fakeHost({ status: "hangs" }).host,
      localName: () => new Promise<never>(() => {}),
    };
    const { net } = network(host, { hostname: "0.0.0.0", port: 4580 });
    expect(await net.knows(NAME)).toBe(false);
    expect(await net.addresses()).toEqual({
      machine: { url: "http://localhost:4580", secure: true },
      network: [],
    });
  });

  test("a command that ignores SIGTERM is killed and given up", async () => {
    const started = Date.now();
    expect(await commandOutput("/bin/sh", ["-c", "trap '' TERM; sleep 30"], 100)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await commandOutput("/bin/sh", ["-c", "echo ok"])).toBe("ok\n");
    expect(await commandOutput("/nonexistent/tailscale", [])).toBeUndefined();
  });

  test("the name given as host name and MagicDNS suffix when there is no DNS name", async () => {
    const { net } = network(fakeHost({ status: running("") }).host);
    expect(await net.knows(NAME)).toBe(true);
  });

  test("a tailnet that comes up later: asked again on a refused ts.net name, once a minute", async () => {
    const state: { status?: unknown } = { status: { ...running(), BackendState: "NeedsLogin" } };
    const { host, asked } = fakeHost(state);
    const { net, advance } = network(host);
    expect(await net.knows(NAME)).toBe(false);
    expect(asked.status).toBe(1);
    state.status = running();
    advance(TAILNET_REREAD_MS - 1);
    expect(await net.knows(NAME)).toBe(false);
    // Another name refused is no reason to ask.
    advance(TAILNET_REREAD_MS);
    expect(await net.knows("rebound.example")).toBe(false);
    expect(asked.status).toBe(1);
    expect(await net.knows(NAME)).toBe(true);
    expect(asked.status).toBe(2);
    // Known: not asked again.
    advance(TAILNET_REREAD_MS);
    expect(await net.knows(NAME)).toBe(true);
    expect(await net.knows("other-mac.tail9999.ts.net")).toBe(false);
    expect(asked.status).toBe(3);
  });
});

test("X-Forwarded-Proto believed only from a proxy of ours: tailscale serve, --allow-host", async () => {
  const { app } = await setup({
    network: fakeHost({ status: running() }).host,
    allowHosts: ["proxy.example"],
  });
  const secureCookie = async (url: string, headers: Record<string, string> = {}) => {
    const response = await app.request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...CLIENT_HEADERS, ...headers },
      body: JSON.stringify({ profile: "local" }),
    });
    expect(response.status).toBe(200);
    return /;\s*Secure/i.test(response.headers.get("set-cookie") ?? "");
  };
  const forwarded = { "x-forwarded-proto": "https" };
  expect(await secureCookie(`http://${NAME}/api/session`, forwarded)).toBe(true);
  expect(await secureCookie("http://proxy.example/api/session", forwarded)).toBe(true);
  expect(await secureCookie("http://192.168.1.20:4580/api/session", forwarded)).toBe(false);
  expect(await secureCookie("http://localhost:4580/api/session", forwarded)).toBe(false);
  expect(await secureCookie(`http://${NAME}/api/session`)).toBe(false);
  expect(await secureCookie("https://localhost/api/session")).toBe(true);
  // Where Tailscale serves nothing (the phone app's), the tailnet's name is no proxy of ours.
  const phone = await setup({
    network: { ...fakeHost({ status: running() }).host, serves: false },
  });
  const response = await phone.app.request(`http://${NAME}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", ...CLIENT_HEADERS, ...forwarded },
    body: JSON.stringify({ profile: "local" }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).not.toMatch(/;\s*Secure/i);
});

describe("Funnel", () => {
  const funnelled = { ...serving("4580"), AllowFunnel: { [`${NAME}:443`]: true } };

  test("on for the tailnet name: the name refused, no HTTPS address", async () => {
    const network = fakeHost({ status: running(), serve: funnelled }).host;
    const { app, getJson } = await setup({ network });
    expect((await app.request(`http://${NAME}/api/health`)).status).toBe(421);
    expect((await getJson("/api/addresses")).tailnet).toEqual({ name: NAME, funnel: true });
    // Another name's Funnel is not this one's.
    const other = { ...serving("4580"), AllowFunnel: { "other-mac.tail0000.ts.net:443": true } };
    const { app: app2 } = await setup({
      network: fakeHost({ status: running(), serve: other }).host,
    });
    expect((await app2.request(`http://${NAME}/api/health`)).status).toBe(200);
  });

  test("turned on later: seen within a minute", async () => {
    const state: { status?: unknown; serve?: unknown } = { status: running(), serve: {} };
    const { net, advance } = network(fakeHost(state).host);
    expect(await net.knows(NAME)).toBe(true);
    state.serve = { Foreground: { "1a2b": funnelled } };
    expect(await net.knows(NAME)).toBe(true);
    advance(TAILNET_REREAD_MS);
    await net.knows(NAME);
    await Bun.sleep(1);
    expect(await net.knows(NAME)).toBe(false);
    // Turned off again: answered once it is read again.
    state.serve = {};
    advance(TAILNET_REREAD_MS);
    expect(await net.knows(NAME)).toBe(true);
  });

  test("a request Tailscale marks as Funnel's is refused, whatever its name", async () => {
    const { app } = await setup({ network: fakeHost({ status: running() }).host });
    for (const host of [NAME, "localhost"])
      expect(
        (
          await app.request(`http://${host}/api/health`, {
            headers: { "tailscale-funnel-request": "?1" },
          })
        ).status,
      ).toBe(421);
  });
});

describe("a read that fails", () => {
  test("keeps the name known: in the Host check and in the addresses", async () => {
    const state: { status?: unknown } = { status: running() };
    const { host, asked } = fakeHost(state);
    const { net, advance } = network(host);
    expect(await net.knows(NAME)).toBe(true);
    for (const failure of [undefined, "fails", "hangs"]) {
      state.status = failure;
      advance(TAILNET_REREAD_MS);
      expect((await net.addresses()).tailnet?.name).toBe(NAME);
      expect(await net.knows(NAME)).toBe(true);
    }
    // A logged-out Tailscale is an answer: the name goes.
    state.status = { ...running(), BackendState: "NeedsLogin" };
    advance(ADDRESSES_MS);
    expect((await net.addresses()).tailnet).toBeUndefined();
    expect(await net.knows(NAME)).toBe(false);
    expect(asked.status).toBe(5);
  });

  test("is tried again after seconds, not a minute", async () => {
    const state: { status?: unknown } = { status: "fails" };
    const { host, asked } = fakeHost(state);
    const { net, advance } = network(host);
    expect(await net.knows(NAME)).toBe(false);
    state.status = running();
    expect(await net.knows(NAME)).toBe(false);
    expect(asked.status).toBe(1);
    advance(TAILNET_RETRY_MS);
    expect(await net.knows(NAME)).toBe(true);
    expect(asked.status).toBe(2);
  });
});

describe("the addresses the app is reached at", () => {
  test("listening on 127.0.0.1: this machine and the tailnet served over HTTPS", async () => {
    const { net } = network(
      fakeHost({
        status: running(),
        serve: serving("http://127.0.0.1:4580"),
        ipv4: ["192.168.1.20", TAILNET_IP],
        localName: "study-mac.local",
      }).host,
    );
    expect(await net.addresses()).toEqual({
      machine: { url: "http://localhost:4580", secure: true },
      network: [],
      tailnet: { name: NAME, https: { url: `https://${NAME}`, secure: true } },
    });
  });

  test("listening everywhere: the local network's addresses and the .local name, not secure", async () => {
    const { net } = network(
      fakeHost({ status: running(), ipv4: ["192.168.1.20", TAILNET_IP], localName: "mac.local" })
        .host,
      { hostname: "0.0.0.0", port: 4581 },
    );
    expect(await net.addresses()).toEqual({
      machine: { url: "http://localhost:4581", secure: true },
      network: [{ url: "http://192.168.1.20:4581", secure: false }],
      localName: { url: "http://mac.local:4581", secure: false },
      tailnet: { name: NAME, http: { url: `http://${NAME}:4581`, secure: false } },
    });
  });

  test("a Tailscale without serve (the phone's): never asked, the name over HTTP, said so", async () => {
    const { host, asked } = fakeHost({ status: running(), ipv4: ["192.168.1.20", TAILNET_IP] });
    const { net } = network({ ...host, serves: false }, { hostname: "0.0.0.0", port: 4580 });
    expect(await net.addresses()).toEqual({
      machine: { url: "http://localhost:4580", secure: true },
      network: [{ url: "http://192.168.1.20:4580", secure: false }],
      tailnet: { name: NAME, http: { url: `http://${NAME}:4580`, secure: false } },
      noServe: true,
    });
    expect(await net.knows(NAME)).toBe(true);
    expect(asked.serve).toBe(0);
  });

  test("listening on one address: that one", async () => {
    const { net } = network(fakeHost({ ipv4: ["192.168.1.20", "10.0.0.5"] }).host, {
      hostname: "10.0.0.5",
      port: 4580,
    });
    const { machine, network: lan } = await net.addresses();
    expect(machine).toEqual({ url: "http://10.0.0.5:4580", secure: false });
    expect(lan).toEqual([{ url: "http://10.0.0.5:4580", secure: false }]);
  });

  test("served only when serve proxies its root to this port over HTTPS", async () => {
    const httpsOf = async (serve: unknown) =>
      (await network(fakeHost({ status: running(), serve }).host).net.addresses()).tailnet?.https
        ?.url;
    expect(await httpsOf(serving("http://localhost:4580", 8443))).toBe(`https://${NAME}:8443`);
    expect(await httpsOf(serving("4580"))).toBe(`https://${NAME}`);
    expect(await httpsOf({ Foreground: { "1a2b": serving("127.0.0.1:4580") } })).toBe(
      `https://${NAME}`,
    );
    expect(await httpsOf(serving("http://127.0.0.1:3000"))).toBeUndefined();
    expect(await httpsOf(serving("http://192.168.1.20:4580"))).toBeUndefined();
    expect(await httpsOf({ ...serving("4580"), TCP: { 443: {} } })).toBeUndefined();
    expect(await httpsOf({})).toBeUndefined();
    expect(await httpsOf(undefined)).toBeUndefined();
  });

  test("gathered once for calls together and for a few seconds after", async () => {
    let localNames = 0;
    const { host, asked } = fakeHost({ status: running(), serve: serving("4580") });
    const counting = { ...host, localName: async () => `study-mac-${++localNames}.local` };
    const { net, advance } = network(counting, { hostname: "0.0.0.0", port: 4580 });
    const [a, b] = await Promise.all([net.addresses(), net.addresses()]);
    expect(b).toBe(a);
    advance(ADDRESSES_MS - 1);
    expect(await net.addresses()).toBe(a);
    expect([asked.status, asked.serve, localNames]).toEqual([1, 1, 1]);
    advance(1);
    expect((await net.addresses()).localName?.url).toBe("http://study-mac-2.local:4580");
    expect([asked.status, asked.serve, localNames]).toEqual([2, 2, 2]);
  });

  test("the route: a signed-in device only", async () => {
    const { getJson, anonymous } = await setup({
      network: fakeHost({ status: running(), serve: serving("4580") }).host,
    });
    expect((await getJson("/api/addresses")).tailnet).toEqual({
      name: NAME,
      https: { url: `https://${NAME}`, secure: true },
    });
    expect((await anonymous("GET", "/api/addresses")).status).toBe(401);
  });
});
