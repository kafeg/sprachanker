// A text to listen to (08; Understanding, 09): its parts — a dialogue's lines, each speaker's voice —
// read one after another by the profile's engine, paused (it goes on from the line it was at) and
// played again from the start, as often as wanted; the line being read and how often it was heard
// to its end are known; the lines to come are asked for ahead.
import { useEffect, useRef, useState } from "react";
import type { SpokenPart } from "./speak.ts";
import { readingId, useSpeaker } from "./speaker.ts";

export function useListening(parts: SpokenPart[]) {
  const speaker = useSpeaker();
  /** The line read now, or the one it goes on from. */
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Heard to the end, how often. */
  const [plays, setPlays] = useState(0);
  // A play started later (or a pause) makes an earlier one stop where it is.
  const current = useRef(0);
  const { stop } = speaker;
  useEffect(
    () => () => {
      current.current++;
      stop();
    },
    [stop],
  );

  async function from(start: number) {
    const mine = ++current.current;
    setPlaying(true);
    // Every line from here asked for at once, one after another: no pause between lines while the
    // server's voice makes the next.
    speaker.prepare(parts.slice(start));
    for (let i = start; i < parts.length; i++) {
      setAt(i);
      const part = parts[i] as SpokenPart;
      // Each line a reading of its own: the same text twice is still two lines.
      const done = await speaker.say(`${readingId([part])}#${i}`, [part]);
      if (current.current !== mine) return;
      if (!done) {
        setPlaying(false);
        return;
      }
    }
    setAt(0);
    setPlaying(false);
    setPlays((n) => n + 1);
  }

  return {
    at,
    playing,
    plays,
    /** Plays on from the line it was at (from the start once heard to the end). */
    play: () => void from(at),
    pause() {
      current.current++;
      speaker.stop();
      setPlaying(false);
    },
    /** From the start again. */
    replay: () => void from(0),
  };
}
