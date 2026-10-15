// A course's practice written (services/practice.ts): a variant added to its lesson's practice by
// course-kit, under the series' lock — a bundle installed or a course removed waits for it.
import { addPractice } from "@sprachanker/course-kit";
import type { PracticeFiles } from "../services/practice.ts";
import { withSeriesLock } from "./installer.ts";
import { type DataRoot, under } from "./root.ts";

export const practiceFiles = (data: DataRoot): PracticeFiles => ({
  add: (series, practice) =>
    withSeriesLock(data, series, () =>
      addPractice(data.fs, under(data, "library"), series, practice),
    ),
});
