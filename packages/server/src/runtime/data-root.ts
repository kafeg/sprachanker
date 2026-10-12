// One server per data folder: the running server's pid in `<data-root>/server.pid`. A second
// server on the same folder refuses to start, and the command line's profile deletion refuses while
// a server runs (it holds the profiles' databases open). A pid file whose process is gone — or is no
// SprachAnker any more: a pid the system gave another program after a restart — is stale.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { processName } from "./process-name.ts";

const pidFile = (dataRoot: string) => join(dataRoot, "server.pid");

/**
 * Whether `pid` is a running SprachAnker (the binary, or Bun running it from sources). `ps` names the
 * process (POSIX); elsewhere a live pid is taken as one.
 */
export function sprachAnkerRuns(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    // EPERM: it runs, as another user.
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (process.platform === "win32") return true;
  return /sprachanker|\bbun\b/i.test(processName(pid) ?? "");
}

/** The pid of the server running on this data folder, if one does (not this process). */
export function serverOn(dataRoot: string): number | undefined {
  const file = pidFile(dataRoot);
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid && sprachAnkerRuns(pid)
    ? pid
    : undefined;
}

/** Marks the data folder as served by this process until it exits; refuses when another serves it.
 *  The pid file is made only when there is none (two servers started at once: one gets it). */
export function holdDataRoot(dataRoot: string) {
  mkdirSync(dataRoot, { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(pidFile(dataRoot), String(process.pid), { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A live server's file; or, made again after a stale one was taken over, one starting now.
      const other = serverOn(dataRoot);
      if (other || attempt > 0)
        throw new Error(
          `another SprachAnker server${other ? ` (pid ${other})` : ""} uses ${dataRoot}: stop it first`,
        );
      rmSync(pidFile(dataRoot), { force: true });
    }
  }
  process.once("exit", () => {
    try {
      if (readFileSync(pidFile(dataRoot), "utf8").trim() === String(process.pid))
        rmSync(pidFile(dataRoot), { force: true });
    } catch {
      // Gone already.
    }
  });
}
