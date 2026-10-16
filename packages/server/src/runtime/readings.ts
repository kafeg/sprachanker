// What was read aloud, kept in <data-root>/cache/tts on this machine: storage/readings.ts over
// Node's files.
import { nodeFs } from "@sprachanker/course-kit/node";
import type { ReadingCache } from "../services/local-engines.ts";
import * as portable from "../storage/readings.ts";

export const readingCache = (dataRoot: string): ReadingCache =>
  portable.readingCache(nodeFs, dataRoot);
