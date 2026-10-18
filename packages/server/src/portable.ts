// What a runtime other than this machine's Bun needs to run the app — the phone app: the app, the
// databases' schemas and migrations, the migrator, the storage adapters over its files (the same as
// the desktop's), and the interfaces its own adapters implement. No Bun or Node here (like app.ts).
export type { ApkgRuntime } from "@sprachanker/anki-export";
export { type AppConfig, createApp } from "./app.ts";
export { type Migration, migrate } from "./db/migrate.ts";
export type { ProfileDb } from "./db/profile/db.ts";
export { migrations as profileMigrations } from "./db/profile/migrations/index.ts";
export * as profileSchema from "./db/profile/schema.ts";
export type { ServerDb } from "./db/server/db.ts";
export { migrations as serverMigrations } from "./db/server/migrations/index.ts";
export * as serverSchema from "./db/server/schema.ts";
export type { MediaBlob } from "./media.ts";
export { COOKIE_HEADER, SESSION_HEADER } from "./routes/profiles.ts";
export type { SpeechHost } from "./services/local-engines.ts";
export type { NetworkHost } from "./services/network.ts";
export type { ProfileFiles, RecordingFiles } from "./services/profiles.ts";
export type { PiperHost } from "./services/read-aloud.ts";
export type { SidecarProcess } from "./services/sidecar.ts";
export type { ReleaseFile, UpdateConfig, UpdateHost } from "./services/updates.ts";
export { courseTransferFiles } from "./storage/course-transfer.ts";
export { deckTransferFiles } from "./storage/deck-transfer.ts";
export { deckFiles } from "./storage/decks.ts";
export { heardFiles } from "./storage/heard.ts";
export { courseInstaller } from "./storage/installer.ts";
export { downloadChecked, modelStore, removeParts, voiceStore } from "./storage/model-files.ts";
export { practiceFiles } from "./storage/practice.ts";
export { type Settled, type SqlDb, type SqlFiles, settleProfileDb } from "./storage/profile-db.ts";
export { type ProfileSql, profileTransferFiles } from "./storage/profile-transfer.ts";
export { readingCache } from "./storage/readings.ts";
export type { DataRoot } from "./storage/root.ts";
