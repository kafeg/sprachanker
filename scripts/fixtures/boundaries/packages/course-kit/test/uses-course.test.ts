// Violation: course-kit's tests build their own library; they never import a course.
import { lingust } from "../../../courses/lingust/src/index.ts";

export const used = lingust;
