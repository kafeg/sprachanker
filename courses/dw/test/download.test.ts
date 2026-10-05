// Synthetic page states shaped like DW's; no real content.
import { expect, test } from "bun:test";
import { exerciseIds, extractState, lessonIds } from "../src/apollo.ts";
import { mediaName, mediaRefs, videoFiles } from "../src/media.ts";
import { variantUrl } from "../src/stream.ts";

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
    // biome-ignore lint/suspicious/noTemplateCurlyInString: DW's literal URL template placeholder.
    text: '<img data-url="https://static.dw.com/image/555_${formatId}.jpg">',
    audios: [{ mp3Src: "https://audio.test/word.mp3" }],
  },
  "Video:7": {
    hlsVideoSrc: "https://hlsvod.dw.com/i/Events/mp4/course/E1_,sd,hd,.mp4.csmil/master.m3u8",
    subtitles: [{ subtitleUrl: "https://www.dw.com/media/subtitles/77" }],
  },
  "Video:8": {
    name: "Episode 1 (mit Untertiteln)",
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

test("SD and HD MP4 per video; none for burned-in subtitles", () => {
  const D = "https://tvdownloaddw-a.akamaihd.net/downloads/";
  expect(videoFiles(state["Video:7"])).toEqual({
    sd: `${D}Events/mp4/course/E1_sd.mp4`,
    hd: `${D}Events/mp4/course/E1_hd.mp4`,
  });
  expect(videoFiles(state["Video:8"])).toEqual({});
  expect(
    videoFiles({
      hlsVideoSrc:
        "https://hlsvod.dw.com/i/flv/course/E2_neu_,AVC_480x270,AVC_640x360,AVC_1280x720,.mp4.csmil/master.m3u8",
    }),
  ).toEqual({
    sd: `${D}flv/course/E2_neu_AVC_640x360.mp4`,
    hd: `${D}flv/course/E2_neu_AVC_1280x720.mp4`,
  });
  expect(
    videoFiles({
      videoResourceLinks: [
        { url: "flv/course/E2_hd.mp4", techFormat: "PODCAST_HD" },
        { url: "flv/course/E2_sd.mp4", techFormat: "PODCAST_SD" },
      ],
    }),
  ).toEqual({ sd: `${D}flv/course/E2_sd.mp4`, hd: `${D}flv/course/E2_hd.mp4` });
});

test("media of a page", () => {
  expect(mediaRefs(state as never)).toEqual([
    { url: "https://audio.test/word.mp3", kind: "audio" },
    { url: "https://static.dw.com/image/555_6.jpg", kind: "image" },
    {
      url: "https://tvdownloaddw-a.akamaihd.net/downloads/Events/mp4/course/E1_sd.mp4",
      kind: "video",
      stream: { master: state["Video:7"].hlsVideoSrc, resolution: "640x360" },
    },
    {
      url: "https://tvdownloaddw-a.akamaihd.net/downloads/Events/mp4/course/E1_hd.mp4",
      kind: "video",
      stream: { master: state["Video:7"].hlsVideoSrc, resolution: "1280x720" },
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
    "E1_hd.mp4",
    "77.vtt",
    "course-script.pdf",
  ]);
});

test("picks the variant playlist by resolution", () => {
  const master = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=775920,RESOLUTION=640x360",
    "https://cdn.test/v/index-f1.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=2226992,RESOLUTION=1280x720",
    "https://cdn.test/v/index-f2.m3u8",
  ].join("\n");
  expect(variantUrl(master, "1280x720")).toBe("https://cdn.test/v/index-f2.m3u8");
  expect(variantUrl(master, "1920x1080")).toBeUndefined();
});
