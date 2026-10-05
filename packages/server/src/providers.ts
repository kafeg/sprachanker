// Content providers the server can import (03). The CLI and (later) the import job use this.
import { join } from "node:path";
import { type ImportReport, importDw } from "@sprachanker/dw";

export interface ImportRequest {
  dataRoot: string;
  courses?: string[];
  editions?: string[];
  refresh?: boolean;
  log: (line: string) => void;
}

const PROVIDERS: Record<
  string,
  (options: ImportRequest & { libraryRoot: string }) => Promise<ImportReport>
> = {
  "dw-nicos-weg": (o) => importDw("nicos-weg", o),
  "dw-deutschtrainer": (o) => importDw("deutschtrainer", o),
};

export const providerIds = () => Object.keys(PROVIDERS);

export function importCourse(provider: string, request: ImportRequest): Promise<ImportReport> {
  const run = PROVIDERS[provider];
  if (!run) throw new Error(`unknown provider ${provider}; known: ${providerIds().join(", ")}`);
  return run({ ...request, libraryRoot: join(request.dataRoot, "library") });
}
