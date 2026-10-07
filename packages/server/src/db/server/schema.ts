// server.sqlite (05): the profiles on this server and how devices sign in to them — device tokens and
// passkeys — and the server's own settings (registration). A profile's learning data is its own file.
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** A learner. Its data lives in profiles/<id>/profile.sqlite; `local` is the first one. */
export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  /** Name or nickname shown on "Who is studying?". Empty until the onboarding names it. */
  name: text("name").notNull(),
  /** Its tile's colour (one of the app's own). */
  colour: text("colour").notNull(),
  /** PBKDF2 of the PIN with its salt (base64url), when one is set. */
  pinHash: text("pin_hash"),
  pinSalt: text("pin_salt"),
  /** Wrong PINs in a row, and until when no PIN is taken after too many. */
  failedPins: integer("failed_pins").notNull().default(0),
  lockedUntil: integer("locked_until"),
  /** The onboarding was finished (name, languages, sign-in, assistant). */
  onboarded: integer("onboarded").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/** A browser or app signed in to a profile: its token's hash (the token is only in its cookie). */
export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** What it said it is (user agent), to tell devices apart in the list. */
    userAgent: text("user_agent").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [uniqueIndex("devices_token").on(t.tokenHash)],
);

/** A passkey (WebAuthn credential) of a profile. */
export const passkeys = sqliteTable("passkeys", {
  /** The credential id (base64url). */
  id: text("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  /** The credential's public key (base64url, COSE). */
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull(),
  /** How the authenticator is reached ("internal", "hybrid", …), comma-separated. */
  transports: text("transports").notNull(),
  /** The site it was made for (host name): a passkey made on localhost does not sign in on the tailnet. */
  rpId: text("rp_id").notNull(),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
});

/** The server's own settings (registration open or closed), set by the `sprachanker` command. */
export const serverSettings = sqliteTable("server_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});
