import { expect, test } from "bun:test";
import { MediaBlock } from "../../src/ui/media.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { Episode } from "../../src/ui/video.tsx";
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
