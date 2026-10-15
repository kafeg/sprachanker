// A Worker that makes a profile file's database ready (storage/profile-db.ts over Bun's SQLite): its
// checks and migrations, for minutes on a large file, never hold up the server's requests, and one
// that takes too long is let go (profile-sql.ts). An entry of the compiled binary of its own
// (apps/cli/scripts/build.ts).
import { settleProfileDb } from "../storage/profile-db.ts";
import { bunSqlFiles } from "./profile-sql.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ file: string; endpoints: string[] }>) => {
  self.postMessage(settleProfileDb(bunSqlFiles, event.data.file, event.data.endpoints));
};
