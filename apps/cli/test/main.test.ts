import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { profileAdmin } from "@sprachanker/server";
import { main, serveOptions } from "../src/main.ts";

/** Runs the CLI; returns what it printed and its exit code. */
async function cli(...argv: string[]) {
  const out: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
  const error = spyOn(console, "error").mockImplementation((line: string) => void out.push(line));
  process.exitCode = 0;
  try {
    await main(argv);
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { out: out.join("\n"), code: process.exitCode };
}

afterEach(() => {
  process.exitCode = 0;
});

test("verify on a folder without courses says so and fails", async () => {
  const data = mkdtempSync(join(tmpdir(), "sprachanker-cli-"));
  const { out, code } = await cli("verify", "--data", data);
  expect(out).toContain("no courses installed in");
  expect(code).toBe(1);
});

test("a failure is one line and exit code 1, not a stack trace", async () => {
  const unknown = await cli("import", "nope", "--data", join(tmpdir(), "sprachanker-nowhere"));
  expect(unknown.out).toStartWith("sprachanker: unknown provider nope");
  expect(unknown.out).not.toContain("    at ");
  expect(unknown.code).toBe(1);
  const port = await cli("serve", "--port", "");
  expect([port.out, port.code]).toEqual(["sprachanker: invalid --port: ", 1]);
  const option = await cli("verify", "--nope");
  expect([option.out.startsWith("sprachanker: "), option.code]).toEqual([true, 1]);
});

test("serve answers to the names given by --allow-host, each a host name", async () => {
  const data = mkdtempSync(join(tmpdir(), "sprachanker-cli-"));
  const options = serveOptions([
    "--data",
    data,
    "--allow-host",
    "Study.Example.",
    "--allow-host",
    "phone-proxy.example",
  ]);
  expect(options.allowHosts).toEqual(["study.example", "phone-proxy.example"]);
  expect(serveOptions(["--data", data]).allowHosts).toEqual([]);
  const bad = await cli("serve", "--data", data, "--allow-host", "https://study.example:443");
  expect([bad.out, bad.code]).toEqual([
    "sprachanker: invalid --allow-host: https://study.example:443 (a host name only)",
    1,
  ]);
});

test("profiles export and import: a profile moved to another data root as a file", async () => {
  const from = mkdtempSync(join(tmpdir(), "sprachanker-cli-"));
  const to = mkdtempSync(join(tmpdir(), "sprachanker-cli-"));
  const files = mkdtempSync(join(tmpdir(), "sprachanker-cli-files-"));
  profileAdmin(from).create({ name: "Mila" });
  profileAdmin(to).create({ name: "Mila" });
  // By name, into a folder: the file takes its own name there.
  const exported = await cli("profiles", "export", "mila", "--data", from, "--to", files);
  expect(exported.code).toBe(0);
  const [file] = readdirSync(files);
  expect(file).toMatch(/^Mila-\d{4}-\d{2}-\d{2}\.sprachanker-profile$/);
  expect(exported.out).toStartWith(`Mila: exported to ${join(files, file as string)} (`);
  // Its owner's only: one's whole learning.
  expect(statSync(join(files, file as string)).mode & 0o777).toBe(0o600);
  // Never over a file there.
  const again = await cli("profiles", "export", "Mila", "--data", from, "--to", files);
  expect([again.out, again.code]).toEqual([
    `sprachanker: ${join(files, file as string)} exists: give another --to`,
    1,
  ]);
  expect(readdirSync(join(from, "profiles/.transfers"))).toEqual([]);

  const imported = await cli("profiles", "import", join(files, file as string), "--data", to);
  expect(imported.code).toBe(0);
  expect(imported.out).toMatch(/^Mila \(2\): imported as profile [0-9a-z]{26}$/);
  expect((await cli("profiles", "--data", to)).out).toContain("Mila (2)");

  // Not a profile file: said in words.
  const junk = join(files, "junk.sprachanker-profile");
  writeFileSync(junk, "not a zip");
  expect(await cli("profiles", "import", junk, "--data", to)).toEqual({
    out: "sprachanker: this is not a SprachAnker profile file (.sprachanker-profile)",
    code: 1,
  });
  expect((await cli("profiles", "export", "nobody", "--data", from, "--to", files)).out).toBe(
    "sprachanker: no profile nobody (sprachanker profiles lists them)",
  );
});

/** A data root with one course installed by hand: its index and an edition's course file. */
function withCourse() {
  const data = mkdtempSync(join(tmpdir(), "sprachanker-cli-"));
  const put = (path: string, value: object) => {
    const file = join(data, "library/sprachanker.cli", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  put("canonical/mini/course.json", {
    format: 1,
    key: "sprachanker.cli/mini",
    units: [],
    exams: [],
    goals: [],
  });
  put("locale/ru-de/mini/course.json", {
    format: 1,
    edition: "ru-de",
    course: "sprachanker.cli/mini",
    sourceId: "1",
    title: "Mini",
    units: {},
    goals: {},
  });
  return data;
}

test("courses export, import and remove: a course moved to another data root as a file", async () => {
  const from = withCourse();
  const to = mkdtempSync(join(tmpdir(), "sprachanker-cli-"));
  const files = mkdtempSync(join(tmpdir(), "sprachanker-cli-files-"));
  expect((await cli("courses", "--data", from)).out).toBe("sprachanker.cli/mini  [ru-de]");
  expect((await cli("courses", "--data", to)).out).toBe(`no courses installed in ${to}`);
  const exported = await cli(
    "courses",
    "export",
    "sprachanker.cli/mini",
    "--data",
    from,
    "--to",
    files,
  );
  expect(exported.code).toBe(0);
  const [file] = readdirSync(files);
  expect(file).toMatch(/^sprachanker\.cli-mini-ru-de-\d{4}-\d{2}-\d{2}\.sprachanker-course$/);
  expect(exported.out).toStartWith(
    `sprachanker.cli/mini [ru-de]: exported to ${join(files, file as string)} (`,
  );
  const bundle = join(files, file as string);
  expect(await cli("courses", "import", bundle, "--data", to)).toEqual({
    out: "sprachanker.cli/mini [ru-de]: installed\n  verify: ✓",
    code: 0,
  });
  expect((await cli("courses", "import", bundle, "--data", to)).out).toStartWith(
    "sprachanker.cli/mini [ru-de]: already here, the same: nothing changed",
  );
  expect((await cli("courses", "--data", to)).out).toBe("sprachanker.cli/mini  [ru-de]");
  // Every course: a file each group, and whether every course went into one.
  const all = mkdtempSync(join(tmpdir(), "sprachanker-cli-all-"));
  const everything = await cli("courses", "export", "--all", "--data", from, "--to", all);
  expect(everything.code).toBe(0);
  expect(readdirSync(all)).toHaveLength(1);
  expect(everything.out).toContain("1 files, 1 of 1 courses, ");
  expect(
    (await cli("courses", "export", "--all", "--data", from, "--to", join(all, "nope"))).out,
  ).toBe("sprachanker: where to? --to <folder> (it must exist)");

  // Refusals in words.
  expect(
    (await cli("courses", "export", "sprachanker.cli/nope", "--data", from, "--to", files)).out,
  ).toBe("sprachanker: no course sprachanker.cli/nope here (sprachanker courses lists them)");
  expect(
    (
      await cli(
        "courses",
        "export",
        "sprachanker.cli/mini",
        "--editions",
        "fr-de",
        "--data",
        from,
        "--to",
        files,
      )
    ).out,
  ).toBe(
    "sprachanker: sprachanker.cli/mini has no edition fr-de here (sprachanker courses lists them)",
  );
  // Removed from the second data root: listed no more; again, no such course.
  expect((await cli("courses", "remove", "sprachanker.cli/mini", "--data", to)).out).toStartWith(
    "sprachanker.cli/mini: removed, ",
  );
  expect((await cli("courses", "--data", to)).out).toBe(`no courses installed in ${to}`);
  expect((await cli("courses", "remove", "sprachanker.cli/mini", "--data", to)).out).toBe(
    "sprachanker: no course sprachanker.cli/mini here (sprachanker courses lists them)",
  );
  const junk = join(files, "junk.sprachanker-course");
  writeFileSync(junk, "not a zip");
  expect(await cli("courses", "import", junk, "--data", to)).toEqual({
    out: "sprachanker: this is not a SprachAnker course file (.sprachanker-course)",
    code: 1,
  });
});

test("backup needs a folder to write to", async () => {
  // A backup itself copies this machine's secret.key: tested in the server (runtime/backup.ts) with
  // a key of its own.
  const data = mkdtempSync(join(tmpdir(), "sprachanker-cli-"));
  expect(await cli("backup", "--data", data)).toEqual({
    out: "sprachanker: where to? --to <folder>",
    code: 1,
  });
});

test("an unknown command prints the usage and fails; help succeeds", async () => {
  expect((await cli("nope")).code).toBe(1);
  const help = await cli("help");
  expect([help.out.startsWith("Usage: sprachanker"), help.code]).toEqual([true, 0]);
});
