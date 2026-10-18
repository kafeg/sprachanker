// The storage adapters over a temporary data folder, as the desktop runs them (Node's files, Bun's
// SQLite): what most tests use; storage-memory.test.ts runs them over files kept in memory.
import { dirname } from "node:path";
import { mediaBlob } from "../src/runtime/bun.ts";
import { nodeDataRoot } from "../src/runtime/data-root.ts";
import { bunProfileSql } from "../src/runtime/profile-sql.ts";
import * as course from "../src/storage/course-transfer.ts";
import * as deck from "../src/storage/deck-transfer.ts";
import * as decks from "../src/storage/decks.ts";
import * as heard from "../src/storage/heard.ts";
import * as installer from "../src/storage/installer.ts";
import * as practice from "../src/storage/practice.ts";
import * as profile from "../src/storage/profile-transfer.ts";
import type { TransferOptions } from "../src/storage/transfers.ts";

export const courseTransferFiles = (root: string, options?: TransferOptions) =>
  course.courseTransferFiles(nodeDataRoot(root), options);
export const deckTransferFiles = (root: string, options?: TransferOptions) =>
  deck.deckTransferFiles(nodeDataRoot(root), options);
export const deckFiles = (root: string) => decks.deckFiles(nodeDataRoot(root), mediaBlob);
export const practiceFiles = (root: string) => practice.practiceFiles(nodeDataRoot(root));
export const heardFiles = (root: string) => heard.heardFiles(nodeDataRoot(root));
export const profileTransferFiles = (
  root: string,
  options?: TransferOptions & { settleMs?: number },
) => profile.profileTransferFiles(nodeDataRoot(root), bunProfileSql(root, {}), options);
/** The series' lock of a library folder (`<data-root>/library`). */
export const withSeriesLock = <T>(
  libraryRoot: string,
  series: string,
  work: () => Promise<T>,
  options?: { wait?: boolean },
) => installer.withSeriesLock(nodeDataRoot(dirname(libraryRoot)), series, work, options);
export const removeInstalledCourse = (root: string, series: string, courseId: string) =>
  installer.removeInstalledCourse(nodeDataRoot(root), series, courseId);
export const courseInstaller = (root: string, now?: () => number) =>
  installer.courseInstaller(nodeDataRoot(root), now);
export const importCourse = (
  provider: string,
  request: installer.ImportRequest & { dataRoot: string },
) => installer.importCourse(nodeDataRoot(request.dataRoot), provider, request);
export {
  downloadEnd,
  downloadMarker,
  PROVIDERS,
  providerIds,
  providerOf,
} from "../src/storage/installer.ts";
