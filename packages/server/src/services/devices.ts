// Devices signed in to a profile (06, "Profiles and access"): a long random token lives only in the
// device's HttpOnly cookie, its SHA-256 here — so a device can be signed out alone, and a copied
// database signs nothing in. Not a JWT: one server and one database decide, and revoking is a row.
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { ServerDb } from "../db/server/db.ts";
import { devices } from "../db/server/schema.ts";
import { base64url, sha256 } from "../security/encoding.ts";

/** How long a device stays signed in without being used (each use extends it). */
export const DEVICE_LIFETIME_MS = 365 * 86_400_000;
/** Last-seen times are written at most this often (not on every request). */
const SEEN_EVERY_MS = 3_600_000;

export function createDevices(deps: { db: ServerDb; now: () => number }) {
  const { db, now } = deps;
  return {
    /** Signs a device in to a profile: the token to put in its cookie (stored only as a hash). */
    async issue(profileId: string, userAgent: string) {
      const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
      db.insert(devices)
        .values({
          id: ulid(now()),
          profileId,
          tokenHash: await sha256(token),
          userAgent: userAgent.slice(0, 300),
          createdAt: now(),
          lastSeenAt: now(),
        })
        .run();
      return token;
    },

    /** The profile a device token signs in, or undefined (unknown, signed out, or unused too long). */
    async resolve(token: string | undefined) {
      if (!token) return undefined;
      const row = db
        .select()
        .from(devices)
        .where(eq(devices.tokenHash, await sha256(token)))
        .get();
      if (!row) return undefined;
      if (row.lastSeenAt + DEVICE_LIFETIME_MS < now()) {
        db.delete(devices).where(eq(devices.id, row.id)).run();
        return undefined;
      }
      const refreshed = now() - row.lastSeenAt > SEEN_EVERY_MS;
      if (refreshed)
        db.update(devices).set({ lastSeenAt: now() }).where(eq(devices.id, row.id)).run();
      /** `refreshed`: the device's time was extended (its cookie is set again). */
      return { profileId: row.profileId, deviceId: row.id, refreshed };
    },

    /** A profile's devices, the last used first. */
    list: (profileId: string) =>
      db
        .select({
          id: devices.id,
          userAgent: devices.userAgent,
          createdAt: devices.createdAt,
          lastSeenAt: devices.lastSeenAt,
        })
        .from(devices)
        .where(eq(devices.profileId, profileId))
        .all()
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt),

    /** Signs one of a profile's devices out; false when it has no such device. */
    revoke(profileId: string, deviceId: string) {
      return (
        db
          .delete(devices)
          .where(and(eq(devices.id, deviceId), eq(devices.profileId, profileId)))
          .returning({ id: devices.id })
          .all().length > 0
      );
    },
  };
}
export type Devices = ReturnType<typeof createDevices>;
