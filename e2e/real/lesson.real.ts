// Run-throughs on real courses (10, "Run-throughs"): each chosen lesson walked through by its screens
// in a profile of its own, then the profile's database read to check that what was done is stored as
// it should be. `REAL=dw.nicos-weg/a1-ru bun run e2e:real` (scenarios.ts).
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { REAL_DATA } from "./data.ts";
import { readStore } from "./read-store.ts";
import { lessonFiles, scenarios } from "./scenarios.ts";
import { lessonProblems, storeProblems } from "./store.ts";
import { clipped, notebookShows, reviewSome, walkLesson } from "./walk.ts";

// Labels cut short, for a look: printed once all lessons ran.
test.afterAll(() => {
  if (clipped.length) console.log(`\nlabels cut short:\n${[...new Set(clipped)].join("\n")}`);
});

for (const s of scenarios())
  test(`lesson ${s.key} [${s.edition}]`, async ({ page }) => {
    const { lesson, locale } = lessonFiles(s);
    const [native, target] = s.edition.split("-") as [string, string];
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(e.message));

    // A profile of its own, studying the lesson's pair in English.
    const made = await page.request.post("/api/profiles", {
      data: { name: s.key.slice(0, 40) },
      headers: { ...CLIENT_HEADERS },
    });
    expect(made.ok()).toBe(true);
    const { profile } = (await made.json()) as { profile: { id: string } };
    for (const [key, value] of [
      ["uiLanguage", "en"],
      ["learner.native", native],
      ["learner.target", target],
    ])
      await page.request.put("/api/settings", {
        data: { key, value },
        headers: { ...CLIENT_HEADERS },
      });
    await page.request.put("/api/profile", {
      data: { onboarded: true },
      headers: { ...CLIENT_HEADERS },
    });

    const exercises = lesson.pages.map((p) => p.exercise);
    const { rated } = await walkLesson(
      page,
      `/lesson/${s.series}/${s.course}/${s.lesson}`,
      exercises,
    );
    // Then a few of the lesson's cards in Review (learning steps fall due within Anki's learn-ahead).
    const reviewed = rated ? await reviewSome(page, 5) : 0;
    await notebookShows(page, s.key);
    // What is still queued is sent before the store is read.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    const stored = readStore(join(REAL_DATA, "profiles", profile.id, "profile.sqlite"));
    const problems = lessonProblems(stored, lesson, locale, target, {
      rated,
      reviewed,
      finished: true,
    });
    expect(problems, `stored for ${s.key}`).toEqual([]);
    expect(storeProblems(stored), "the store as a whole").toEqual([]);
    expect(consoleErrors, "errors in the page").toEqual([]);
  });
