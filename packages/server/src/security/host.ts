// Host check and security headers (06, "Security"). The server answers only to the names this machine
// is reached by — localhost, an IP address, a `.local` name, its own host name, the names it was
// given (`--allow-host`), its own name on its tailnet (asked through `known`) — so a web page on
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

/** Refuses requests for other host names; adds the security headers to every response. `known`
 *  is asked about a name the fixed rules refuse (the tailnet's, read from Tailscale). */
export function hostGuard(
  extraHosts: readonly string[] = [],
  known?: (name: string) => Promise<boolean>,
): MiddlewareHandler {
  return async (c, next) => {
    const name = new URL(c.req.url).hostname.toLowerCase().replace(/\.$/, "");
    if (!hostAllowed(name, extraHosts) && !(await known?.(name)))
      return c.json({ error: "unknown_host" }, 421);
    await next();
    c.header("content-security-policy", CSP);
    c.header("x-frame-options", "DENY");
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
  };
}
