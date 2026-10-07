// Deliberate violation: one provider importing another.
import { lingust } from "../../lingust/src/index.ts";

export const other = lingust;
