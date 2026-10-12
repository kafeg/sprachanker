// Anki's reviewer keys: Space or Enter shows the answer and then answers Good, 1–4 rate, R or F5
// replays, U or Ctrl+Z undoes, - and = bury the card or the note, @ and ! suspend them, * marks,
// Ctrl+1…7 flag (⌘ on a Mac). Which key does what is a pure function (tested); the hook listens.
import { useEffect, useRef } from "react";

export type ReviewerAction =
  | { do: "show" }
  | { do: "rate"; rating: 1 | 2 | 3 | 4 }
  | { do: "replay" }
  | { do: "undo" }
  | { do: "bury"; note: boolean }
  | { do: "suspend"; note: boolean }
  | { do: "mark" }
  | { do: "flag"; flag: number };

type Key = { key: string; code: string; ctrl: boolean; alt: boolean };

const PLAIN: Record<string, ReviewerAction> = {
  "1": { do: "rate", rating: 1 },
  "2": { do: "rate", rating: 2 },
  "3": { do: "rate", rating: 3 },
  "4": { do: "rate", rating: 4 },
  r: { do: "replay" },
  F5: { do: "replay" },
  u: { do: "undo" },
  "-": { do: "bury", note: false },
  "=": { do: "bury", note: true },
  "@": { do: "suspend", note: false },
  "!": { do: "suspend", note: true },
  "*": { do: "mark" },
};

/** What a key does on the card's side; undefined: not the reviewer's. */
export function reviewerAction(
  { key, code, ctrl, alt }: Key,
  side: "question" | "answer",
): ReviewerAction | undefined {
  if (ctrl && /^Digit[1-7]$/.test(code)) return { do: "flag", flag: Number(code.slice(5)) };
  if (ctrl && key.toLowerCase() === "z") return { do: "undo" };
  if (ctrl || alt) return undefined;
  if (key === " " || key === "Enter")
    return side === "question" ? { do: "show" } : { do: "rate", rating: 3 };
  return PLAIN[key.length === 1 ? key.toLowerCase() : key] ?? PLAIN[key];
}

/** Listens for the reviewer's keys while `enabled`; text fields, dialogs and menus keep theirs, and
 *  Space or Enter on a focused control (Undo, More, a link) are that control's — except the card. */
export function useReviewerKeys(
  side: "question" | "answer",
  enabled: boolean,
  run: (action: ReviewerAction) => void,
) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [role=dialog], [role=menu]")) return;
      const control = target.closest("button, a, summary, [role=button], [role=slider]");
      if ((e.key === " " || e.key === "Enter") && control && !control.matches("[data-study-card]"))
        return;
      const action = reviewerAction(
        { key: e.key, code: e.code, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey },
        side,
      );
      if (!action) return;
      e.preventDefault();
      latest.current(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [side, enabled]);
}
