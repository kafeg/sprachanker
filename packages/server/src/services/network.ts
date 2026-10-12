// Where this server is reached: this machine's tailnet name, which the Host
// check accepts besides the fixed names, and the addresses another device opens the app at. What
// Tailscale says is read through the runtime (`NetworkHost`) and parsed here.
import type { ServerAddress, ServerAddresses } from "@sprachanker/schema";
import { z } from "zod";
import { createOnce } from "../once.ts";

export interface NetworkHost {
  /** This machine's IPv4 addresses on its networks (loopback left out). */
  ipv4(): string[];
  /** Its `.local` name, if it has one. */
  localName(): Promise<string | undefined>;
  /** `tailscale status --json` or `tailscale serve status --json`, parsed; undefined when Tailscale
   *  is not installed or the command fails. */
  tailscale(command: "status" | "serve"): Promise<unknown>;
}

/** The address and port the server listens on (`--host`, `--port`). */
export interface ListensOn {
  hostname: string;
  port: number;
}

/** A refused name that looks like a tailnet's has Tailscale asked again at most this often: the
 *  tailnet may come up after the server. */
export const TAILNET_REREAD_MS = 60_000;
/** After a read that failed (no answer from Tailscale), the soonest it is tried again. */
export const TAILNET_RETRY_MS = 5000;
/** The addresses gathered are given again for this long: a page asking twice runs no commands. */
export const ADDRESSES_MS = 5000;
/** A question to the machine left unanswered this long is taken as unanswered. */
const ASK_MS = 6000;
const TAILNET_NAME = /\.ts\.net$/;
const DNS_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\])$/;
const ANY = new Set(["", "0.0.0.0", "::", "[::]"]);

const Status = z.object({
  BackendState: z.string(),
  MagicDNSSuffix: z.string().optional(),
  Self: z.object({
    DNSName: z.string().optional(),
    HostName: z.string().optional(),
    TailscaleIPs: z.array(z.string()).optional(),
  }),
});

const ServeConfig = z.object({
  TCP: z.record(z.string(), z.object({ HTTPS: z.boolean().optional() })).optional(),
  Web: z
    .record(
      z.string(),
      z.object({
        Handlers: z.record(z.string(), z.object({ Proxy: z.string().optional() })).optional(),
      }),
    )
    .optional(),
  /** `<name>:<port>` → true: Funnel opens that port to the internet. */
  AllowFunnel: z.record(z.string(), z.boolean()).optional(),
});
/** Serve's configuration; one `tailscale serve` runs in the foreground is kept by its session. */
const ServeStatus = ServeConfig.extend({
  Foreground: z.record(z.string(), ServeConfig).optional(),
});

interface Tailnet {
  /** This machine's name on the tailnet (MagicDNS), without the trailing dot. */
  name: string;
  /** Its addresses on the tailnet: not the local network's. */
  ips: string[];
  /** Where `tailscale serve` serves this server over HTTPS under the name. */
  https?: string;
  /** Funnel is on for the name: anyone on the internet reaches what is served under it. */
  funnel: boolean;
}

/** This machine on its tailnet: only while Tailscale runs here, logged in. */
function tailnetOf(raw: unknown): Tailnet | undefined {
  const parsed = Status.safeParse(raw);
  if (!parsed.success || parsed.data.BackendState !== "Running") return undefined;
  const { Self, MagicDNSSuffix } = parsed.data;
  const given =
    Self.DNSName || (Self.HostName && MagicDNSSuffix && `${Self.HostName}.${MagicDNSSuffix}`);
  const name = (given || "").toLowerCase().replace(/\.$/, "");
  return DNS_NAME.test(name) ? { name, ips: Self.TailscaleIPs ?? [], funnel: false } : undefined;
}

/** Whether serve's proxy target is this server's port on this machine. */
function proxiesTo(proxy: string | undefined, port: number): boolean {
  if (!proxy) return false;
  if (/^\d+$/.test(proxy)) return Number(proxy) === port;
  try {
    const url = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
    return url.protocol === "http:" && LOOPBACK.test(url.hostname) && Number(url.port) === port;
  } catch {
    return false;
  }
}

/** `<name>:<port>` split, the name as compared. */
function nameAndPort(at: string) {
  const colon = at.lastIndexOf(":");
  return { name: at.slice(0, colon).toLowerCase().replace(/\.$/, ""), port: at.slice(colon + 1) };
}

/** What `tailscale serve` does under the tailnet's name: the HTTPS address it serves this server at
 *  (its root proxied to the port, on a port taken as HTTPS), and whether Funnel is on for the name on
 *  any port — then the name is not this server's to answer. Undefined: not serve's answer. */
function serveOf(raw: unknown, name: string, port: number) {
  const parsed = ServeStatus.safeParse(raw);
  if (!parsed.success) return undefined;
  let https: string | undefined;
  let funnel = false;
  for (const config of [parsed.data, ...Object.values(parsed.data.Foreground ?? {})]) {
    for (const [at, on] of Object.entries(config.AllowFunnel ?? {}))
      if (on && nameAndPort(at).name === name) funnel = true;
    for (const [at, web] of Object.entries(config.Web ?? {})) {
      const served = nameAndPort(at);
      if (served.name !== name || https) continue;
      if (config.TCP?.[served.port]?.HTTPS && proxiesTo(web.Handlers?.["/"]?.Proxy, port))
        https = served.port === "443" ? `https://${name}` : `https://${name}:${served.port}`;
    }
  }
  return { https, funnel };
}

/** What a promise gives, or undefined once it fails or `ms` pass without an answer. */
const within = <T>(promise: Promise<T> | undefined, ms: number) =>
  new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    const settle = (value: T | undefined) => {
      clearTimeout(timer);
      resolve(value);
    };
    (promise ?? Promise.resolve(undefined)).then(settle, () => settle(undefined));
  });

const address = (host: string, port: number): ServerAddress => ({
  url: `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`,
  secure: LOOPBACK.test(host),
});

/** The tailnet in the addresses: no HTTPS address while Funnel is on (the name is refused). */
const tailnetAddress = (t: Tailnet): NonNullable<ServerAddresses["tailnet"]> =>
  t.funnel
    ? { name: t.name, funnel: true }
    : { name: t.name, ...(t.https ? { https: { url: t.https, secure: true } } : {}) };

export function createNetwork(config: {
  host?: NetworkHost;
  listensOn: ListensOn;
  now: () => number;
  /** How long a question to the machine may take (tests shorten it). */
  askMs?: number;
}) {
  const { host, listensOn, now, askMs = ASK_MS } = config;
  const tailscale = (command: "status" | "serve") => within(host?.tailscale(command), askMs);
  const once = createOnce<Tailnet | undefined>();
  // What the last read Tailscale answered says; a read without an answer changes nothing — the name
  // known stays known, and Tailscale is tried again soon, not a minute later.
  let tailnet: Tailnet | undefined;
  let readAt = Number.NEGATIVE_INFINITY;
  let failedAt = Number.NEGATIVE_INFINITY;
  const read = () =>
    once("status", async () => {
      const status = await tailscale("status");
      const found = status === undefined ? undefined : tailnetOf(status);
      const serve = found && serveOf(await tailscale("serve"), found.name, listensOn.port);
      if (status === undefined || (found && !serve)) failedAt = now();
      else {
        readAt = now();
        tailnet = found && { ...found, ...serve };
      }
      return tailnet;
    });
  const due = () => now() - readAt >= TAILNET_REREAD_MS && now() - failedAt >= TAILNET_RETRY_MS;
  // Read at the start: the first request through the tailnet finds its name known.
  const started = read();
  const gatherOnce = createOnce<ServerAddresses>();
  let gathered: { at: number; value: ServerAddresses } | undefined;

  return {
    /** Whether a name the fixed rules refuse is this machine's on its tailnet — never another
     *  tailnet's (a page there could rebind its name to this server), nor while Funnel opens it to
     *  the internet. A name known is read again in the background once a minute has passed, so
     *  Funnel turned on later is seen. */
    async knows(name: string): Promise<boolean> {
      await started;
      if (tailnet?.name === name && !tailnet.funnel) {
        if (due()) void read();
        return true;
      }
      if (!TAILNET_NAME.test(name) || !due()) return false;
      const t = await read();
      return t?.name === name && !t.funnel;
    },

    /** The addresses the app is reached at, Tailscale asked afresh — at most every few seconds:
     *  calls together, or soon after one another, get the same answer. */
    async addresses(): Promise<ServerAddresses> {
      if (gathered && now() - gathered.at < ADDRESSES_MS) return gathered.value;
      return gatherOnce("addresses", async () => {
        const value = await gather();
        gathered = { at: now(), value };
        return value;
      });
    },
  };

  async function gather(): Promise<ServerAddresses> {
    const { hostname, port } = listensOn;
    const [t, localName] = await Promise.all([read(), within(host?.localName(), askMs)]);
    const local = LOOPBACK.test(hostname);
    const everywhere = ANY.has(hostname);
    const network = local
      ? []
      : everywhere
        ? (host?.ipv4() ?? []).filter((ip) => !t?.ips.includes(ip))
        : [hostname];
    return {
      machine: local || everywhere ? address("localhost", port) : address(hostname, port),
      network: network.map((ip) => address(ip, port)),
      ...(localName && !local ? { localName: address(localName, port) } : {}),
      ...(t ? { tailnet: tailnetAddress(t) } : {}),
    };
  }
}
