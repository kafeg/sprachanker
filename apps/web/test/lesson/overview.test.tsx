import { expect, test } from "bun:test";
import type { Lesson } from "@sprachanker/schema";
import { LessonOverview } from "../../src/lesson/overview.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";
import { lesson, locale } from "./lesson.ts";

const video = { sd: "media/video/e_sd.mp4", hd: "media/video/e_hd.mp4" };
const overview = (l: Lesson) =>
  renderApp(
    <TargetLang value="de">
      <LessonOverview lesson={l} locale={locale} goals={{}} url={(p) => p} actions={null} />
    </TargetLang>,
  );

test("the overview shows the episode only when no exercise shows it", async () => {
  const withEpisode = { ...lesson, media: { video } } as Lesson;
  expect((await overview(withEpisode)).container.querySelector("video")).not.toBeNull();
  // DW: the film is the first exercise; the overview leaves it to it.
  const [first, ...rest] = lesson.pages;
  const inExercise = {
    ...withEpisode,
    pages: [{ exercise: { ...first?.exercise, media: { video: video.sd } } }, ...rest],
  } as Lesson;
  expect((await overview(inExercise)).container.querySelector("video")).toBeNull();
});
