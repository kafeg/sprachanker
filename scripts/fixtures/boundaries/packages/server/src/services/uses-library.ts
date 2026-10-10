// Violation: the app's graph reaches course-kit's file system code; allowed: its view, and a type.
import { exists, type Library } from "../../../course-kit/src/library.ts";
import { NotInstalledError } from "../../../course-kit/src/library-view.ts";

export const used = [exists, NotInstalledError];
export type Used = Library;
