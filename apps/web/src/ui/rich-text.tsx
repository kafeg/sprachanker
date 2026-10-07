// Model output as Markdown (10, "Fixed technical choices"): markdown-it with `html: false`, so raw HTML
// in the output is escaped, never rendered. Images and links are off too: text from a model (or
// injected into what it read) cannot make the browser load or open another site (06, "Security").
import MarkdownIt from "markdown-it";
import { useMemo } from "react";

const md = new MarkdownIt({ html: false, linkify: false, breaks: true }).disable([
  "image",
  "link",
  "autolink",
]);

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
