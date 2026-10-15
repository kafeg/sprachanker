// Files the speech engines download into <data-root>/models on this machine: storage/model-files.ts
// over Node's files and Bun's fetch.
import { nodeFs } from "@sprachanker/course-kit/node";
import type { ModelStore } from "../services/local-engines.ts";
import * as portable from "../storage/model-files.ts";

/** Downloads a file to `part`, its sha256 checked as it comes; a failed or wrong download leaves
 *  nothing behind. */
export const downloadChecked = (
  url: string,
  part: string,
  sha256: string,
  onProgress: (bytes: number) => void,
  signal: AbortSignal,
) => portable.downloadChecked(nodeFs, fetch, url, part, sha256, onProgress, signal);

/** Removes what a stopped server left in `dir` — parts of downloads, and what `also` names — before
 *  anything is written there. */
export const removeParts = (dir: string, also?: (name: string) => boolean) =>
  portable.removeParts(nodeFs, dir, also);

/** The model files in `dir`, its leftover parts removed. */
export const modelStore = (dir: string): ModelStore => portable.modelStore(nodeFs, dir, fetch);
