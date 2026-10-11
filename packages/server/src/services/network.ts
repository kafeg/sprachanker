// Where this server is reached (06, "Network and HTTPS"): this machine's tailnet name, which the Host
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
}

/** This machine on its tailnet: only while Tailscale runs here, logged in. */
function tailnetOf(raw: unknown): Tailnet | undefined {
  const parsed = Status.safeParse(raw);
  if (!parsed.success || parsed.data.BackendState !== "Running") return undefined;
  const { Self, MagicDNSSuffix } = parsed.data;
  const given =
    Self.DNSName || (Self.HostName && MagicDNSSuffix && `${Self.HostName}.${MagicDNSSuffix}`);
  const name = (given || "").toLowerCase().replace(/\.$/, "");
  return DNS_NAME.test(name) ? { name, ips: Self.TailscaleIPs ?? [] } : undefined;
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

/** The HTTPS address `tailscale serve` serves this server at under the tailnet's name: its root
 *  proxied to the port, on a port of serve's taken as HTTPS. */
function servedAt(raw: unknown, name: string, port: number): string | undefined {
  const parsed = ServeStatus.safeParse(raw);
  if (!parsed.success) return undefined;
  for (const config of [parsed.data, ...Object.values(parsed.data.Foreground ?? {})]) {
    for (const [at, web] of Object.entries(config.Web ?? {})) {
      const colon = at.lastIndexOf(":");
      const httpsPort = at.slice(colon + 1);
      if (at.slice(0, colon).toLowerCase().replace(/\.$/, "") !== name) continue;
      if (config.TCP?.[httpsPort]?.HTTPS && proxiesTo(web.Handlers?.["/"]?.Proxy, port))
        return httpsPort === "443" ? `https://${name}` : `https://${name}:${httpsPort}`;
    }
  }
  return undefined;
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
      if (status === undefined) failedAt = now();
      else {
        readAt = now();
        tailnet = tailnetOf(status);
      }
      return tailnet;
    });
  const due = () => now() - readAt >= TAILNET_REREAD_MS && now() - failedAt >= TAILNET_RETRY_MS;
  // Read at the start: the first request through the tailnet finds its name known.
  const started = read();

  return {
    /** Whether a name the fixed rules refuse is this machine's on its tailnet — never another
     *  tailnet's (a page there could rebind its name to this server). */
    async knows(name: string): Promise<boolean> {
      await started;
      if (tailnet?.name === name) return true;
      if (!TAILNET_NAME.test(name) || !due()) return false;
      return (await read())?.name === name;
    },

    /** The addresses the app is reached at, Tailscale asked afresh. */
    async addresses(): Promise<ServerAddresses> {
      const { hostname, port } = listensOn;
      const [t, localName] = await Promise.all([read(), within(host?.localName(), askMs)]);
      const local = LOOPBACK.test(hostname);
      const everywhere = ANY.has(hostname);
      const network = local
        ? []
        : everywhere
          ? (host?.ipv4() ?? []).filter((ip) => !t?.ips.includes(ip))
          : [hostname];
      const https = t && servedAt(await tailscale("serve"), t.name, port);
      return {
        machine: local || everywhere ? address("localhost", port) : address(hostname, port),
        network: network.map((ip) => address(ip, port)),
        ...(localName && !local ? { localName: address(localName, port) } : {}),
        ...(t
          ? { tailnet: { name: t.name, ...(https ? { https: { url: https, secure: true } } : {}) } }
          : {}),
      };
    },
  };
}
