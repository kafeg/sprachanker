import { expect, test } from "bun:test";
import { MediaBlock } from "../../src/ui/media.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { Episode, peek } from "../../src/ui/video.tsx";
import { renderApp } from "../render.tsx";

const episode = {
  sd: "media/video/e_sd.mp4",
  hd: "media/video/e_hd.mp4",
  subtitles: "media/s.vtt",
};
const url = (p: string) => `/library/x/${p}`;

test("an exercise video that is the lesson's episode plays as the episode: HD, the switch, subtitles", async () => {
  const view = await renderApp(
    <TargetLang value="de">
      <Episode.Provider value={episode}>
        <MediaBlock media={{ video: episode.sd }} url={url} audioLabel="" />
        <MediaBlock media={{ video: "media/video/clip.mp4" }} url={url} audioLabel="" />
      </Episode.Provider>
    </TargetLang>,
  );
  const [first, second] = [...view.container.querySelectorAll("video")];
  expect(first?.getAttribute("src")).toBe("/library/x/media/video/e_hd.mp4");
  expect(first?.querySelector("track")?.getAttribute("src")).toBe("/library/x/media/s.vtt");
  expect(view.getByRole("button", { name: "HD" }).getAttribute("aria-pressed")).toBe("true");
  // Any other clip stays a plain video.
  expect(second?.getAttribute("src")).toBe("/library/x/media/video/clip.mp4");
  expect(second?.querySelector("track")).toBeNull();
});

/** A video as `peek` sees it: where it is, whether it plays, its length, its marks. */
const clip = (duration = 10) =>
  ({ currentTime: 0, paused: true, duration, dataset: {} }) as unknown as HTMLVideoElement;

test("a video shows a frame a moment in until it is played, then plays from its beginning", () => {
  const video = clip();
  peek.loaded(video);
  expect(video.currentTime).toBe(0.5);
  // Where it really is (an HD/SD switch carries it over): its beginning.
  expect(peek.time(video)).toBe(0);
  peek.seeked(video);
  expect(peek.time(video)).toBe(0);
  peek.play(video);
  expect(video.currentTime).toBe(0);
  expect(peek.time(video)).toBe(0);
});

test("played before the frame is reached, a video starts at its beginning; moved by the learner, where it was put", () => {
  const early = clip();
  peek.loaded(early);
  peek.play(early);
  expect(early.currentTime).toBe(0);

  const moved = clip();
  peek.loaded(moved);
  peek.seeked(moved);
  // The learner drags it to 4 s: that seek is theirs.
  moved.currentTime = 4;
  peek.seeked(moved);
  peek.play(moved);
  expect(moved.currentTime).toBe(4);
  expect(peek.time(moved)).toBe(4);

  // A clip too short, or one already playing, is left as it is.
  const short = clip(0.8);
  peek.loaded(short);
  expect(short.currentTime).toBe(0);
});
