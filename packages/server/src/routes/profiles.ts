// /api: profiles and signing in (06, "Profiles and access"). Without a session: who is studying, a new
// profile or one imported from a file (while registration is open), signing in by choosing a profile,
// signing out. With one (after the session check): the profile's name, colour and onboarding, its
// devices, and its export as a file.
// Every profile is equal; server matters are the `sprachanker` command's.

import { PROFILE_FILE_MAX_BYTES, PROFILE_NAME_MAX, ProfileColour } from "@sprachanker/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { ServiceError } from "../errors.ts";
import { limitedBody } from "../media.ts";
import { DEVICE_LIFETIME_MS } from "../services/devices.ts";
import type { Services } from "../services/index.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

/** The device's sign-in token (HttpOnly: scripts never see it). */
const DEVICE_COOKIE = "sprachanker_device";

const ProfileId = z.string().regex(/^[a-z0-9]{1,40}$/);
/** A profile's name: never empty. */
const Name = z.string().trim().min(1).max(PROFILE_NAME_MAX);

/** An HTTPS address: the request's own, or one a proxy of ours (the Host check's `proxied`) says. */
const https = (c: Context<ProfileEnv>) =>
  new URL(c.req.url).protocol === "https:" ||
  (c.get("proxied") && c.req.header("x-forwarded-proto") === "https");

function signedIn(c: Context<ProfileEnv>, token: string) {
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
  const { profiles, devices } = svc;
  const issue = async (c: Context<ProfileEnv>, profileId: string) =>
    signedIn(c, await devices.issue(profileId, c.req.header("user-agent") ?? ""));
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
      .post(
        "/profiles/import",
        limitedBody(PROFILE_FILE_MAX_BYTES, "profile_file_too_large"),
        async (c) => {
          const body = c.req.raw.body;
          if (!body) throw new ServiceError("not_a_profile_file", 422);
          const length = Number(c.req.header("content-length"));
          return c.json(
            await svc.profileTransfer.importUpload(
              body,
              Number.isFinite(length) ? length : undefined,
            ),
          );
        },
      )
      .get("/session", async (c) => {
        const device = await devices.resolve(getCookie(c, DEVICE_COOKIE));
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

/** The signed-in profile itself: name, colour, onboarding, devices. */
export function profileRoutes(svc: Services) {
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
        deleteCookie(c, DEVICE_COOKIE, { path: "/" });
        return c.json({ ok: true as const });
      })
      // The profile as a file to move to another machine: made ready (its name, size, what it leaves
      // out), then downloaded once, streamed.
      .post("/profile/export", async (c) =>
        c.json(await svc.profileTransfer.prepare(c.var.profileId)),
      )
      .get("/profile/export/:id", zod("param", z.object({ id: z.uuid() })), (c) => {
        const file = svc.profileTransfer.download(c.var.profileId, c.req.valid("param").id);
        return c.body(file.stream, 200, {
          "content-type": "application/zip",
          "content-length": String(file.bytes),
          "content-disposition": `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
          "cache-control": "no-store",
        });
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
