// Request validation shared by the route modules.
import { issuesText } from "@sprachanker/schema";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";

/** Validates a request part; invalid input ends in a 400 from onError (keeps response types clean). */
export const zod = <T extends "query" | "json" | "param", S extends z.ZodType>(
  target: T,
  schema: S,
) =>
  validator(target, (value) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new HTTPException(400, { message: issuesText(result.error, 1) });
    }
    return result.data as z.infer<S>;
  });

export const Series = z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/);
export const Edition = z.string().regex(/^[a-z]{2,3}-[a-z]{2,3}$/);
