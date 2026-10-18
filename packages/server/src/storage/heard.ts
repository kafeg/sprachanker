// A course's recordings heard written (services/heard.ts): added to its file by course-kit, under the
// series' lock — a bundle installed or a course removed waits for it.
import { addHeard } from "@sprachanker/course-kit";
import type { HeardFiles } from "../services/heard.ts";
import { withSeriesLock } from "./installer.ts";
import { type DataRoot, under } from "./root.ts";

export const heardFiles = (data: DataRoot): HeardFiles => ({
  add: (series, heard) =>
    withSeriesLock(data, series, () => addHeard(data.fs, under(data, "library"), series, heard)),
});
