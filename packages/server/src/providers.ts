// Content providers the server can import (03). The CLI and (later) the import job use this.
import { join } from "node:path";
import { SERIES as DIB, importDib } from "@sprachanker/coerll-dib";
import type { ImportReport } from "@sprachanker/course-kit";
import { importDw, seriesId } from "@sprachanker/dw";
import { importLingust, SERIES as LINGUST } from "@sprachanker/lingust-english";
import { SERIES as ENGLISH_USA, importEnglishUsa } from "@sprachanker/voa-english-usa";
import {
  importLetsLearnEnglish,
  SERIES as LETS_LEARN_ENGLISH,
} from "@sprachanker/voa-lets-learn-english";

export interface ImportRequest {
  dataRoot: string;
  courses?: string[];
  editions?: string[];
  refresh?: boolean;
  log: (line: string) => void;
}

type Run = (options: ImportRequest & { libraryRoot: string }) => Promise<ImportReport>;

/** Provider id → the series folder it writes and its importer. */
const PROVIDERS: Record<string, { series: string; run: Run }> = {
  "dw-nicos-weg": { series: seriesId("nicos-weg"), run: (o) => importDw("nicos-weg", o) },
  "dw-deutschtrainer": {
    series: seriesId("deutschtrainer"),
    run: (o) => importDw("deutschtrainer", o),
  },
  "coerll-dib": { series: DIB, run: importDib },
  "lingust-english": { series: LINGUST, run: importLingust },
  "voa-english-usa": { series: ENGLISH_USA, run: importEnglishUsa },
  "voa-lets-learn-english": { series: LETS_LEARN_ENGLISH, run: importLetsLearnEnglish },
};

export const providerIds = () => Object.keys(PROVIDERS);

export function importCourse(provider: string, request: ImportRequest): Promise<ImportReport> {
  const entry = PROVIDERS[provider];
  if (!entry) throw new Error(`unknown provider ${provider}; known: ${providerIds().join(", ")}`);
  return entry.run({ ...request, libraryRoot: join(request.dataRoot, "library") });
}

/** Re-imports one installed course: fetches what is missing and normalises it again (03). */
export function syncCourse(
  dataRoot: string,
  series: string,
  course: string,
  log: (line: string) => void,
): Promise<ImportReport> {
  const provider = Object.entries(PROVIDERS).find(([, p]) => p.series === series)?.[0];
  if (!provider) throw new Error(`no provider writes ${series}`);
  return importCourse(provider, { dataRoot, courses: [course], log });
}
