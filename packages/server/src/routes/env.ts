// What a profile's routes know of the request: the signed-in profile and its services, set by the
// session check in app.ts before any of them runs; whether a proxy of ours brought it, set by the Host
// check (security/host.ts).
import type { ProfileServices } from "../services/index.ts";

export type ProfileEnv = {
  Variables: { s: ProfileServices; profileId: string; deviceId: string; proxied: boolean };
};
