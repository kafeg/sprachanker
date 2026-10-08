// The profiles on this server (06, "Profiles and access"): every one equal, each with its own database
// file; a name and colour for "Who is studying?" and whether the onboarding was finished. A profile is
// chosen, not unlocked: profiles keep people's learning apart, they are no security boundary (owner,
// 2026-10-08). Registration (open by default) is the server's own setting,
// changed by the `sprachanker` command. Signing in is devices.ts.
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import type { ServerDb } from "../db/server/db.ts";
import { profiles, serverSettings } from "../db/server/schema.ts";
import { ServiceError } from "../errors.ts";
import type { MediaBlob } from "../media.ts";

/** The profiles' database files (runtime adapter): opened on first use, removed with the profile. */
export interface ProfileFiles {
  exists(id: string): boolean;
  open(id: string): ProfileDb;
  remove(id: string): void;
  /** The profile's recordings folder (`profiles/<id>/recordings`). */
  recordings(id: string): RecordingFiles;
}

/** Files in a profile's recordings folder, by name (`<id>.<ext>`). */
export interface RecordingFiles {
  write(name: string, bytes: Uint8Array): Promise<void>;
  /** The file, if there is one by that name. */
  read(name: string): MediaBlob | undefined;
  list(): Array<{ name: string; size: number }>;
  remove(names: string[]): void;
}

/** The first profile's id: the folder the single profile had before there were several. */
export const FIRST_PROFILE = "local";
/** Tile colours (design tokens of the web app). */
export const COLOURS = ["amber", "teal", "rose", "violet", "sky", "lime"] as const;

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
  /** A profile as the app shows it. */
  const view = (r: ProfileRow) => ({
    id: r.id,
    name: r.name,
    colour: r.colour,
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
