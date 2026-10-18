// The server's UpdateHost on the phone: a newer release's APK (`SprachAnker-<version>-android.apk`)
// downloaded and checked by the native side (Updates.kt: the project's release downloads only, HTTPS,
// its sha256), then handed to Android's installer — which installs it over this app only when it is
// signed with the same key and numbered higher. iOS has none: its app is built again by hand.
import type { UpdateConfig, UpdateHost } from "@sprachanker/server/portable";
import { once } from "./bridge.ts";

interface UpdatesBridge {
  install(id: number, url: string, sha256: string, size: number): void;
}

const APK = /^SprachAnker-\d+\.\d+\.\d+-android\.apk$/;

/** What updates the phone app; on Android its installs, where the native side has them. */
export function phoneUpdate(android: boolean): UpdateConfig {
  const updates = (globalThis as { sprachankerUpdates?: UpdatesBridge }).sprachankerUpdates;
  const host: UpdateHost | undefined = updates && {
    pick: (files) => files.find((f) => APK.test(f.name) && f.sha256),
    async install(file) {
      const failed = await once<string>((id) =>
        updates.install(id, file.url, file.sha256 ?? "", file.size),
      );
      if (failed) throw new Error(failed);
    },
  };
  return { by: "phone", system: android ? "android" : "ios", host: android ? host : undefined };
}
