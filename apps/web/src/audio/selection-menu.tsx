// Words selected anywhere in the app (owner, 2026-10-15) — an option, a task, a text, the tutor's
// reply —: a small bar by them that reads them aloud (a word or phrase in the voice for words), in the
// language the page marks them with
// (`lang` of the nearest element: a course's text is its language's), and whatever an optional
// feature adds (`extra`: translated, kept as cards — a line of its own under the actions). Above the
// words with a mouse; under them on a touch screen, where the system's own menu takes the place above;
// kept on the screen whatever it shows. A press on the bar keeps it, even where the press lets the
// words go (a phone); a press elsewhere then takes it away. Nothing for a field being typed in.
import { Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { wordsSaid } from "./speak.ts";
import { useSpeaker } from "./speaker.ts";

/** The most a selection is taken as: a sentence or two, not a page. */
const MAX = 300;
/** The bar's height and the room kept around it. */
const BAR = 44;
const GAP = 8;
/** A press on the bar keeps it while the words it lets go settle. */
const KEPT_MS = 1500;

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

/** An element's size as it is now: what the bar shows changes it. */
function useSize() {
  const [size, setSize] = useState({ width: 0, height: BAR });
  const observer = useRef<ResizeObserver | undefined>(undefined);
  const ref = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!element || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(() =>
      setSize({ width: element.offsetWidth, height: element.offsetHeight || BAR }),
    );
    observer.current.observe(element);
  }, []);
  return [size, ref] as const;
}

export function SelectionMenu({ extra }: { extra?: (picked: Picked) => React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const speaker = useSpeaker();
  const [now, setNow] = useState<Picked | null>(null);
  const [size, measured] = useSize();
  /** When the bar was last pressed. */
  const pressed = useRef(0);
  useEffect(() => {
    // A selection still being dragged changes every moment: the bar comes once it rests.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = picked();
        setNow((was) => next ?? (was && Date.now() - pressed.current < KEPT_MS ? was : null));
      }, 200);
    };
    // Scrolled: the bar follows its words; one kept after a press (its words let go, on a touch
    // screen) stays where it is until a press elsewhere.
    const follow = () =>
      setNow((was) => (was ? (picked() ?? (pressed.current ? was : null)) : was));
    // A press elsewhere: a bar kept goes.
    const away = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-selection-bar]")) {
        pressed.current = Date.now();
        return;
      }
      pressed.current = 0;
      settle();
    };
    document.addEventListener("selectionchange", settle);
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", settle);
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, []);
  if (!now) return null;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const above = now.rect.top - size.height - GAP;
  const top = !touch && above > GAP ? above : now.rect.bottom + GAP;
  const middle = now.rect.left + now.rect.width / 2;
  // Half its width from either edge, at least as far as a bar of two actions.
  const half = Math.min(Math.max(size.width / 2 + GAP, 120), window.innerWidth / 2);
  const more = extra?.(now);
  // With an optional feature's action (Translate: it reads the language learnt aloud too) the bar
  // has that alone; without it, it reads words aloud — not the interface's own words.
  const own = now.lang.split("-")[0] === i18n.language.split("-")[0];
  const canRead = !more && !own && speaker.canRead(now.lang);
  if (!canRead && !more) return null;
  return createPortal(
    <div
      ref={measured}
      role="toolbar"
      aria-label={t("selection.label")}
      data-no-selection-menu
      data-selection-bar
      // Pressing on the bar keeps the words selected.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 flex max-w-[min(24rem,calc(100vw-1rem))] -translate-x-1/2 flex-wrap items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{
        top: Math.max(GAP, Math.min(top, window.innerHeight - size.height - GAP)),
        left: Math.min(Math.max(middle, half), window.innerWidth - half),
      }}
    >
      {canRead && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => speaker.say(`selection:${now.text}`, wordsSaid(now.text, now.lang))}
        >
          <Volume2 /> {t("selection.speak")}
        </Button>
      )}
      {more}
    </div>,
    document.body,
  );
}
