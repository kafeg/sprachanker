// The phone's networks as the server sees them (src/network.ts): Wi-Fi's and a hotspot's addresses,
// not the mobile network's; Tailscale while its VPN is up, its name as MagicDNS gives it back.
import { expect, test } from "bun:test";
import { phoneNetwork } from "../src/network.ts";

const bridge = (lines: string, name = "") => ({
  addresses: () => lines,
  nameOf: (id: number) => {
    queueMicrotask(() =>
      (
        globalThis as unknown as { sprachankerNative: { done(id: number, a: unknown): void } }
      ).sprachankerNative.done(id, name),
    );
  },
});

test("the addresses other devices reach: Wi-Fi's, a hotspot's, Tailscale's; not the mobile network's", () => {
  const net = phoneNetwork(
    bridge(
      "wlan0 192.168.20.72\nrmnet_data0 10.143.2.9\nap0 192.168.43.1\ntun0 100.101.102.103\nv4-rmnet_data0 192.0.0.4\n",
    ),
  );
  expect(net.ipv4()).toEqual(["192.168.20.72", "192.168.43.1", "100.101.102.103"]);
  expect(net.serves).toBe(false);
});

test("Tailscale: running while its VPN has a tailnet address, named by MagicDNS; never asked to serve", async () => {
  const up = phoneNetwork(
    bridge("wlan0 192.168.20.72\ntun0 100.101.102.103\n", "poco.tail0000.ts.net"),
  );
  expect(await up.tailscale("status")).toEqual({
    BackendState: "Running",
    Self: { DNSName: "poco.tail0000.ts.net", TailscaleIPs: ["100.101.102.103"] },
  });
  expect(await up.tailscale("serve")).toEqual({});
  // A name not MagicDNS's (another resolver's answer) is not taken.
  const rebound = phoneNetwork(bridge("tun0 100.101.102.103\n", "attacker.example"));
  expect(await rebound.tailscale("status")).toMatchObject({ Self: { DNSName: "" } });
  // Another VPN's address, or none: not running.
  for (const lines of ["wlan0 192.168.20.72\ntun0 10.8.0.2\n", "wlan0 192.168.20.72\n"])
    expect(await phoneNetwork(bridge(lines)).tailscale("status")).toMatchObject({
      BackendState: "Stopped",
    });
});
