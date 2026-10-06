// Lingust «Правильный английский» (lingust.ru): ru → en, series lingust.english.
import type { ImportOptions, ImportReport } from "@sprachanker/course-kit";

export async function importLingust(options: ImportOptions): Promise<ImportReport> {
  options.log("lingust-english: not implemented yet");
  return { failedMedia: [], normalised: {} };
}
