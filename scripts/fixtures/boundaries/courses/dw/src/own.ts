// Allowed: a provider importing its own files.
import { other } from "./imports-other.ts";

export const own = other;
