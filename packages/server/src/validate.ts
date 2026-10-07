// Request validation shared by the route modules.
import { issuesText } from "@sprachanker/schema";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import type { z } from "zod";

type Target = "query" | "json" | "param";

/**
 * Validates a request part; invalid input ends in a 400 from onError (keeps response types clean).
 * The client sends the schema's input type and the handler gets its output (branded keys included).
 */
export const zod = <T extends Target, S extends z.ZodType>(target: T, schema: S) =>
  validator(target, (value) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new HTTPException(400, { message: issuesText(result.error, 1) });
    }
    return result.data as z.output<S>;
  }) as MiddlewareHandler<
    // biome-ignore lint/suspicious/noExplicitAny: the route's own Env applies
    any,
    string,
    { in: { [K in T]: Input<K, z.input<S>> }; out: { [K in T]: z.output<S> } }
  >;

/** Query and path values arrive as strings. */
type Input<K extends Target, I> = K extends "json" ? I : { [P in keyof I]: string };
