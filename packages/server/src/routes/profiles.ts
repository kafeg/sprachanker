// /api: profiles and signing in. Without a session: who is studying, a new
// profile or one imported from a file (while registration is open), signing in by choosing a profile,
// signing out. With one (after the session check): the profile's name, colour and onboarding, its
// devices, and its export as a file.
// Every profile is equal; server matters are the `sprachanker` command's.

import { PROFILE_NAME_MAX, ProfileColour } from "@sprachanker/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import { generateCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import { ServiceError } from "../errors.ts";
import { announcedLength, attachment } from "../media.ts";
import { DEVICE_LIFETIME_MS } from "../services/devices.ts";
import type { Services } from "../services/index.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

/** The device's sign-in token (HttpOnly: scripts never see it). */
const DEVICE_COOKIE = "sprachanker_device";
/** The same token where a page can neither take nor send it as a cookie — the phone app, its
 *  server in its page (AppConfig.sessionInHeader) —: in this header both ways. Elsewhere the token is
 *  only ever answered in the cookie, which scripts cannot read; and another site cannot send a
 *  header of its own without CORS. */
export const SESSION_HEADER = "x-sprachanker-session";
/** The Set-Cookie that sets or clears the device's cookie, also in this header in that case: a
 *  Response made in a page drops Set-Cookie, and the phone app's listener hands it on to another
 *  device's browser as its own (apps/mobile src/host.ts). */
export const COOKIE_HEADER = "x-sprachanker-cookie";

/** How the session travels: also in SESSION_HEADER's answers (the phone app). */
export interface SessionOptions {
  inHeader?: boolean;
}

/** The device's session token, if it sent one. */
const tokenOf = (c: Context) => getCookie(c, DEVICE_COOKIE) ?? c.req.header(SESSION_HEADER);

const ProfileId = z.string().regex(/^[a-z0-9]{1,40}$/);
/** A profile's name: never empty. */
const Name = z.string().trim().min(1).max(PROFILE_NAME_MAX);

/** An HTTPS address: the request's own, or one a proxy of ours (the Host check's `proxied`) says. */
const https = (c: Context<ProfileEnv>) =>
  new URL(c.req.url).protocol === "https:" ||
  (c.get("proxied") && c.req.header("x-forwarded-proto") === "https");

/** The device's cookie set (a token) or cleared (""), in COOKIE_HEADER too where the session also
 *  travels in a header. */
function deviceCookie(
  c: Context<ProfileEnv>,
  token: string,
  options: SessionOptions,
  opt: Parameters<typeof generateCookie>[2],
) {
  const cookie = generateCookie(DEVICE_COOKIE, token, opt);
  c.header("Set-Cookie", cookie, { append: true });
  if (options.inHeader) c.header(COOKIE_HEADER, cookie);
}

function signedIn(c: Context<ProfileEnv>, token: string, options: SessionOptions) {
  if (options.inHeader) c.header(SESSION_HEADER, token);
  deviceCookie(c, token, options, {
    httpOnly: true,
    sameSite: "Strict",
    secure: https(c),
    path: "/",
    maxAge: DEVICE_LIFETIME_MS / 1000,
  });
}

/** This device signed out: its cookie cleared. */
const signedOut = (c: Context<ProfileEnv>, options: SessionOptions) =>
  deviceCookie(c, "", options, { path: "/", maxAge: 0 });

/** Signing in and out: no session needed. */
export function sessionRoutes(svc: Services, options: SessionOptions = {}) {
  const { profiles, devices } = svc;
  const issue = async (c: Context<ProfileEnv>, profileId: string) =>
    signedIn(c, await devices.issue(profileId, c.req.header("user-agent") ?? ""), options);
  return (
    new Hono<ProfileEnv>()
      .get("/profiles", (c) =>
        c.json({ profiles: profiles.list(), registration: profiles.registrationOpen() }),
      )
      // A new profile, signed in on this device at once (its onboarding follows).
      .post(
        "/profiles",
        zod("json", z.object({ name: Name, colour: ProfileColour.optional() })),
        async (c) => {
          const profile = profiles.create(c.req.valid("json"));
          await issue(c, profile.id);
          return c.json({ profile });
        },
      )
      // A profile file imported as a new profile (while registration is open, as a new one is made);
      // the device signs in to it by choosing it.
      .post("/profiles/import", async (c) =>
        c.json(
          await svc.profileTransfer.importUpload(
            c.req.raw.body,
            announcedLength(c.req.raw.headers),
          ),
        ),
      )
      .get("/session", async (c) => {
        const device = await devices.resolve(tokenOf(c));
        return c.json({ profile: device ? profiles.get(device.profileId) : null });
      })
      // Choosing a profile signs this device in to it.
      .post("/session", zod("json", z.object({ profile: ProfileId })), async (c) => {
        const { profile: id } = c.req.valid("json");
        profiles.get(id);
        await issue(c, id);
        return c.json({ profile: profiles.get(id) });
      })
      // Signing this device out.
      .delete("/session", async (c) => {
        const device = await devices.resolve(tokenOf(c));
        if (device) devices.revoke(device.profileId, device.deviceId);
        signedOut(c, options);
        return c.json({ ok: true as const });
      })
  );
}

/** The session check: the device's profile and its services for the routes after it; 401 without. */
export function requireSession(svc: Services, options: SessionOptions = {}) {
  return async (c: Context<ProfileEnv>, next: () => Promise<void>) => {
    const token = tokenOf(c);
    const device = await svc.devices.resolve(token);
    if (!device) return c.json({ error: "no_session" }, 401);
    if (device.refreshed && token) signedIn(c, token, options);
    c.set("profileId", device.profileId);
    c.set("deviceId", device.deviceId);
    c.set("s", svc.of(device.profileId));
    await next();
  };
}

/** The signed-in profile itself: name, colour, onboarding, devices. */
export function profileRoutes(svc: Services, options: SessionOptions = {}) {
  const { profiles, devices } = svc;
  return (
    new Hono<ProfileEnv>()
      .put(
        "/profile",
        zod(
          "json",
          z.object({
            name: Name.optional(),
            colour: ProfileColour.optional(),
            onboarded: z.boolean().optional(),
          }),
        ),
        (c) => c.json({ profile: profiles.update(c.var.profileId, c.req.valid("json")) }),
      )
      // The profile deleted with everything it holds; this device is signed out of it.
      .delete("/profile", (c) => {
        svc.removeProfile(c.var.profileId);
        signedOut(c, options);
        return c.json({ ok: true as const });
      })
      // The profile as a file to move to another machine: made ready (its name, size, what it leaves
      // out), then downloaded once, streamed.
      .post("/profile/export", async (c) =>
        c.json(await svc.profileTransfer.prepare(c.var.profileId)),
      )
      // A HEAD (Hono answers it with this GET) asks whether the file is still there — the web, before
      // its download starts, so a gone one is never saved as the file —: nothing is taken.
      .get("/profile/export/:id", zod("param", z.object({ id: z.uuid() })), (c) => {
        const { id } = c.req.valid("param");
        if (c.req.method === "HEAD")
          return c.body(null, 200, attachment(svc.profileTransfer.ready(c.var.profileId, id)));
        const file = svc.profileTransfer.download(c.var.profileId, id);
        return c.body(file.stream, 200, attachment(file));
      })
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
      )
  );
}
