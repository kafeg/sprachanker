// A course page's sections (09): its `<h3>` titles divide it (a provider makes them from the source's
// own section titles, 02); what comes before the first title is a section without one. Pure.

export interface HtmlSection {
  /** The section's title as course HTML (may hold emphasis); none for the opening part. */
  titleHtml?: string;
  html: string;
}

export function htmlSections(html: string): HtmlSection[] {
  const parts = html.split(/<h3>([\s\S]*?)<\/h3>/);
  const sections: HtmlSection[] = [];
  const opening = parts[0]?.trim();
  if (opening) sections.push({ html: opening });
  for (let i = 1; i < parts.length; i += 2)
    sections.push({ titleHtml: parts[i] ?? "", html: (parts[i + 1] ?? "").trim() });
  return sections;
}
