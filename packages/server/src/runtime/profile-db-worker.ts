// A Worker that makes a profile file's database ready (profile-db.ts): its checks and migrations, for
// minutes on a large file, never hold up the server's requests, and one that takes too long is let go
// (profile-transfer.ts). An entry of the compiled binary of its own (apps/cli/scripts/build.ts).
import { settleProfileDb } from "./profile-db.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ file: string }>) => {
  self.postMessage(settleProfileDb(event.data.file));
};
