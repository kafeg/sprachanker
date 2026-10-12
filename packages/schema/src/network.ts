// Where the app is reached: the addresses another device opens it at, as
// data — the UI words them in the learner's language.
import { z } from "zod";

/** An address to open the app at. `secure`: the browser gives it a secure context (HTTPS, or
 *  localhost) — the microphone needs one. */
export const ServerAddress = z.object({ url: z.string(), secure: z.boolean() });
export type ServerAddress = z.infer<typeof ServerAddress>;

/** This machine; the local network — each address of the machine, and its `.local` name — only
 *  while the server listens beyond 127.0.0.1 (`--host`); the tailnet when Tailscale runs here: its
 *  name, and `https` once `tailscale serve` serves this server over HTTPS (absent: not served);
 *  `funnel`: Funnel opens the name to the internet, so the server refuses it (no `https`). */
export const ServerAddresses = z.object({
  machine: ServerAddress,
  network: z.array(ServerAddress),
  localName: ServerAddress.optional(),
  tailnet: z
    .object({ name: z.string(), https: ServerAddress.optional(), funnel: z.boolean().optional() })
    .optional(),
});
export type ServerAddresses = z.infer<typeof ServerAddresses>;
