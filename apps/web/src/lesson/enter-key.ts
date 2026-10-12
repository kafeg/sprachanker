// Enter on an exercise's screen: in a text field it goes to the next field and from the last one
// does the main action (Check, then Next); elsewhere it does the main action — unless a control has
// the focus (a button, a link, the audio slider, a list), whose Enter is its own.
import { useEffect } from "react";

export function useEnterKey(area: React.RefObject<HTMLElement | null>, primary: () => void) {
  // Set up again on every render, so Enter always does the latest `primary`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key !== "Enter" || e.isComposing) return;
      if (target.closest("button, a, summary, [role=button], [role=slider]")) return;
      if (target.tagName === "SELECT" || target.closest("[role=listbox], [role=dialog]")) return;
      if (target.matches("input, textarea")) {
        // Fields outside the area keep their own Enter; Shift+Enter keeps a new line in a text area.
        if (!area.current?.contains(target)) return;
        if (e.shiftKey && target.tagName === "TEXTAREA") return;
        const fields = [
          ...area.current.querySelectorAll<HTMLElement>(
            "input:not(:disabled):not([type=checkbox]):not([type=radio]), textarea:not(:disabled)",
          ),
        ];
        const next = fields[fields.indexOf(target) + 1];
        e.preventDefault();
        if (next) return next.focus();
        return primary();
      }
      e.preventDefault();
      primary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
