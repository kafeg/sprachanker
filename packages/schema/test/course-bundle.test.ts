// The paths a course bundle may hold: the library's places only, media of their kind's extensions,
// names every disk takes.
import { expect, test } from "bun:test";
import { CourseBundlePath } from "../src/index.ts";

const ok = (path: string) => CourseBundlePath.safeParse(path).success;

test("a bundle holds the library's files: canonical, locale, media of their kind, a course's source copies", () => {
  for (const path of [
    "canonical/a1/course.json",
    "canonical/a1/lessons/00-01.json",
    "canonical/a1/sources/hoeren.json",
    "locale/ru-de/a1/exams/test.json",
    "media/audio/teil 1.mp3",
    "media/audio/hoeren-1.mp4",
    "media/image/Ä-bild.webp",
    "media/video/x.m4v",
    "media/subtitles/x.vtt",
    "media/pdf/Lektion 1.pdf",
    "raw/de-de/a1/solutions/hoeren_l1.html",
  ])
    expect([path, ok(path)]).toEqual([path, true]);
});

test("never a page that runs scripts as media, a name a disk refuses, a copy outside a course's folder", () => {
  for (const path of [
    "media/audio/x.html",
    "media/image/x.svg",
    "media/pdf/x.xhtml",
    "media/video/x.js",
    "media/audio/noext",
    "media/audio/x.MP3",
    "media/other/x.mp3",
    "media/audio/a:b.mp3",
    "media/audio/con.mp3",
    "media/audio/x .mp3 ",
    `media/audio/${"ä".repeat(126)}.mp3`,
    "raw/x.html",
    "raw/de-de/x.html",
    "raw/de-de/a1/../b1/x.html",
    "raw/de-de/a1/NUL",
    "raw/de-de/a1/page.",
    "canonical/a1/notes.txt",
  ])
    expect([path, ok(path)]).toEqual([path, false]);
});
