// A course page's sections: its `<h3>` titles divide it (a provider makes them from the source's
// own section titles); what comes before the first title is a section without one. Pure.

interface HtmlSection {
  /** The section's title as course HTML (may hold emphasis); none for the opening part. */
  titleHtml?: string;
  html: string;
}

export function htmlSections(html: string): HtmlSection[] {
  const parts = html.split(/<h3>([\s\S]*?)<\/h3>/);
  const sections: HtmlSection[] = [];
  const opening = parts[0]?.trim();
  if (opening) sections.push({ html: opening });
  for (let i = 1; i < parts.length; i += 2) {
    const titleHtml = parts[i] ?? "";
    const html = (parts[i + 1] ?? "").trim();
    // A title with nothing under it heads the next section: its title becomes a bold line there,
    // not a card of a title alone.
    const last = sections.at(-1);
    if (last?.titleHtml !== undefined && !last.html)
      last.html = `<p><strong>${titleHtml}</strong></p>${html}`;
    else sections.push({ titleHtml, html });
  }
  return sections;
}
