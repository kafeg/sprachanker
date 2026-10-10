// What the server uses of the DW provider: one provider per DW series (Nicos Weg, Deutschtrainer).
import type { CourseProvider } from "@sprachanker/course-kit";
import { type DwSeries, offers, seriesId } from "./catalog.ts";
import { importDw } from "./import.ts";

export type { DwSeries } from "./catalog.ts";

const dwProvider = (series: DwSeries): CourseProvider => ({
  id: `dw-${series}`,
  series: seriesId(series),
  // Nicos Weg is ready for learning in every edition; Deutschtrainer is experimental.
  ...(series === "nicos-weg" && { stable: true as const }),
  offers: offers(series),
  import: (options) => importDw(series, options),
});

export const DW_PROVIDERS: CourseProvider[] = [
  dwProvider("nicos-weg"),
  dwProvider("deutschtrainer"),
];
