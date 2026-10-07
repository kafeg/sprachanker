// Passkeys (06, "Profiles and access"): signing in with Face ID, Touch ID or a fingerprint (WebAuthn,
// @simplewebauthn/server). A passkey belongs to the site it was made on (the host name the browser
// used): one made on localhost does not sign in through the tailnet's name. Challenges live in memory
// for a few minutes: a server restart only asks for a new one.
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import type { ServerDb } from "../db/server/db.ts";
import { passkeys } from "../db/server/schema.ts";
import { ServiceError } from "../errors.ts";
import { base64url, fromBase64url } from "../security/encoding.ts";

/** Where the browser is: the site (host name) and origin passkeys are made and used for. */
export interface Site {
  rpId: string;
  origin: string;
}

const CHALLENGE_MS = 5 * 60_000;

export function createPasskeys(deps: { db: ServerDb; now: () => number }) {
  const { db, now } = deps;
  const challenges = new Map<string, { challenge: string; until: number }>();
  const remember = (key: string, challenge: string) =>
    challenges.set(key, { challenge, until: now() + CHALLENGE_MS });
  /** The challenge asked for, once. */
  const take = (key: string) => {
    const c = challenges.get(key);
    challenges.delete(key);
    if (!c || c.until < now()) throw new ServiceError("passkey_expired", 409);
    return c.challenge;
  };
  const ofProfile = (profileId: string, rpId: string) =>
    db
      .select()
      .from(passkeys)
      .where(and(eq(passkeys.profileId, profileId), eq(passkeys.rpId, rpId)))
      .all();
  const credentials = (rows: Array<typeof passkeys.$inferSelect>) =>
    rows.map((r) => ({ id: r.id, transports: r.transports ? r.transports.split(",") : [] }));

  return {
    /** A profile's passkeys, for the settings. */
    list: (profileId: string) =>
      db
        .select({
          id: passkeys.id,
          rpId: passkeys.rpId,
          createdAt: passkeys.createdAt,
          lastUsedAt: passkeys.lastUsedAt,
        })
        .from(passkeys)
        .where(eq(passkeys.profileId, profileId))
        .all(),

    has: (profileId: string, rpId: string) => ofProfile(profileId, rpId).length > 0,

    /** What the browser needs to make a passkey for a signed-in profile on this site. */
    async registrationOptions(profile: { id: string; name: string }, site: Site) {
      const options = await generateRegistrationOptions({
        rpName: "SprachAnker",
        rpID: site.rpId,
        userName: profile.name || profile.id,
        userID: new TextEncoder().encode(profile.id),
        attestationType: "none",
        excludeCredentials: credentials(ofProfile(profile.id, site.rpId)),
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      });
      remember(`register:${profile.id}`, options.challenge);
      return options;
    },

    /** Keeps the passkey the browser made, once its answer checks out. */
    async register(profileId: string, response: RegistrationResponseJSON, site: Site) {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: take(`register:${profileId}`),
        expectedOrigin: site.origin,
        expectedRPID: site.rpId,
        requireUserVerification: false,
      }).catch(() => undefined);
      if (!result?.verified || !result.registrationInfo)
        throw new ServiceError("passkey_failed", 400);
      const { credential } = result.registrationInfo;
      db.insert(passkeys)
        .values({
          id: credential.id,
          profileId,
          publicKey: base64url(credential.publicKey),
          counter: credential.counter,
          transports: (credential.transports ?? []).join(","),
          rpId: site.rpId,
          createdAt: now(),
        })
        .run();
    },

    /** What the browser needs to sign in to a profile with one of its passkeys on this site. */
    async signInOptions(profileId: string, site: Site) {
      const allow = credentials(ofProfile(profileId, site.rpId));
      if (!allow.length) throw new ServiceError("no_passkey", 404);
      const options = await generateAuthenticationOptions({
        rpID: site.rpId,
        allowCredentials: allow,
        userVerification: "preferred",
      });
      remember(`sign-in:${profileId}`, options.challenge);
      return options;
    },

    /** Whether the browser's answer proves one of the profile's passkeys (its counter moves on). */
    async signIn(profileId: string, response: AuthenticationResponseJSON, site: Site) {
      const expectedChallenge = take(`sign-in:${profileId}`);
      const row = ofProfile(profileId, site.rpId).find((r) => r.id === response.id);
      if (!row) return false;
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: site.origin,
        expectedRPID: site.rpId,
        credential: {
          id: row.id,
          publicKey: fromBase64url(row.publicKey),
          counter: row.counter,
          transports: row.transports ? row.transports.split(",") : [],
        },
        requireUserVerification: false,
      }).catch(() => undefined);
      if (!result?.verified) return false;
      db.update(passkeys)
        .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: now() })
        .where(eq(passkeys.id, row.id))
        .run();
      return true;
    },

    /** Removes one of a profile's passkeys; false when it has no such passkey. */
    remove: (profileId: string, id: string) =>
      db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.profileId, profileId)))
        .returning({ id: passkeys.id })
        .all().length > 0,
  };
}
export type Passkeys = ReturnType<typeof createPasskeys>;
