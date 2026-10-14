// A course's practice written (services/practice.ts): a variant added to its lesson's practice by
// course-kit, under the series' lock — a bundle installed or a course removed waits for it.
import { join } from "node:path";
import { addPractice } from "@sprachanker/course-kit";
import { withSeriesLock } from "../providers.ts";
import type { PracticeFiles } from "../services/practice.ts";

export const practiceFiles = (dataRoot: string): PracticeFiles => {
  const libraryRoot = join(dataRoot, "library");
  return {
    add: (series, practice) =>
      withSeriesLock(libraryRoot, series, () => addPractice(libraryRoot, series, practice)),
  };
};
