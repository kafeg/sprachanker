// unknown: source content not mapped yet.
import { z } from "zod";
import { LibraryPath } from "../common.ts";
import { exerciseOf, ItemBase } from "./base.ts";

/** Never rendered; the page shows "not supported yet" and the import report lists it. */
const UnknownItem = ItemBase.extend({ raw: LibraryPath, reason: z.string().min(1) });
export const UnknownExercise = exerciseOf("unknown", UnknownItem);
