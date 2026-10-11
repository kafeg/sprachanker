// Violation: anki-export stays runtime-free (SQLite and zstd are passed in).
import { readFileSync } from "node:fs";

export const read = readFileSync;
