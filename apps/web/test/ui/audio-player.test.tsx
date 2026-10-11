import { expect, test } from "bun:test";
import { AudioPlayer } from "../../src/ui/media.tsx";
import { renderApp } from "../render.tsx";

test("a full player without a caption is one row; with one, its controls beside the caption", async () => {
  const bare = await renderApp(<AudioPlayer src="/a.mp3" label="Exercise 1" />);
  const group = bare.getByRole("group", { name: "Exercise 1" });
  // Play, the timeline, then back and speed: all children of the one row.
  const back = bare.getByRole("button", { name: "Back 5 seconds" });
  expect(back.parentElement?.parentElement).toBe(group);
  expect(bare.getByRole("slider").closest("[role=group] > div")?.parentElement).toBe(group);
  bare.unmount();

  const titled = await renderApp(<AudioPlayer src="/a.mp3" label="Lesson" title="Lesson audio" />);
  const caption = titled.getByText("Lesson audio");
  expect(titled.getByRole("button", { name: "Back 5 seconds" }).parentElement).toBe(
    caption.parentElement,
  );
});
