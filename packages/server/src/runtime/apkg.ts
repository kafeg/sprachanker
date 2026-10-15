// What reading an .apkg needs of Bun: SQLite from bytes, zstd (the phone app gives sql.js and a
// zstd decoder of its own).
import { Database } from "bun:sqlite";
import { zstdDecompressSync } from "node:zlib";
import type { ApkgRuntime } from "@sprachanker/anki-export";

export const apkgRuntime: ApkgRuntime = {
  openSqlite(bytes) {
    const db = Database.deserialize(bytes, { readonly: true });
    return {
      all: (sql) => db.query(sql).all() as Array<Record<string, unknown>>,
      close: () => db.close(),
    };
  },
  zstd(bytes, max) {
    try {
      return new Uint8Array(zstdDecompressSync(bytes, { maxOutputLength: max }));
    } catch (error) {
      // Stopped once past `max` bytes, not after.
      if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return undefined;
      throw error;
    }
  },
};
