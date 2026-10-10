// What a process is called, by `ps` (POSIX): to tell our own processes from others a pid was given to.

/** The process's command name; undefined where `ps` cannot be asked (Windows) or it gives none. */
export function processName(pid: number): string | undefined {
  if (process.platform === "win32") return undefined;
  return (
    Bun.spawnSync(["ps", "-p", String(pid), "-o", "comm="])
      .stdout.toString()
      .trim() || undefined
  );
}
