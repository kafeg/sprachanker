import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { JSON_SCHEMA_DIR, jsonSchemas } from "../scripts/gen-json-schema.ts";

test("committed JSON Schemas match the zod schemas (run `bun run --filter @sprachanker/schema gen`)", async () => {
  const generated = jsonSchemas();
  expect(readdirSync(JSON_SCHEMA_DIR).sort()).toEqual(Object.keys(generated).sort());
  for (const [file, text] of Object.entries(generated)) {
    expect(await Bun.file(join(JSON_SCHEMA_DIR, file)).text(), file).toBe(text);
  }
});
