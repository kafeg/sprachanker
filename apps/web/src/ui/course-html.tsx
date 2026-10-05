// Course HTML (instructions, hints, grammar, culture, script). It is sanitised to the allow-list of
// spec 02 at normalisation, so it can be rendered as is.
import { cn } from "./utils.ts";

export function CourseHtml({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn("prose-course", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised at normalisation (02, "Conventions")
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
