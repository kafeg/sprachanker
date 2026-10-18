// Whether a newer version is out: GitHub Releases' latest (never a draft, nor the speech engines'
// pre-releases), compared with this build by MAJOR.MINOR.N — asked at most every few hours, with
// nothing about the learner in the request. Installing it is the runtime's: the desktop app updates
// itself (its shell), the phone app through its UpdateHost (the release's APK, checked, handed to the
// system's installer), the installer's program by its command again.
import type { AppSystem, UpdatedBy, UpdateStatus } from "@sprachanker/schema";
import { z } from "zod";
import { ServiceError } from "../errors.ts";

export const RELEASES_LATEST = "https://api.github.com/repos/kafeg/sprachanker/releases/latest";
/** Where every release's files are: a file from anywhere else is never installed. */
export const RELEASE_FILES = "https://github.com/kafeg/sprachanker/releases/download/";
/** A check that answered is kept this long; one that failed is tried again after RETRY_MS. */
export const CHECK_EVERY_MS = 6 * 3600_000;
export const RETRY_MS = 30 * 60_000;
const ASK_MS = 15_000;

/** A MAJOR.MINOR.N version's numbers (a leading `v` allowed), else undefined. */
export function versionNumbers(version: string): [number, number, number] | undefined {
  const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** Whether `candidate` is a later version than `current`; a version not MAJOR.MINOR.N is never
 *  later, and neither is the same one or an earlier one (no downgrade is offered). */
export function isNewer(candidate: string, current: string) {
  const a = versionNumbers(candidate);
  const b = versionNumbers(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  return false;
}

/** A release's file: its download address, size and sha256 (GitHub's digest of it). */
export interface ReleaseFile {
  name: string;
  url: string;
  size: number;
  sha256?: string;
}

/** How the runtime installs a release itself (the phone app); without one the learner does. */
export interface UpdateHost {
  /** The release's file this build installs, if the release has one. */
  pick(files: ReleaseFile[]): ReleaseFile | undefined;
  /** Downloads the file, checks it against its sha256 and hands it to the system's installer:
   *  resolves once the installer has it (the system then asks the learner). */
  install(file: ReleaseFile): Promise<void>;
}

/** What updates this build, on which system, and the runtime's way to install a release itself. */
export interface UpdateConfig {
  by: Exclude<UpdatedBy, "source">;
  system: AppSystem;
  host?: UpdateHost;
  /** Where the latest release is asked (tests: a fake's); else GitHub's RELEASES_LATEST. */
  releases?: string;
}

export interface UpdatesConfig {
  version: string;
  /** Absent: a build from the sources, which asks for no release. */
  update?: UpdateConfig;
  fetch: typeof fetch;
  now: () => number;
}

const Release = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.string(),
      size: z.number(),
      digest: z.string().nullish(),
    }),
  ),
});

interface Latest {
  version: string;
  url: string;
  files: ReleaseFile[];
}

/** A release's files that may be installed: from the release's own downloads, over HTTPS. */
function filesOf(release: z.infer<typeof Release>): ReleaseFile[] {
  return release.assets
    .filter((a) => a.browser_download_url.startsWith(RELEASE_FILES))
    .map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size,
      sha256: /^sha256:([0-9a-f]{64})$/.exec(a.digest ?? "")?.[1],
    }));
}

export function createUpdates(config: UpdatesConfig) {
  let known: { at: number; latest?: Latest; failed: boolean } | undefined;
  let asking: Promise<Latest | undefined> | undefined;

  async function ask(): Promise<Latest | undefined> {
    try {
      const res = await config.fetch(config.update?.releases ?? RELEASES_LATEST, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "SprachAnker" },
        signal: AbortSignal.timeout(ASK_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const release = Release.parse(await res.json());
      const latest =
        release.draft || release.prerelease
          ? undefined
          : {
              version: release.tag_name.replace(/^v/, ""),
              url: release.html_url,
              files: filesOf(release),
            };
      known = { at: config.now(), latest, failed: false };
    } catch (error) {
      console.error(
        "checking for a newer version:",
        error instanceof Error ? error.message : error,
      );
      known = { at: config.now(), latest: known?.latest, failed: true };
    }
    return known.latest;
  }

  /** The latest release, asked again once what is known is old. A build from the sources asks none. */
  async function latest() {
    if (!config.update) return undefined;
    const age = known ? config.now() - known.at : Number.POSITIVE_INFINITY;
    if (known && age < (known.failed ? RETRY_MS : CHECK_EVERY_MS)) return known.latest;
    asking ??= ask().finally(() => {
      asking = undefined;
    });
    return asking;
  }

  /** The release this build would update to: later than it, with this host's file when it has one. */
  async function newer() {
    const release = await latest();
    return release && isNewer(release.version, config.version) ? release : undefined;
  }

  return {
    async status(): Promise<UpdateStatus> {
      const release = await newer();
      return {
        version: config.version,
        by: config.update?.by ?? "source",
        system: config.update?.system,
        newer: release && { version: release.version, url: release.url },
        installs: !!(release && config.update?.host?.pick(release.files)),
      };
    },
    /** The newer release installed by the host: its file downloaded, checked, handed to the system. */
    async install() {
      const release = await newer();
      const host = config.update?.host;
      const file = release && host?.pick(release.files);
      if (!file || !host) throw new ServiceError("no_update", 409);
      try {
        await host.install(file);
      } catch (error) {
        console.error("installing", file.name, error);
        throw new ServiceError("update_failed", 502);
      }
    },
  };
}
export type Updates = ReturnType<typeof createUpdates>;
