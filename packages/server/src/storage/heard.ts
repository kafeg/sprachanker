// A course's recordings heard written (services/heard.ts): added to its file by course-kit, under the
// series' lock — a bundle installed or a course removed waits for it. The hearing step's marker of a
// course (`<series>/.heard/<course>.json`, schema HeardMarker) beside it, this machine's own: written
// without the lock, as a download's marker is.
import { addHeard, joinPath } from "@sprachanker/course-kit";
import { HeardMarker } from "@sprachanker/schema";
import type { HeardFiles } from "../services/heard.ts";
import { withSeriesLock } from "./installer.ts";
import { type DataRoot, under } from "./root.ts";

export const heardFiles = (data: DataRoot): HeardFiles => {
  const markerFile = (series: string, course: string) =>
    joinPath(under(data, "library"), series, ".heard", `${course}.json`);
  return {
    add: (series, heard) =>
      withSeriesLock(data, series, () => addHeard(data.fs, under(data, "library"), series, heard)),
    // A marker that does not read (cut short, edited) is none: the course is heard as if never marked.
    marker(series, course) {
      try {
        return HeardMarker.parse(JSON.parse(data.fs.readText(markerFile(series, course)) ?? ""));
      } catch {
        return undefined;
      }
    },
    mark(series, course, marker) {
      const file = markerFile(series, course);
      if (!marker || (!marker.stopped && !Object.keys(marker.failed ?? {}).length))
        data.fs.remove(file);
      else data.fs.writeFile(file, JSON.stringify(marker satisfies HeardMarker));
    },
  };
};
