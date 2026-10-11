// Host check and security headers (06, "Security"). The server answers only to the names this machine
// is reached by — localhost, an IP address, a `.local` name, its own host name, the names it was
// given (`--allow-host`, `proxies`), its own name on its tailnet (asked through `known`) — so a web page on
// another site cannot rebind its DNS name to this server and talk to the API as same-origin. The web
// app may not be framed, and loads nothing from elsewhere: model output cannot make the browser send
// data to another host.
import type { MiddlewareHandler } from "hono";

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Whether a host name is one this machine is reached by, by the fixed rules. */
function hostAllowed(name: string, extra: readonly string[]): boolean {
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".local") ||
    IPV4.test(name) ||
    name.startsWith("[") ||
    extra.some((h) => h.toLowerCase() === name)
  );
}

/** Set by Tailscale's serve on a request Funnel brought in (Tailscale's source: `?1`). */
const FUNNEL_HEADER = "tailscale-funnel-request";

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

/** What the Host check tells the routes after it: the request came through a proxy that is ours
 *  (`tailscale serve`, or one named by `--allow-host`), so its `X-Forwarded-Proto` is believed. */
export type HostEnv = { Variables: { proxied: boolean } };

/** Refuses requests for other host names; adds the security headers to every response. `hosts`:
 *  this machine's own names; `proxies`: the names given by `--allow-host`; `known` is asked about a
 *  name the fixed rules refuse (the tailnet's, read from Tailscale). */
export function hostGuard(options: {
  hosts?: readonly string[];
  proxies?: readonly string[];
  known?: (name: string) => Promise<boolean>;
}): MiddlewareHandler<HostEnv> {
  const { hosts = [], proxies = [], known } = options;
  return async (c, next) => {
    const name = new URL(c.req.url).hostname.toLowerCase().replace(/\.$/, "");
    // Tailscale marks what Funnel brings in from the internet: never answered.
    if (c.req.header(FUNNEL_HEADER)) return c.json({ error: "unknown_host" }, 421);
    const proxied = proxies.some((h) => h.toLowerCase() === name);
    const own = proxied || hostAllowed(name, hosts);
    const tailnet = !own && !!(await known?.(name));
    if (!own && !tailnet) return c.json({ error: "unknown_host" }, 421);
    c.set("proxied", proxied || tailnet);
    await next();
    c.header("content-security-policy", CSP);
    c.header("x-frame-options", "DENY");
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
  };
}
