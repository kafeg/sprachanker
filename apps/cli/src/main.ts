#!/usr/bin/env bun
// The `sprachanker` binary.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  backupData,
  courseAdmin,
  directoryAssets,
  fileAssets,
  importCourse,
  profileAdmin,
  providerIds,
  resolveDataRoot,
  startServer,
  verifyData,
  type WebAssets,
} from "@sprachanker/server";
import pkg from "../package.json" with { type: "json" };

const DEFAULT_PORT = 4580;
const USAGE = `Usage: sprachanker <command>

Commands:
  serve  [--data <dir>] [--host <address>] [--port <number>] [--allow-host <name>]...
         start the server (default 127.0.0.1:${DEFAULT_PORT}); it answers to this machine's names
         (localhost, IPs, .local, its host name, its tailnet name) and to each --allow-host
  import <provider> [--data <dir>] [--courses a1,a2] [--editions ru-de,en-de] [--refresh]
         download and normalise a course; re-running fetches only what is missing
         providers: ${providerIds().join(", ")}
  verify [--data <dir>] [--notes]
         check every installed course: schemas, keys, answers, locale texts, media
  profiles [--data <dir>]
         list the profiles; every profile is equal in the app, these are the server's matters:
  profiles registration on|off     let new profiles be made from the app, or not (on by default)
  profiles delete <id>             delete a profile with its data
  profiles export <name|id> --to <file|folder>
                                   the profile as a file (.sprachanker-profile) to import on another
                                   machine: its progress, words, settings and recordings, no API keys
  profiles import <file>           a profile file imported as a new profile
  courses [--data <dir>]
         list the installed courses and exams with their editions
  courses export <series/course> [--editions ru-de,en-de] --to <file|folder>
                                   a course or exam as a file (.sprachanker-course) to import on another
                                   machine: its files, the media they use (every edition, or those given)
  courses export --all --to <folder>
                                   every course and exam, every edition: a file a series' courses that
                                   share media (a course in all its languages, its videos once), and
                                   whether every course went into one
  courses import <file>            a course file installed here (each course of it replaced when it
                                   differs; progress kept), then verified
  courses remove <series/course>   a course or exam removed from this computer: its files and the
                                   media no other course uses (progress kept; download it again)
  version
         the version of this binary
  backup [--data <dir>] --to <folder>
         copy what cannot be downloaded again into a new folder there: the databases, recordings,
         imported decks and the key the API keys are sealed with

The data root holds library/ and profiles/: --data, else $SPRACHANKER_DATA, else the app-data folder.`;

export interface Embedded {
  /** URL path → embedded file path of the built web app (set by the compiled binary's entry). */
  webFiles: Record<string, string>;
  /** The Worker that makes an imported profile's database ready: an entry of the binary of its own,
   *  named as the build gives it. */
  profileDbWorker?: string;
}

const list = (value: string | undefined) =>
  value
    ?.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const log = (line: string) => console.log(`${new Date().toTimeString().slice(0, 8)} ${line}`);

const HOST_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/** What `serve` is told: where to listen, the data root, the names it also answers to. */
export function serveOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      data: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: String(DEFAULT_PORT) },
      "allow-host": { type: "string", multiple: true, default: [] },
    },
  });
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port) || port > 65535) {
    throw new Error(`invalid --port: ${values.port}`);
  }
  const allowHosts = values["allow-host"].map((name) => {
    const host = name.trim().toLowerCase().replace(/\.$/, "");
    if (!HOST_NAME.test(host)) throw new Error(`invalid --allow-host: ${name} (a host name only)`);
    return host;
  });
  return { hostname: values.host, port, dataRoot: resolveDataRoot(values.data), allowHosts };
}

function serve(args: string[], webAssets: WebAssets, profileDbWorker?: string): void {
  const options = serveOptions(args);
  const server = startServer({ ...options, webAssets, appVersion: pkg.version, profileDbWorker });
  console.log(`SprachAnker is running at ${server.url} (data: ${options.dataRoot})`);
}

async function importCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      data: { type: "string" },
      courses: { type: "string" },
      editions: { type: "string" },
      refresh: { type: "boolean", default: false },
    },
  });
  const provider = positionals[0];
  if (!provider) throw new Error(`which provider? ${providerIds().join(", ")}`);
  const report = await importCourse(provider, {
    dataRoot: resolveDataRoot(values.data),
    courses: list(values.courses),
    editions: list(values.editions),
    refresh: values.refresh,
    log,
  });
  const normalised = Object.entries(report.normalised);
  if (!normalised.length) {
    // Nothing matched --courses / --editions (a typo selects nothing).
    log(`nothing imported: no course of ${provider} matches the --courses / --editions given`);
    process.exitCode = 1;
  }
  for (const [course, r] of normalised) {
    log(
      `${course}: ${r.lessons} lessons, ${r.unknown} unknown exercises, ` +
        `${r.leftOut ? `${r.leftOut} questions left out, ` : ""}${r.problems} invalid files` +
        (r.corrections
          ? `, ${r.corrections.applied} corrections applied, ${r.corrections.stale.length} stale`
          : ""),
    );
    if (r.problems) process.exitCode = 1;
  }
  if (report.goneMedia.length) {
    log(`${report.goneMedia.length} media files are not at the source (left out):`);
    for (const line of report.goneMedia.slice(0, 20)) log(`  ${line}`);
  }
  if (report.failedMedia.length) {
    log(`${report.failedMedia.length} media files failed (run again to retry):`);
    for (const line of report.failedMedia.slice(0, 20)) log(`  ${line}`);
    process.exitCode = 1;
  }
}

async function verifyCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { data: { type: "string" }, notes: { type: "boolean", default: false } },
  });
  const dataRoot = resolveDataRoot(values.data);
  const reports = await verifyData(dataRoot);
  if (!reports.length) {
    console.log(`no courses installed in ${dataRoot} (is --data right?)`);
    process.exitCode = 1;
  }
  for (const r of reports) {
    const types = Object.entries(r.exercises)
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${type} ${n}`)
      .join(", ");
    console.log(
      `${r.problems.length ? "✗" : "✓"} ${r.series}/${r.course} [${r.editions.join(", ")}]: ` +
        `${r.units} units, ${r.lessons} lessons, ${r.exams ? `${r.exams} exams, ` : ""}` +
        `${r.items} items, ${r.vocab} words, ` +
        `media ${r.media.referenced - r.media.missing}/${r.media.referenced}`,
    );
    if (types) console.log(`    exercises: ${types}`);
    for (const p of r.problems.slice(0, 30)) console.log(`    problem: ${p.text}`);
    if (r.problems.length > 30) console.log(`    … ${r.problems.length - 30} more problems`);
    const notes = values.notes ? r.notes : r.notes.slice(0, 3);
    for (const n of notes) console.log(`    note: ${n}`);
    if (!values.notes && r.notes.length > 3)
      console.log(`    … ${r.notes.length - 3} more notes (--notes)`);
  }
  if (reports.some((r) => r.problems.length)) process.exitCode = 1;
}

/** What the server refuses a profile file for, in words (the app's catalogs are the web's). */
const PROFILE_FILE_ERRORS: Record<string, string> = {
  not_a_profile_file: "this is not a SprachAnker profile file (.sprachanker-profile)",
  profile_file_damaged: "this profile file is damaged or was changed after it was exported",
  profile_file_too_large: "the profile file would be over 4 GB",
  profile_from_newer_app:
    "this profile comes from a newer version of SprachAnker: update it here first",
  not_enough_space: "there is not enough free space on the disk",
  profile_import_busy: "another profile file is being imported: try again when it is done",
  name_required: "the profile has no name yet: finish its onboarding in the app first",
};
/** What the server refuses a course bundle for, in words. */
const COURSE_BUNDLE_ERRORS: Record<string, string> = {
  not_a_course_bundle: "this is not a SprachAnker course file (.sprachanker-course)",
  course_bundle_damaged: "this course file is damaged or was changed after it was exported",
  course_bundle_too_large: "the course file would be over 16 GB",
  course_bundle_from_newer_app:
    "this course file comes from a newer version of SprachAnker: update it here first",
  course_bundle_clash:
    "this library has other files under the names of the course's media: download the course here instead",
  course_import_busy: "another course file is being imported: try again when it is done",
  series_busy:
    "courses of its source are being downloaded or imported by another program: try again when it is done",
  not_enough_space: "there is not enough free space on the disk",
};
const inWords = (error: unknown, words = PROFILE_FILE_ERRORS) =>
  error instanceof Error && words[error.message] ? new Error(words[error.message]) : error;

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

async function profilesCommand(args: string[], embedded?: Embedded): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { data: { type: "string" }, to: { type: "string" } },
  });
  const profiles = profileAdmin(resolveDataRoot(values.data), pkg.version, {
    profileDbWorker: embedded?.profileDbWorker,
  });
  const [action, arg] = positionals;
  switch (action) {
    case undefined:
      for (const p of profiles.list()) console.log(`${p.id}  ${p.name || "(no name yet)"}`);
      console.log(`registration: ${profiles.registrationOpen() ? "on" : "off"}`);
      return;
    case "registration":
      if (arg !== "on" && arg !== "off") throw new Error("registration on or off?");
      profiles.setRegistration(arg === "on");
      console.log(`registration: ${arg}`);
      return;
    case "delete":
      if (!arg) throw new Error("which profile? (sprachanker profiles lists them)");
      profiles.remove(arg);
      console.log(`${arg}: deleted`);
      return;
    case "export": {
      if (!arg) throw new Error("which profile? (sprachanker profiles lists them)");
      const to = values.to;
      if (!to) throw new Error("where to? --to <file or folder>");
      const profile = profiles.find(arg);
      const into = statSync(to, { throwIfNoEntry: false })?.isDirectory();
      const done = await profiles
        .exportTo(profile.id, (fileName) => {
          const file = into ? join(to, fileName) : to;
          if (existsSync(file)) throw new Error(`${file} exists: give another --to`);
          return file;
        })
        .catch((error: unknown) => {
          throw inWords(error);
        });
      console.log(`${profile.name}: exported to ${done.file} (${megabytes(done.bytes)})`);
      if (done.leftOut.apiKeys.length)
        console.log(`  not included: the API keys of ${done.leftOut.apiKeys.join(", ")}`);
      if (done.leftOut.endpointLogins.length)
        console.log(
          `  not included: the user name and password in the address of ${done.leftOut.endpointLogins.join(", ")}`,
        );
      return;
    }
    case "import": {
      if (!arg) throw new Error("which file? sprachanker profiles import <file>");
      if (!statSync(arg, { throwIfNoEntry: false })?.isFile()) throw new Error(`no file ${arg}`);
      const { profile, leftOut, missing } = await profiles
        .importFile(arg)
        .catch((error: unknown) => {
          throw inWords(error);
        });
      console.log(`${profile.name}: imported as profile ${profile.id}`);
      if (leftOut.apiKeys.length)
        console.log(
          `  not included: the API keys of ${leftOut.apiKeys.join(", ")} (enter them again in Settings → AI assistant)`,
        );
      if (leftOut.endpointLogins.length)
        console.log(
          `  not included: the user name and password in the address of ${leftOut.endpointLogins.join(", ")} (enter the key again in Settings → AI assistant)`,
        );
      const named = (c: { key: string; title: string | null; editions: string[] }) =>
        `${c.title ?? c.key}${c.editions.length ? ` (${c.editions.join(", ")})` : ""}`;
      for (const c of missing.courses) console.log(`  not here: the course ${named(c)}`);
      for (const e of missing.exams) console.log(`  not here: the exam ${named(e)}`);
      for (const d of missing.decks) console.log(`  not here: the deck ${d.title ?? d.id}`);
      return;
    }
    default:
      throw new Error(`unknown: profiles ${action}`);
  }
}

async function coursesCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      data: { type: "string" },
      to: { type: "string" },
      editions: { type: "string" },
      all: { type: "boolean", default: false },
    },
  });
  const dataRoot = resolveDataRoot(values.data);
  const courses = courseAdmin(dataRoot, pkg.version);
  const [action, arg] = positionals;
  const refused = (error: unknown) => {
    throw inWords(error, COURSE_BUNDLE_ERRORS);
  };
  switch (action) {
    case undefined: {
      const all = courses.list();
      if (!all.length) console.log(`no courses installed in ${dataRoot}`);
      for (const c of all) console.log(`${c.series}/${c.course}  [${c.editions.join(", ")}]`);
      return;
    }
    case "export": {
      const listed = "(sprachanker courses lists them)";
      const to = values.to;
      if (values.all) {
        if (!to || !statSync(to, { throwIfNoEntry: false })?.isDirectory())
          throw new Error("where to? --to <folder> (it must exist)");
        const installed = courses.list();
        const written = await courses
          .exportAll(
            (fileName) => {
              const file = join(to, fileName);
              if (existsSync(file)) throw new Error(`${file} exists: give another --to`);
              return file;
            },
            (done) =>
              console.log(
                `${done.file} (${megabytes(done.bytes)}): ${done.courses.map((c) => c.course).join(", ")}`,
              ),
          )
          .catch(refused);
        // Every course installed, with every edition, in one file.
        const exported = written.flatMap((w) => w.courses);
        const missing = installed.filter((c) => {
          const e = exported.find((x) => x.course === `${c.series}/${c.course}`);
          return !e || c.editions.some((ed) => !e.editions.includes(ed));
        });
        const bytes = written.reduce((n, w) => n + w.bytes, 0);
        console.log(
          `${written.length} files, ${exported.length} of ${installed.length} courses, ${megabytes(bytes)}`,
        );
        if (missing.length) {
          console.log(`not exported: ${missing.map((c) => `${c.series}/${c.course}`).join(", ")}`);
          process.exitCode = 1;
        }
        return;
      }
      if (!arg) throw new Error(`which course? ${listed}`);
      if (!to) throw new Error("where to? --to <file or folder>");
      const course = courses.list().find((c) => `${c.series}/${c.course}` === arg);
      if (!course) throw new Error(`no course ${arg} here ${listed}`);
      const editions = list(values.editions);
      const absent = editions?.filter((e) => !course.editions.includes(e)) ?? [];
      if (absent.length)
        throw new Error(`${arg} has no edition ${absent.join(", ")} here ${listed}`);
      const into = statSync(to, { throwIfNoEntry: false })?.isDirectory();
      const done = await courses
        .exportTo(course.series, [course.course], editions, (fileName) => {
          const file = into ? join(to, fileName) : to;
          if (existsSync(file)) throw new Error(`${file} exists: give another --to`);
          return file;
        })
        .catch(refused);
      console.log(
        `${arg} [${done.courses[0]?.editions.join(", ")}]: exported to ${done.file} (${megabytes(done.bytes)})`,
      );
      return;
    }
    case "import": {
      if (!arg) throw new Error("which file? sprachanker courses import <file>");
      if (!statSync(arg, { throwIfNoEntry: false })?.isFile()) throw new Error(`no file ${arg}`);
      const done = await courses.importFile(arg).catch(refused);
      for (const c of done.courses) {
        const status = {
          added: "installed",
          same: "already here, the same: nothing changed",
          replaced: "replaced by the file's version (progress kept)",
        }[c.status];
        console.log(`${c.key} [${c.editions.join(", ")}]: ${status}`);
        console.log(
          c.check.problems
            ? `  verify: ${c.check.problems} problems (sprachanker verify lists them)`
            : "  verify: ✓",
        );
        if (c.check.problems) process.exitCode = 1;
      }
      return;
    }
    case "remove": {
      const listed = "(sprachanker courses lists them)";
      if (!arg) throw new Error(`which course? ${listed}`);
      const course = courses.list().find((c) => `${c.series}/${c.course}` === arg);
      if (!course) throw new Error(`no course ${arg} here ${listed}`);
      const done = await courses.remove(course.series, course.course).catch((error: unknown) => {
        throw (error as { code?: string }).code === "SERIES_BUSY"
          ? new Error(COURSE_BUNDLE_ERRORS.series_busy)
          : error;
      });
      console.log(
        `${arg}: removed, ${done.files} files (${megabytes(done.bytes)})` +
          (done.shared ? `; ${done.shared} media files other courses use kept` : ""),
      );
      // A running server keeps the course's words its review cards read: restarted, it reads anew.
      if (done.server)
        console.log(
          `a server runs on this data folder (pid ${done.server}): restart it (sprachanker serve) so it forgets the course`,
        );
      return;
    }
    default:
      throw new Error(`unknown: courses ${action}`);
  }
}

function backupCommand(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: { data: { type: "string" }, to: { type: "string" } },
  });
  if (!values.to) throw new Error("where to? --to <folder>");
  const dataRoot = resolveDataRoot(values.data);
  const { folder, bytes } = backupData(dataRoot, values.to);
  console.log(`backed up ${dataRoot} to ${folder} (${megabytes(bytes)})`);
  console.log(
    "  it holds secret.key, which opens the stored API keys, and everyone's learning: keep it private",
  );
  console.log(
    "  to restore: server.sqlite, profiles/ and decks/ into a data root, secret.key into the app-data folder, no server running",
  );
}

/** Runs a command; a failure is one line and exit code 1, never a stack trace. */
export async function main(argv: string[], embedded?: Embedded): Promise<void> {
  try {
    await run(argv, embedded);
  } catch (error) {
    console.error(`sprachanker: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function run(argv: string[], embedded?: Embedded): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "serve":
      serve(
        rest,
        // From sources: the web build next to this app (`bun run build:web`).
        embedded
          ? fileAssets(embedded.webFiles)
          : directoryAssets(resolve(import.meta.dir, "../../web/dist")),
        embedded?.profileDbWorker,
      );
      break;
    case "import":
      await importCommand(rest);
      break;
    case "verify":
      await verifyCommand(rest);
      break;
    case "profiles":
      await profilesCommand(rest, embedded);
      break;
    case "courses":
      await coursesCommand(rest);
      break;
    case "backup":
      backupCommand(rest);
      break;
    case "version":
      console.log(pkg.version);
      break;
    default:
      console.log(USAGE);
      process.exitCode = command === undefined || command === "help" ? 0 : 1;
  }
}

if (import.meta.main) await main(process.argv.slice(2));
