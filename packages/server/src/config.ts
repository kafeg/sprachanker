// Where data lives (05, "Locations"): the OS app-data folder; the data root defaults to <app-data>/data.
import { homedir, platform } from "node:os";
import { join } from "node:path";

export function appDataDir(): string {
  const home = homedir();
  if (platform() === "darwin") return join(home, "Library", "Application Support", "SprachAnker");
  if (platform() === "win32")
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "SprachAnker");
  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "sprachanker");
}

/** `--data`, else SPRACHANKER_DATA, else <app-data>/data. A leading `~` is expanded. */
export function resolveDataRoot(flag?: string): string {
  const value = flag ?? process.env.SPRACHANKER_DATA;
  if (!value) return join(appDataDir(), "data");
  return value.startsWith("~") ? join(homedir(), value.slice(1)) : value;
}
