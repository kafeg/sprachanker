// server.sqlite (05): the profiles on this server and how devices sign in to them (device tokens), and
// the server's own settings (registration). A profile's learning data is its own file.
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** A learner. Its data lives in profiles/<id>/profile.sqlite; `local` is the first one. */
export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  /** Name or nickname shown on "Who is studying?". Empty until the onboarding names it. */
  name: text("name").notNull(),
  /** Its tile's colour (one of the app's own). */
  colour: text("colour").notNull(),
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

/** The server's own settings (registration open or closed), set by the `sprachanker` command. */
export const serverSettings = sqliteTable("server_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});
