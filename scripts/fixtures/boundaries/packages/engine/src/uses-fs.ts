// Violation: engine does no I/O.
import { readFileSync } from "node:fs";

export const read = readFileSync;
