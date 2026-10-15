// The version this binary reports: set when it is compiled (scripts/build.ts), counted from git when
// run from the sources.
import { appVersion } from "../scripts/version.ts";

declare const SPRACHANKER_VERSION: string | undefined;

export const VERSION = typeof SPRACHANKER_VERSION === "string" ? SPRACHANKER_VERSION : appVersion();
