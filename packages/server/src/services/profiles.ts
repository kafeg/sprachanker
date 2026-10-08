// The profiles on this server (06, "Profiles and access"): every one equal, each with its own database
// file; a name and colour for "Who is studying?", an optional PIN tried a limited number of times, and
// whether the onboarding was finished. Registration (open by default) is the server's own setting,
// changed by the `sprachanker` command. Signing in is devices.ts.
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import type { ServerDb } from "../db/server/db.ts";
import { profiles, serverSettings } from "../db/server/schema.ts";
import { ServiceError } from "../errors.ts";
import { base64url, fromBase64url } from "../security/encoding.ts";

/** The profiles' database files (runtime adapter): opened on first use, removed with the profile. */
export interface ProfileFiles {
  exists(id: string): boolean;
  open(id: string): ProfileDb;
  remove(id: string): void;
}

/** The first profile's id: the folder the single profile had before there were several. */
export const FIRST_PROFILE = "local";
/** Tile colours (design tokens of the web app). */
export const COLOURS = ["amber", "teal", "rose", "violet", "sky", "lime"] as const;

const PIN = /^\d{4,8}$/;
/** Wrong PINs allowed in a row before a pause, which doubles with each further miss (up to an hour). */
const FREE_TRIES = 5;
const PAUSE_MS = 60_000;
const PAUSE_MAX_MS = 3_600_000;
const PBKDF2_ROUNDS = 210_000;

async function pinHash(pin: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations: PBKDF2_ROUNDS,
    },
    key,
    256,
  );
  return base64url(bits);
}

export type ProfileRow = typeof profiles.$inferSelect;

export function createProfiles(deps: { db: ServerDb; files: ProfileFiles; now: () => number }) {
  const { db, files, now } = deps;
  const row = (id: string) => db.select().from(profiles).where(eq(profiles.id, id)).get();
  /** A name as kept: trimmed, at most 40 characters, never empty. */
  const nameOf = (name: string) => {
    const kept = name.trim().slice(0, 40);
    if (!kept) throw new ServiceError("name_required");
    return kept;
  };
  /** A profile as the app shows it: never its PIN. */
  const view = (r: ProfileRow) => ({
    id: r.id,
    name: r.name,
    colour: r.colour,
    hasPin: !!r.pinHash,
    onboarded: !!r.onboarded,
  });

  const self = {
    /** The single profile from before profiles existed becomes the first one (not yet onboarded). */
    adoptFirst() {
      if (db.select({ id: profiles.id }).from(profiles).get() || !files.exists(FIRST_PROFILE))
        return;
      db.insert(profiles)
        .values({ id: FIRST_PROFILE, name: "", colour: COLOURS[0], createdAt: now() })
        .run();
    },

    list: () => db.select().from(profiles).orderBy(profiles.createdAt).all().map(view),

    /** One profile as the app shows it; 404 when there is none. */
    get(id: string) {
      const r = row(id);
      if (!r) throw new ServiceError("no_such_profile", 404);
      return view(r);
    },

    /** Whether new profiles may be made (the server's setting; on by default). */
    registrationOpen() {
      const r = db
        .select()
        .from(serverSettings)
        .where(eq(serverSettings.key, "registration"))
        .get();
      return r ? JSON.parse(r.valueJson) !== false : true;
    },
    setRegistration(open: boolean) {
      db.insert(serverSettings)
        .values({ key: "registration", valueJson: JSON.stringify(open) })
        .onConflictDoUpdate({
          target: serverSettings.key,
          set: { valueJson: JSON.stringify(open) },
        })
        .run();
    },

    /** A new profile (its database made at once); refused while registration is closed, unless it
     *  is the first. */
    create(input: { name: string; colour?: string }) {
      const name = nameOf(input.name);
      const any = db.select({ id: profiles.id }).from(profiles).get();
      if (any && !self.registrationOpen()) throw new ServiceError("registration_closed", 403);
      const id = any ? ulid(now()).toLowerCase() : FIRST_PROFILE;
      const count = db.select({ id: profiles.id }).from(profiles).all().length;
      db.insert(profiles)
        .values({
          id,
          name,
          colour: COLOURS.includes(input.colour as never)
            ? (input.colour as string)
            : (COLOURS[count % COLOURS.length] as string),
          createdAt: now(),
        })
        .run();
      files.open(id);
      return self.get(id);
    },

    update(id: string, input: { name?: string; colour?: string; onboarded?: boolean }) {
      self.get(id);
      const values: Partial<ProfileRow> = {};
      if (input.name !== undefined) values.name = nameOf(input.name);
      if (input.colour !== undefined) {
        if (!COLOURS.includes(input.colour as never)) throw new ServiceError("bad_colour");
        values.colour = input.colour;
      }
      // Onboarding ends with a name (the profile from before profiles had none).
      if (input.onboarded && !(values.name ?? self.get(id).name))
        throw new ServiceError("name_required");
      if (input.onboarded !== undefined) values.onboarded = input.onboarded ? 1 : 0;
      if (Object.keys(values).length)
        db.update(profiles).set(values).where(eq(profiles.id, id)).run();
      return self.get(id);
    },

    /** Sets (4–8 digits) or removes the PIN; the count of wrong ones starts over. */
    async setPin(id: string, pin: string | null) {
      self.get(id);
      if (pin !== null && !PIN.test(pin)) throw new ServiceError("bad_pin");
      const salt = crypto.getRandomValues(new Uint8Array(16));
      db.update(profiles)
        .set(
          pin === null
            ? { pinHash: null, pinSalt: null, failedPins: 0, lockedUntil: null }
            : {
                pinHash: await pinHash(pin, salt),
                pinSalt: base64url(salt),
                failedPins: 0,
                lockedUntil: null,
              },
        )
        .where(eq(profiles.id, id))
        .run();
    },

    /**
     * Checks a PIN. After `FREE_TRIES` wrong ones in a row each further miss pauses the profile, twice
     * as long each time (429 while paused, with the time left); a right one starts the count over.
     */
    async checkPin(id: string, pin: string): Promise<boolean> {
      const r = row(id);
      if (!r) throw new ServiceError("no_such_profile", 404);
      if (!r.pinHash || !r.pinSalt) return false;
      if (r.lockedUntil && r.lockedUntil > now()) throw new ServiceError("pin_paused", 429);
      const right = (await pinHash(pin, fromBase64url(r.pinSalt))) === r.pinHash;
      const failed = right ? 0 : r.failedPins + 1;
      const pause =
        failed > FREE_TRIES - 1 ? Math.min(PAUSE_MS * 2 ** (failed - FREE_TRIES), PAUSE_MAX_MS) : 0;
      db.update(profiles)
        .set({ failedPins: failed, lockedUntil: pause ? now() + pause : null })
        .where(eq(profiles.id, id))
        .run();
      return right;
    },

    /** Removes the PIN of a profile (a server matter: the command line). */
    async reset(id: string) {
      await self.setPin(id, null);
    },

    /** Deletes a profile with its devices and database (a server matter). */
    remove(id: string) {
      self.get(id);
      db.delete(profiles).where(eq(profiles.id, id)).run();
      files.remove(id);
    },
  };
  return self;
}
export type Profiles = ReturnType<typeof createProfiles>;
