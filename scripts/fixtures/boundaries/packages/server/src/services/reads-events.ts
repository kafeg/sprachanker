// A service reading the events table itself instead of through the run store.
import { events } from "../db/profile/schema.ts";

export const table = events;
