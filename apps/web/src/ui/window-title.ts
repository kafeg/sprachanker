// The window title (09): "SprachAnker · <where you are>", a short place set by the screen ("Lesson 1.1",
// "Ex 4/12"); a running course download shows its progress there instead.
import { useEffect } from "react";

const APP = "SprachAnker";
const parts: { place?: string; busy?: string } = {};

const apply = () => {
  const part = parts.busy ?? parts.place;
  document.title = part ? `${APP} · ${part}` : APP;
};

/** Holds one part of the title while the calling component shows it; undefined leaves it alone. */
function useTitlePart(slot: keyof typeof parts, part: string | undefined) {
  useEffect(() => {
    if (part === undefined) return;
    parts[slot] = part;
    apply();
    return () => {
      // A newer screen may have set its own part already.
      if (parts[slot] === part) {
        parts[slot] = undefined;
        apply();
      }
    };
  }, [slot, part]);
}

/** Where the learner is, in about ten characters ("Settings", "Lesson 1.1", "Ex 4/12"). */
export const useWindowPlace = (part: string | undefined) => useTitlePart("place", part);

/** Background work worth seeing in the taskbar (a course download); shown instead of the place. */
export const useWindowBusy = (part: string | undefined) => useTitlePart("busy", part);
