// VOA «Так говорят в Америке» (golosameriki.com): ru → en, series voa.english-usa.
import type { ImportOptions, ImportReport } from "@sprachanker/course-kit";

export async function importEnglishUsa(options: ImportOptions): Promise<ImportReport> {
  options.log("voa-english-usa: not implemented yet");
  return { failedMedia: [], normalised: {} };
}
