// Course HTML (instructions, hints, grammar, culture, script). It is sanitised to the allow-list of
// spec 02 at normalisation, so it can be rendered as is. Its pictures and links to course files are
// library paths (`media/…`), resolved through CourseMedia, which the course and lesson screens set.
import { createContext, useContext, useEffect, useRef } from "react";
import { Panel } from "./panel.tsx";
import { htmlSections } from "./sections.ts";
import { cn } from "./utils.ts";

/** Where a `media/…` path of the open course is served. */
export const CourseMedia = createContext<((path: string) => string) | undefined>(undefined);

/** Marks a table that scrolls sideways with more of it past its end (`data-more`: its edge fades). */
export function markScroll(table: HTMLElement) {
  const left = table.scrollWidth - table.clientWidth - Math.abs(table.scrollLeft);
  table.toggleAttribute("data-more", left > 1);
}

/** Keeps the tables in `root` marked while they scroll or change size. */
function useTableScroll(root: React.RefObject<HTMLElement | null>, html: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tables are new with each html
  useEffect(() => {
    const tables = [...(root.current?.querySelectorAll("table") ?? [])];
    if (!tables.length) return;
    const onScroll = (e: Event) => markScroll(e.currentTarget as HTMLElement);
    const sized =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver((entries) => {
            for (const e of entries) markScroll(e.target as HTMLElement);
          });
    for (const t of tables) {
      markScroll(t);
      t.addEventListener("scroll", onScroll, { passive: true });
      sized?.observe(t);
    }
    return () => {
      for (const t of tables) t.removeEventListener("scroll", onScroll);
      sized?.disconnect();
    };
  }, [root, html]);
}

export function CourseHtml({ html, className }: { html: string; className?: string }) {
  const url = useContext(CourseMedia);
  const root = useRef<HTMLDivElement>(null);
  const resolved = url
    ? html.replace(/\b(src|href)="(media\/[^"]+)"/g, (_, attr, path) => `${attr}="${url(path)}"`)
    : html;
  useTableScroll(root, resolved);
  return (
    <div
      ref={root}
      className={cn("prose-course", className)}
      // The learner's language may run right to left (Arabic, Persian editions).
      dir="auto"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised at normalisation (02, "Conventions")
      dangerouslySetInnerHTML={{ __html: resolved }}
    />
  );
}

/** A grammar or culture page as cards, one per section (its `<h3>` titles; 09). */
export function CourseSections({ html, className }: { html: string; className?: string }) {
  return (
    <div className={cn("space-y-4", className)}>
      {htmlSections(html).map((section, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a page's sections never move
        <Panel key={i}>
          {section.titleHtml && (
            <CourseHtml className="mb-3 text-xl font-semibold" html={section.titleHtml} />
          )}
          <CourseHtml html={section.html} />
        </Panel>
      ))}
    </div>
  );
}
