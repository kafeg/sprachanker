// course-kit's library over the file system.
import { existsSync } from "node:fs";

export const exists = existsSync;
export type Library = { root: string };
