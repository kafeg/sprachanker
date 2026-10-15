// The data root as the storage adapters reach it (storage/: the same code on the desktop and the
// phone): its files through a DataFs (course-kit) and what tells this process from another (the
// series' lock).
import { type DataFs, joinPath } from "@sprachanker/course-kit/data-fs";

export interface DataRoot {
  fs: DataFs;
  /** The data root's absolute path: library/, decks/, profiles/, models/. */
  path: string;
  /** This process's id (0 where there is none: the phone's page). */
  pid: number;
  /** Whether another process of that id is a SprachAnker running (one that holds a lock). */
  runs(pid: number): boolean;
  /** Requests to other hosts: a publisher's, a model's (the phone's go around its WebView's CORS). */
  fetch: typeof fetch;
}

/** A path under the data root. */
export const under = (root: DataRoot, ...parts: string[]) => joinPath(root.path, ...parts);
