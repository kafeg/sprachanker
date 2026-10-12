// Model output as Markdown: markdown-it with `html: false`, so raw HTML
// in the output is escaped, never rendered. Images and links are off too: text from a model (or
// injected into what it read) cannot make the browser load or open another site.
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
      // A reply in a right-to-left language runs that way.
      dir="auto"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it with html: false escapes raw HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
