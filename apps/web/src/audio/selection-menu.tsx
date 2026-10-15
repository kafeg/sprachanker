// Words selected anywhere in the app (owner, 2026-10-15) — an option, a task, a text, the tutor's
// reply —: a small bar by them that reads them aloud, in the language the page marks them with
// (`lang` of the nearest element: a course's text is its language's), and whatever an optional
// feature adds (`extra`: translated, kept as cards). Above the words with a mouse; under them on a
// touch screen, where the system's own menu takes the place above. Nothing for a field being typed in.
import { Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { said } from "./speak.ts";
import { useSpeaker } from "./speaker.ts";

/** The most a selection is taken as: a sentence or two, not a page. */
const MAX = 300;
/** The bar's height and the room kept around it. */
const BAR = 44;
const GAP = 8;

/** What was selected: its words, their language, where they are on the screen. */
export interface Picked {
  text: string;
  lang: string;
  /** The sentence around the words, where it is there (what a translation reads them in). */
  context: string;
  rect: { top: number; bottom: number; left: number; width: number };
}

function picked(): Picked | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const text = selection.toString().replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  if (
    !element ||
    element.closest("input, textarea, [contenteditable=true], [data-no-selection-menu]")
  )
    return null;
  const lang =
    element.closest("[lang]")?.getAttribute("lang") ?? document.documentElement.lang ?? "";
  const block = element.closest("p, li, [role=button], td, h1, h2, h3, figcaption") ?? element;
  const context = (block.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const { top, bottom, left, width } = range.getBoundingClientRect();
  return { text, lang, context, rect: { top, bottom, left, width } };
}

export function SelectionMenu({ extra }: { extra?: (picked: Picked) => React.ReactNode }) {
  const { t } = useTranslation();
  const speaker = useSpeaker();
  const [now, setNow] = useState<Picked | null>(null);
  useEffect(() => {
    // A selection still being dragged changes every moment: the bar comes once it rests.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setNow(picked()), 200);
    };
    // Scrolled: the bar follows its words.
    const follow = () => setNow((was) => (was ? picked() : was));
    document.addEventListener("selectionchange", settle);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", settle);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, []);
  if (!now) return null;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const above = now.rect.top - BAR - GAP;
  const top = !touch && above > GAP ? above : now.rect.bottom + GAP;
  const middle = now.rect.left + now.rect.width / 2;
  const canRead = speaker.canRead(now.lang);
  const more = extra?.(now);
  if (!canRead && !more) return null;
  return createPortal(
    <div
      role="toolbar"
      aria-label={t("selection.label")}
      data-no-selection-menu
      // Pressing on the bar keeps the words selected.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{
        top: Math.min(top, window.innerHeight - BAR - GAP),
        left: Math.min(Math.max(middle, 120), window.innerWidth - 120),
      }}
    >
      {canRead && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => speaker.say(`selection:${now.text}`, said(now.text, now.lang))}
        >
          <Volume2 /> {t("selection.speak")}
        </Button>
      )}
      {more}
    </div>,
    document.body,
  );
}
