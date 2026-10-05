// scene (an LLM conversation from enrichment) and unknown (source content not mapped yet).
import { z } from "zod";
import { LibraryPath } from "../common.ts";
import { SceneKey } from "../keys.ts";
import { exerciseOf, ItemBase } from "./base.ts";

export const SceneItem = ItemBase.extend({ scene: SceneKey });
export const SceneExercise = exerciseOf("scene", SceneItem);

/** Never rendered; the page shows "not supported yet" and the import report lists it. */
export const UnknownItem = ItemBase.extend({ raw: LibraryPath, reason: z.string().min(1) });
export const UnknownExercise = exerciseOf("unknown", UnknownItem);
