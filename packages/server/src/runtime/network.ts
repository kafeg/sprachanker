// This machine's networks and Tailscale (services/network.ts): its IPv4 addresses, its `.local` name,
// and what the `tailscale` command says — the macOS app's own binary, else `tailscale` on the PATH.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import type { NetworkHost } from "../services/network.ts";

const MAC_APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

/** A command's output, or undefined when it is absent, fails or takes over five seconds. */
const output = (file: string, args: string[]) =>
  new Promise<string | undefined>((resolve) => {
    execFile(file, args, { timeout: 5000 }, (error, stdout) => resolve(error ? undefined : stdout));
  });

export function networkHost(): NetworkHost {
  const tailscale = process.platform === "darwin" && existsSync(MAC_APP) ? MAC_APP : "tailscale";
  return {
    ipv4: () =>
      Object.values(networkInterfaces())
        .flatMap((addresses) => addresses ?? [])
        .filter((a) => a.family === "IPv4" && !a.internal)
        .map((a) => a.address),
    async localName() {
      // macOS's Bonjour name; elsewhere a host name that already is one.
      if (process.platform === "darwin") {
        const name = (await output("scutil", ["--get", "LocalHostName"]))?.trim();
        if (name) return `${name}.local`;
      }
      return hostname().endsWith(".local") ? hostname() : undefined;
    },
    async tailscale(command) {
      const args = command === "status" ? ["status", "--json"] : ["serve", "status", "--json"];
      const text = await output(tailscale, args);
      try {
        return text === undefined ? undefined : JSON.parse(text);
      } catch {
        return undefined;
      }
    },
  };
}
