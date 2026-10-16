// The phone's networks as the server's NetworkHost sees them (services/network.ts): its IPv4
// addresses on Wi-Fi, Ethernet, a hotspot or USB (not the mobile network's: no other device reaches
// it there), and Tailscale's while its VPN is up — its address on the tailnet, its name there as
// MagicDNS gives it back. The phone's Tailscale app has no `tailscale serve`: no HTTPS address.
import type { NetworkHost } from "@sprachanker/server/portable";
import { type NativeBridge, once } from "./bridge.ts";

/** The mobile network's interfaces (and the phone's own internal ones). */
const CELLULAR = /^(rmnet|ccmni|pdp|ppp|clat|v4-|dummy|ifb|lo)/;
/** Tailscale's addresses (100.64.0.0/10), on a VPN's interface. */
const TAILNET = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/;
const VPN = /^tun/;

/** "<interface> <address>" lines (Native.kt `addresses`). */
export function addressesOf(lines: string) {
  return lines
    .split("\n")
    .map((line) => line.trim().split(" "))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .map(([name, ip]) => ({ name, ip }));
}

export function phoneNetwork(
  b: Pick<NativeBridge, "addresses" | "nameOf">,
): NetworkHost & { serves: false } {
  const addresses = () => addressesOf(b.addresses());
  return {
    serves: false,
    ipv4: () =>
      addresses()
        .filter((a) => !CELLULAR.test(a.name))
        .map((a) => a.ip),
    localName: async () => undefined,
    async tailscale(command) {
      if (command === "serve") return {};
      const ip = addresses().find((a) => VPN.test(a.name) && TAILNET.test(a.ip))?.ip;
      if (!ip) return { BackendState: "Stopped", Self: {} };
      const name = await once<string>((id) => b.nameOf(id, ip));
      return { BackendState: "Running", Self: { DNSName: name, TailscaleIPs: [ip] } };
    },
  };
}
