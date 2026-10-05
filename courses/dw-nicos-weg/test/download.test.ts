// Synthetic page states shaped like DW's; no real content.
import { expect, test } from "bun:test";
import { exerciseIds, extractState, lessonIds } from "../src/apollo.ts";
import { mediaName, mediaRefs, sdMp4 } from "../src/media.ts";

const state = {
  "Course:1": {
    __typename: "Course",
    'contentLinks({"targetTypes":"LESSON"})': [
      { __ref: "ContentLink:20" },
      { __ref: "ContentLink:10" },
    ],
  },
  "ContentLink:20": { id: 20, groupName: "Unit A" },
  "ContentLink:10": { id: 10, groupName: "Unit A" },
  "Lesson:20": {
    overviewParts: [
      { lessonPart: "EXERCISE", targetId: 201 },
      { lessonPart: "GRAMMAR", targetId: 299 },
      { lessonPart: "EXERCISE", targetId: 202 },
    ],
  },
  "Knowledge:5": {
    text: '<img data-url="https://static.dw.com/image/555_${formatId}.jpg">',
    audios: [{ mp3Src: "https://audio.test/word.mp3" }],
  },
  "Video:7": {
    hlsVideoSrc: "https://hlsvod.dw.com/i/Events/mp4/course/E1_,sd,hd,.mp4.csmil/master.m3u8",
    subtitles: [{ subtitleUrl: "https://www.dw.com/media/subtitles/77" }],
  },
  "Video:8": {
    hlsVideoSrc:
      "https://hlsvod.dw.com/i/flv/course/E1_ut_,AVC_480x270,AVC_640x360,.mp4.csmil/master.m3u8",
  },
  "ContentLink:30": {
    targetId: 30,
    targetType: "DOWNLOAD",
    target: { __typename: "Download", filename: "Course-Script.pdf" },
  },
};

test("extracts the embedded state and ignores what follows", () => {
  const html = `<script>window.__APOLLO_STATE__ = {"a":{"b":"}{\\" x"}};var y={};</script>`;
  expect(extractState(html)).toEqual({ a: { b: '}{" x' } } as never);
});

test("lessons in course order, exercises in lesson order", () => {
  expect(lessonIds(state as never)).toEqual([20, 10]);
  expect(exerciseIds(state as never, 20)).toEqual([201, 202]);
});

test("direct SD MP4 only for plain sd/hd videos", () => {
  expect(sdMp4(state["Video:7"].hlsVideoSrc)).toBe(
    "https://tvdownloaddw-a.akamaihd.net/downloads/Events/mp4/course/E1_sd.mp4",
  );
  expect(sdMp4(state["Video:8"].hlsVideoSrc)).toBeUndefined();
});

test("media of a page", () => {
  expect(mediaRefs(state as never)).toEqual([
    { url: "https://audio.test/word.mp3", kind: "audio" },
    { url: "https://static.dw.com/image/555_6.jpg", kind: "image" },
    {
      url: "https://tvdownloaddw-a.akamaihd.net/downloads/Events/mp4/course/E1_sd.mp4",
      kind: "video",
    },
    { url: "https://www.dw.com/media/subtitles/77", kind: "subtitles" },
    { url: "https://static.dw.com/downloads/30/course-script.pdf", kind: "pdf" },
  ]);
});

test("readable file names", () => {
  expect(mediaRefs(state as never).map(mediaName)).toEqual([
    "word.mp3",
    "555.jpg",
    "E1_sd.mp4",
    "77.vtt",
    "course-script.pdf",
  ]);
});
