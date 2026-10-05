// Model output as Markdown (10, "Fixed technical choices"): markdown-it with `html: false`, so raw HTML
// in the output is escaped, never rendered.
import MarkdownIt from "markdown-it";
import { useMemo } from "react";

const md = new MarkdownIt({ html: false, linkify: false, breaks: true });

export function RichText({ text }: { text: string }) {
  const html = useMemo(() => md.render(text), [text]);
  return (
    <div
      className="prose-course"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it with html: false escapes raw HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
