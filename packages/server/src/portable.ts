// What a runtime other than this machine's Bun needs to run the app — the phone app: the app, the
// databases' schemas and migrations, the migrator, and the interfaces its adapters implement. No Bun
// or Node here (like app.ts).
export { type AppConfig, createApp } from "./app.ts";
export { type Migration, migrate } from "./db/migrate.ts";
export type { ProfileDb } from "./db/profile/db.ts";
export { migrations as profileMigrations } from "./db/profile/migrations/index.ts";
export * as profileSchema from "./db/profile/schema.ts";
export type { ServerDb } from "./db/server/db.ts";
export { migrations as serverMigrations } from "./db/server/migrations/index.ts";
export * as serverSchema from "./db/server/schema.ts";
export type { MediaBlob } from "./media.ts";
export type { SpeechHost } from "./services/local-engines.ts";
export type { ProfileFiles, RecordingFiles } from "./services/profiles.ts";
