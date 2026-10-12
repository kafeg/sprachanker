// This machine's networks and Tailscale (services/network.ts): its IPv4 addresses, its `.local` name,
// and what the `tailscale` command says — the macOS app's own binary, else `tailscale` looked up on
// the PATH (Linux, Homebrew's).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import type { NetworkHost } from "../services/network.ts";

const MAC_APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const COMMAND_MS = 5000;

/** A command's output, or undefined when it is absent, fails or takes longer than `ms`: killed
 *  outright then (a child ignoring SIGTERM too), and given up even while its pipes stay open. */
export const commandOutput = (file: string, args: string[], ms = COMMAND_MS) =>
  new Promise<string | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms + 500);
    execFile(
      file,
      args,
      { timeout: ms, killSignal: "SIGKILL", maxBuffer: 16 * 2 ** 20 },
      (error, stdout) => {
        clearTimeout(timer);
        resolve(error ? undefined : stdout);
      },
    );
  });

/** The `tailscale` command with its arguments, as run. The macOS app's binary started by a process
 *  launchd started (the server under its LaunchAgent) opens the app's window instead of answering
 *  ("The Tailscale GUI failed to start", exit 0): run through a shell that stays its parent, it
 *  answers as from a terminal. */
const tailscaleCommand = (args: string[]): [string, string[]] =>
  process.platform === "darwin" && existsSync(MAC_APP)
    ? ["/bin/sh", ["-c", '"$0" "$@"; :', MAC_APP, ...args]]
    : ["tailscale", args];

export function networkHost(): NetworkHost {
  return {
    ipv4: () =>
      Object.values(networkInterfaces())
        .flatMap((addresses) => addresses ?? [])
        .filter((a) => a.family === "IPv4" && !a.internal)
        .map((a) => a.address),
    async localName() {
      // macOS's Bonjour name; elsewhere a host name that already is one.
      if (process.platform === "darwin") {
        const name = (await commandOutput("/usr/sbin/scutil", ["--get", "LocalHostName"]))?.trim();
        if (name) return `${name}.local`;
      }
      return hostname().endsWith(".local") ? hostname() : undefined;
    },
    async tailscale(command) {
      // Without the peers: this machine is all that is read, and a large tailnet's list is long.
      const args =
        command === "status"
          ? ["status", "--json", "--peers=false"]
          : ["serve", "status", "--json"];
      const text = await commandOutput(...tailscaleCommand(args));
      try {
        return text === undefined ? undefined : JSON.parse(text);
      } catch {
        return undefined;
      }
    },
  };
}
