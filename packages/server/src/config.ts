// Where data lives: the OS app-data folder; the data root defaults to <app-data>/data.
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

/** $SPRACHANKER_APP_DATA, else the OS's app-data folder (tests set it: Bun's homedir ignores $HOME). */
export function appDataDir(): string {
  if (process.env.SPRACHANKER_APP_DATA) return process.env.SPRACHANKER_APP_DATA;
  const home = homedir();
  if (platform() === "darwin") return join(home, "Library", "Application Support", "SprachAnker");
  if (platform() === "win32")
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "SprachAnker");
  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "sprachanker");
}

/** `--data`, else SPRACHANKER_DATA, else <app-data>/data. A leading `~` or `~/` is the home folder
 *  (`~name` is left as it is). */
export function resolveDataRoot(flag?: string): string {
  const value = flag ?? process.env.SPRACHANKER_DATA;
  if (!value) return join(appDataDir(), "data");
  // Absolute: the storage joins paths as POSIX ones (course-kit's joinPath), a leading `..` dropped.
  return resolve(value === "~" || value.startsWith("~/") ? join(homedir(), value.slice(1)) : value);
}
