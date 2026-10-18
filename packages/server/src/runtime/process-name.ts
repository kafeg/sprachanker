// What a process is called — by `ps` (POSIX), by `tasklist` (Windows) —: to tell our own processes
// from others a pid was given to.

/** The process's command name (Windows: its image, `sprachanker.exe`); undefined when none is given. */
export function processName(pid: number): string | undefined {
  if (process.platform === "win32") {
    // A CSV line: "sprachanker.exe","1234",…; a pid no process has gives a line without quotes.
    const line = Bun.spawnSync(["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      windowsHide: true,
    }).stdout.toString();
    return /^\s*"([^"]+)"/.exec(line)?.[1];
  }
  return (
    Bun.spawnSync(["ps", "-p", String(pid), "-o", "comm="])
      .stdout.toString()
      .trim() || undefined
  );
}
