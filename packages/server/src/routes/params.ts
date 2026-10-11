// What several route files take alike: a run by its id in the path, a batch of its events in the body,
// a deck a profile takes (a course's or an imported one).
import { CourseKey, DeckId, Ulid } from "@sprachanker/schema";
import { z } from "zod";

export const RunParam = z.object({ id: Ulid });

/** Events as the client sends them: each checked by the service that owns the run. */
export const EventsBody = z.object({ events: z.array(z.unknown()).max(200) });

/** A deck as Review lists it: a course's or an imported one. */
export const TakenDeck = z.union([
  z.templateLiteral(["course:", CourseKey]),
  z.templateLiteral(["deck:", DeckId]),
]);
