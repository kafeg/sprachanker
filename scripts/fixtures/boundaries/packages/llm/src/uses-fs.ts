// Violation: llm uses web-standard APIs only.
import { readFileSync } from "node:fs";

export const read = readFileSync;
