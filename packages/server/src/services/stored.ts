// A stored JSON value read back with its schema (05): one that is no JSON or no longer fits reads as
// unset, never failing what reads it.
import type { z } from "zod";

/** Stored JSON read back; undefined when it is no JSON at all. */
export function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** The value of `json` when it is JSON that fits `schema`; undefined otherwise (or without one). */
export function readJson<T>(json: string, schema: z.ZodType<T> | undefined): T | undefined {
  const value = parseJson(json);
  if (value === undefined) return undefined;
  const result = schema?.safeParse(value);
  return result?.success ? result.data : undefined;
}
