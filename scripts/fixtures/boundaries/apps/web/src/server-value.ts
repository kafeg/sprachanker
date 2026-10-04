// Violation: apps/web may import server types only.
import { createApp } from "../../../packages/server/src/index.ts";

export const app = createApp();
