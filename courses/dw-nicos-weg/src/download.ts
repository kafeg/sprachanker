// Downloads Nicos Weg (pages + media) into <data>/library/dw.nicos-weg; resumable.
// Usage: bun run --filter @sprachanker/dw-nicos-weg download -- [--data <root>] [--courses a1,a2,b1] [--pages-only]
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createBlobStore, createPoliteFetcher } from "@sprachanker/course-kit";
import { COURSES, SERIES, USER_AGENT } from "./catalog.ts";
import { collectMedia, fetchMedia } from "./media.ts";
import { fetchPages } from "./pages.ts";

const { values } = parseArgs({
  options: {
    data: { type: "string", default: join(homedir(), "SprachAnker") },
    courses: { type: "string", default: COURSES.map((c) => c.course).join(",") },
    "pages-only": { type: "boolean", default: false },
  },
});
const seriesDir = join(values.data, "library", SERIES);
const log = (line: string) => console.log(`${new Date().toTimeString().slice(0, 8)} ${line}`);
const fetcher = createPoliteFetcher({ userAgent: USER_AGENT, robotsHosts: ["learngerman.dw.com"] });

for (const course of COURSES.filter((c) => values.courses.split(",").includes(c.course))) {
  await fetchPages(fetcher, seriesDir, course, log);
}
if (!values["pages-only"]) {
  const refs = await collectMedia(join(seriesDir, "raw"));
  const index = await fetchMedia(
    fetcher,
    createBlobStore(seriesDir),
    join(seriesDir, "media.json"),
    refs,
    log,
  );
  const failed = Object.entries(index).filter(([, entry]) => "error" in entry);
  log(`media: ${Object.keys(index).length - failed.length} stored, ${failed.length} failed`);
  for (const [url, entry] of failed.slice(0, 20)) log(`  failed ${url}: ${JSON.stringify(entry)}`);
}
log(`done: ${seriesDir}`);
