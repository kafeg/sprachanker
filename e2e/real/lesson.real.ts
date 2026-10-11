// Run-throughs on real courses (10, "Run-throughs"): each chosen lesson walked through by its screens
// in a profile of its own, then the profile's database read to check that what was done is stored as
// it should be. `REAL=dw.nicos-weg/a1-ru bun run e2e:real` (scenarios.ts); `REAL_SHOTS=<dir>` keeps
// each checked exercise as a screenshot there.
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { REAL_DATA } from "./data.ts";
import { readStore } from "./read-store.ts";
import { lessonFiles, scenarios } from "./scenarios.ts";
import { lessonProblems, storeProblems } from "./store.ts";
import { clipped, notebookShows, reviewSome, UI, unanswered, walkLesson } from "./walk.ts";

// Labels cut short, for a look, and exercises not answered: printed once all lessons ran.
test.afterAll(() => {
  if (clipped.length) console.log(`\nlabels cut short:\n${[...new Set(clipped)].join("\n")}`);
  if (unanswered.length) console.log(`\nexercises not answered:\n${unanswered.join("\n")}`);
});

for (const s of scenarios())
  test(`lesson ${s.key} [${s.edition}]`, async ({ page }) => {
    const { lesson, locale } = lessonFiles(s);
    const target = s.edition.split("-")[1] as string;
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(e.message));

    // A profile of its own, in the run's interface language (REAL_UI), its cards by all three faces.
    const made = await page.request.post("/api/profiles", {
      data: { name: s.key.slice(0, 40) },
      headers: { ...CLIENT_HEADERS },
    });
    expect(made.ok()).toBe(true);
    const { profile } = (await made.json()) as { profile: { id: string } };
    for (const [key, value] of [
      ["uiLanguage", UI],
      ["srs.faces", ["recognition", "production", "listening"]],
      // An experimental course is shown once turned on (Settings → General → Experimental).
      ["experimental.on", ["courses", `courses:${s.series}`]],
    ] as const)
      await page.request.put("/api/settings", {
        data: { key, value },
        headers: { ...CLIENT_HEADERS },
      });
    await page.request.put("/api/profile", {
      data: { onboarded: true },
      headers: { ...CLIENT_HEADERS },
    });

    const exercises = lesson.pages.map((p) => p.exercise);
    const unansweredBefore = unanswered.length;
    const { rated } = await walkLesson(
      page,
      `/lesson/${s.series}/${s.course}/${s.lesson}`,
      exercises,
      {
        shots:
          process.env.REAL_SHOTS &&
          join(process.env.REAL_SHOTS, `${test.info().project.name}-${s.key.replaceAll("/", "_")}`),
      },
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
    expect(unanswered.slice(unansweredBefore), "exercises the walk could not answer").toEqual([]);
  });
