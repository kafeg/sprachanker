// What a profile's routes know of the request: the signed-in profile and its services, set by the
// session check in app.ts before any of them runs.
import type { ProfileServices } from "../services/index.ts";

export type ProfileEnv = {
  Variables: { s: ProfileServices; profileId: string; deviceId: string };
};
