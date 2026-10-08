// Course HTML (instructions, hints, grammar, culture, script). It is sanitised to the allow-list of
// spec 02 at normalisation, so it can be rendered as is. Its pictures and links to course files are
// library paths (`media/…`), resolved through CourseMedia, which the course and lesson screens set.
import { createContext, useContext } from "react";
import { htmlSections } from "./sections.ts";
import { cn } from "./utils.ts";

/** Where a `media/…` path of the open course is served. */
export const CourseMedia = createContext<((path: string) => string) | undefined>(undefined);

export function CourseHtml({ html, className }: { html: string; className?: string }) {
  const url = useContext(CourseMedia);
  const resolved = url
    ? html.replace(/\b(src|href)="(media\/[^"]+)"/g, (_, attr, path) => `${attr}="${url(path)}"`)
    : html;
  return (
    <div
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
        <section
          // biome-ignore lint/suspicious/noArrayIndexKey: a page's sections never move
          key={i}
          className="rounded-2xl border bg-card p-4 sm:p-5"
        >
          {section.titleHtml && (
            <CourseHtml className="mb-3 text-xl font-semibold" html={section.titleHtml} />
          )}
          <CourseHtml html={section.html} />
        </section>
      ))}
    </div>
  );
}
