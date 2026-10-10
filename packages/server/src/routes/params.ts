// What several route files take alike: a run by its id in the path, a batch of its events in the body.
import { Ulid } from "@sprachanker/schema";
import { z } from "zod";

export const RunParam = z.object({ id: Ulid });

/** Events as the client sends them: each checked by the service that owns the run. */
export const EventsBody = z.object({ events: z.array(z.unknown()).max(200) });
