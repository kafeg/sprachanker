import { expect, test } from "bun:test";
import { SRS_DEFAULTS } from "@sprachanker/engine";
import { SETTING_DEFAULTS } from "@sprachanker/schema";

test("Anki's deck options unset read the same in the settings and in the engine", () => {
  expect({
    newPerDay: SETTING_DEFAULTS["srs.newPerDay"],
    reviewsPerDay: SETTING_DEFAULTS["srs.reviewsPerDay"],
    retention: SETTING_DEFAULTS["srs.retention"],
    learningSteps: SETTING_DEFAULTS["srs.learningSteps"],
    relearningSteps: SETTING_DEFAULTS["srs.relearningSteps"],
    dayStartHour: SETTING_DEFAULTS["srs.dayStartHour"],
  }).toMatchObject({
    newPerDay: SRS_DEFAULTS.newPerDay,
    reviewsPerDay: SRS_DEFAULTS.reviewsPerDay,
    retention: SRS_DEFAULTS.retention,
    learningSteps: SRS_DEFAULTS.learningSteps,
    relearningSteps: SRS_DEFAULTS.relearningSteps,
    dayStartHour: SRS_DEFAULTS.dayStartHour,
  });
});
