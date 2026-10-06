// Course HTML (instructions, hints, grammar, culture, script). It is sanitised to the allow-list of
// spec 02 at normalisation, so it can be rendered as is. Its pictures and links to course files are
// library paths (`media/…`), resolved through CourseMedia, which the course and lesson screens set.
import { createContext, useContext } from "react";
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
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised at normalisation (02, "Conventions")
      dangerouslySetInnerHTML={{ __html: resolved }}
    />
  );
}
