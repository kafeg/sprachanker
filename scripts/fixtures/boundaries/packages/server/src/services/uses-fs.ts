// Violation: services are reached from app.ts, which stays runtime-agnostic.
import { readFileSync } from "node:fs";

export const read = readFileSync;
