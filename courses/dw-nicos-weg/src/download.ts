// Downloads Nicos Weg (pages + media) into <data>/library/dw.nicos-weg; resumable.
// Usage: bun run --filter @sprachanker/dw-nicos-weg download -- [--data <root>] [--courses a1,a2,b1]
//        [--editions ru-de,en-de,de-de] [--pages-only]
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createMediaStore, createPoliteFetcher } from "@sprachanker/course-kit";
import { COURSES, SERIES, USER_AGENT } from "./catalog.ts";
import { collectMedia, fetchMedia } from "./media.ts";
import { fetchPages } from "./pages.ts";

const { values } = parseArgs({
  options: {
    data: { type: "string", default: join(homedir(), "SprachAnker") },
    courses: { type: "string", default: "a1,a2,b1" },
    editions: { type: "string", default: "ru-de,en-de,de-de" },
    "pages-only": { type: "boolean", default: false },
  },
});
const seriesDir = join(values.data, "library", SERIES);
const log = (line: string) => console.log(`${new Date().toTimeString().slice(0, 8)} ${line}`);
const fetcher = createPoliteFetcher({ userAgent: USER_AGENT, robotsHosts: ["learngerman.dw.com"] });

const selected = COURSES.filter(
  (c) =>
    values.courses.split(",").includes(c.course) && values.editions.split(",").includes(c.edition),
);
for (const course of selected) {
  await fetchPages(fetcher, seriesDir, course, log);
}
if (!values["pages-only"]) {
  const refs = await collectMedia(join(seriesDir, "raw"));
  const index = await fetchMedia(
    fetcher,
    createMediaStore(seriesDir),
    join(seriesDir, "media.json"),
    refs,
    log,
  );
  const failed = Object.entries(index).filter(([, entry]) => "error" in entry);
  log(`media: ${Object.keys(index).length - failed.length} stored, ${failed.length} failed`);
  for (const [url, entry] of failed.slice(0, 20)) log(`  failed ${url}: ${JSON.stringify(entry)}`);
}
log(`done: ${seriesDir}`);
