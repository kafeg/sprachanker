// One server per data folder (06): the running server's pid in `<data-root>/server.pid`. A second
// server on the same folder refuses to start, and the command line's profile deletion refuses while
// a server runs (it holds the profiles' databases open). A pid file whose process is gone is stale.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pidFile = (dataRoot: string) => join(dataRoot, "server.pid");

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The pid of the server running on this data folder, if one does (not this process). */
export function serverOn(dataRoot: string): number | undefined {
  const file = pidFile(dataRoot);
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid) ? pid : undefined;
}

/** Marks the data folder as served by this process until it exits; refuses when another serves it. */
export function holdDataRoot(dataRoot: string) {
  const other = serverOn(dataRoot);
  if (other)
    throw new Error(`another SprachAnker server (pid ${other}) uses ${dataRoot}: stop it first`);
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(pidFile(dataRoot), String(process.pid));
  process.once("exit", () => {
    try {
      if (readFileSync(pidFile(dataRoot), "utf8").trim() === String(process.pid))
        rmSync(pidFile(dataRoot), { force: true });
    } catch {
      // Gone already.
    }
  });
}
