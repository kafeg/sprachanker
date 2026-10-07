// /api: profiles and signing in (06, "Profiles and access"). Without a session: who is studying, a new
// profile (while registration is open), signing in by choosing a profile, its PIN or a passkey, signing
// out. With one (after the session check): the profile's name, colour and onboarding, its PIN, passkeys
// and devices. Every profile is equal; server matters are the `sprachanker` command's.
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { ServiceError } from "../errors.ts";
import { DEVICE_LIFETIME_MS } from "../services/devices.ts";
import type { Services } from "../services/index.ts";
import type { Site } from "../services/passkeys.ts";
import { COLOURS } from "../services/profiles.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

/** The device's sign-in token (HttpOnly: scripts never see it). */
export const DEVICE_COOKIE = "sprachanker_device";

const ProfileId = z.string().regex(/^[a-z0-9]{1,40}$/);
const Pin = z.string().regex(/^\d{4,8}$/);
/** A browser's WebAuthn answer: checked by the passkey library, so only its shape here. */
const WebAuthnJson = z.looseObject({ id: z.string().min(1).max(2000), type: z.string() });

const https = (c: Context) =>
  new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";

/** The site the browser is on: its own origin (sent with every POST), as passkeys are made for it. */
function site(c: Context): Site {
  const origin = c.req.header("origin") ?? new URL(c.req.url).origin;
  return { origin, rpId: new URL(origin).hostname };
}

function signedIn(c: Context, token: string) {
  setCookie(c, DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: https(c),
    path: "/",
    maxAge: DEVICE_LIFETIME_MS / 1000,
  });
}

/** Signing in and out: no session needed. */
export function sessionRoutes(svc: Services) {
  const { profiles, devices, passkeys } = svc;
  const issue = async (c: Context, profileId: string) =>
    signedIn(c, await devices.issue(profileId, c.req.header("user-agent") ?? ""));
  return (
    new Hono<ProfileEnv>()
      .get("/profiles", (c) =>
        c.json({ profiles: profiles.list(), registration: profiles.registrationOpen() }),
      )
      // A new profile, signed in on this device at once (its onboarding follows).
      .post(
        "/profiles",
        zod(
          "json",
          z.object({ name: z.string().max(40).optional(), colour: z.enum(COLOURS).optional() }),
        ),
        async (c) => {
          const profile = profiles.create(c.req.valid("json"));
          await issue(c, profile.id);
          return c.json({ profile });
        },
      )
      .get("/session", async (c) => {
        const device = await devices.resolve(getCookie(c, DEVICE_COOKIE));
        return c.json({ profile: device ? profiles.get(device.profileId) : null });
      })
      // Choosing a profile: one without a PIN or passkey opens; one with a PIN wants it (a passkey
      // signs in through /session/passkey).
      .post(
        "/session",
        zod("json", z.object({ profile: ProfileId, pin: Pin.optional() })),
        async (c) => {
          const { profile: id, pin } = c.req.valid("json");
          const profile = profiles.get(id);
          if (profile.hasPin || profile.hasPasskey) {
            if (!pin) throw new ServiceError("pin_required", 401);
            if (!(await profiles.checkPin(id, pin))) throw new ServiceError("wrong_pin", 401);
          }
          await issue(c, id);
          return c.json({ profile: profiles.get(id) });
        },
      )
      .post("/session/passkey/options", zod("json", z.object({ profile: ProfileId })), async (c) =>
        c.json(await passkeys.signInOptions(c.req.valid("json").profile, site(c))),
      )
      .post(
        "/session/passkey",
        zod("json", z.object({ profile: ProfileId, response: WebAuthnJson })),
        async (c) => {
          const { profile: id, response } = c.req.valid("json");
          profiles.get(id);
          const ok = await passkeys.signIn(
            id,
            response as unknown as AuthenticationResponseJSON,
            site(c),
          );
          if (!ok) throw new ServiceError("passkey_failed", 401);
          await issue(c, id);
          return c.json({ profile: profiles.get(id) });
        },
      )
      // Signing this device out.
      .delete("/session", async (c) => {
        const device = await devices.resolve(getCookie(c, DEVICE_COOKIE));
        if (device) devices.revoke(device.profileId, device.deviceId);
        deleteCookie(c, DEVICE_COOKIE, { path: "/" });
        return c.json({ ok: true as const });
      })
  );
}

/** The session check: the device's profile and its services for the routes after it; 401 without. */
export function requireSession(svc: Services) {
  return async (c: Context<ProfileEnv>, next: () => Promise<void>) => {
    const token = getCookie(c, DEVICE_COOKIE);
    const device = await svc.devices.resolve(token);
    if (!device) return c.json({ error: "no_session" }, 401);
    if (device.refreshed && token) signedIn(c, token);
    c.set("profileId", device.profileId);
    c.set("deviceId", device.deviceId);
    c.set("s", svc.of(device.profileId));
    await next();
  };
}

/** The signed-in profile itself: name, colour, onboarding, PIN, passkeys, devices. */
export function profileRoutes(svc: Services) {
  const { profiles, devices, passkeys } = svc;
  return new Hono<ProfileEnv>()
    .put(
      "/profile",
      zod(
        "json",
        z.object({
          name: z.string().max(40).optional(),
          colour: z.enum(COLOURS).optional(),
          onboarded: z.boolean().optional(),
        }),
      ),
      (c) => c.json({ profile: profiles.update(c.var.profileId, c.req.valid("json")) }),
    )
    .put("/profile/pin", zod("json", z.object({ pin: Pin.nullable() })), async (c) => {
      await profiles.setPin(c.var.profileId, c.req.valid("json").pin);
      return c.json({ profile: profiles.get(c.var.profileId) });
    })
    .get("/profile/passkeys", (c) => c.json({ passkeys: passkeys.list(c.var.profileId) }))
    .post("/profile/passkeys/options", async (c) =>
      c.json(await passkeys.registrationOptions(profiles.get(c.var.profileId), site(c))),
    )
    .post("/profile/passkeys", zod("json", z.object({ response: WebAuthnJson })), async (c) => {
      await passkeys.register(
        c.var.profileId,
        c.req.valid("json").response as unknown as RegistrationResponseJSON,
        site(c),
      );
      return c.json({ passkeys: passkeys.list(c.var.profileId) });
    })
    .delete(
      "/profile/passkeys/:id",
      zod("param", z.object({ id: z.string().min(1).max(2000) })),
      (c) => {
        if (!passkeys.remove(c.var.profileId, c.req.valid("param").id))
          throw new ServiceError("no_passkey", 404);
        return c.json({ passkeys: passkeys.list(c.var.profileId) });
      },
    )
    .get("/profile/devices", (c) =>
      c.json({
        devices: devices
          .list(c.var.profileId)
          .map((d) => ({ ...d, current: d.id === c.var.deviceId })),
      }),
    )
    .delete(
      "/profile/devices/:id",
      zod("param", z.object({ id: z.string().min(1).max(40) })),
      (c) => {
        if (!devices.revoke(c.var.profileId, c.req.valid("param").id))
          throw new ServiceError("no_device", 404);
        return c.json({ ok: true as const });
      },
    );
}
