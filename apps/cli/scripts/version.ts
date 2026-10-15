// The app's version (owner, 2026-10-15): MAJOR.MINOR from apps/cli/package.json, the third number
// the count of commits of the build (`git rev-list --count HEAD`) — every build its own number. Out
// of a git checkout (or a shallow one) the package's version as written.
// Usage: bun apps/cli/scripts/version.ts   (prints it; the builds pass it on)
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };

/** MAJOR.MINOR.<commits>, or the package's version when the commits cannot be counted. */
export function appVersion(): string {
  const git = spawnSync("git", ["rev-list", "--count", "HEAD"], {
    cwd: resolve(import.meta.dir, ".."),
    encoding: "utf8",
  });
  const shallow = spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: resolve(import.meta.dir, ".."),
    encoding: "utf8",
  });
  const count = git.status === 0 ? git.stdout.trim() : "";
  if (!/^\d+$/.test(count) || shallow.stdout.trim() === "true") return pkg.version;
  const [major, minor] = pkg.version.split(".");
  return `${major}.${minor}.${count}`;
}

if (import.meta.main) console.log(appVersion());
