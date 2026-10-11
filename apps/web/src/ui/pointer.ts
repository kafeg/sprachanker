// Whether the screen's main pointer is a finger (a phone, a tablet): some controls take the system's
// own there (a drop-down list as the system's picker).
import { useSyncExternalStore } from "react";

const COARSE = "(pointer: coarse)";
const media = () => (typeof matchMedia === "function" ? matchMedia(COARSE) : undefined);

function subscribe(onChange: () => void) {
  const query = media();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

export const useCoarsePointer = () =>
  useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
