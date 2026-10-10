// A speaking module page (`sprechen.php`; research exams.md) read as the candidate meets it: its parts
// ("Teil N", "Teil 3 - Prüfungsteilnehmer/-in A", B1 "Aufgabe 2 A – Ein Thema präsentieren"), each
// with its lines (the task, the points to speak about), its cards or slides (a picture and what it
// says: its description's content, a card's theme and word) and the pages holding a card's text (A2's
// calendars) — each of candidate A's or B's where the page says so — and the criteria the page lists
// ("Bewertung:" — B1's maxima per Aufgabe).
import { findAll, parseHtml } from "@sprachanker/course-kit";
import { CHROME, type Picture, pictureOf, textOf } from "./page.ts";

/** Whose a part of the page is: candidate A's (the learner's), B's (the partner's), or both. */
export type Role = "A" | "B" | undefined;

export interface Card {
  /** What the card says: the slide's text, "Essen und Trinken: Frühstück", "Geburtstag?". */
  text: string;
  picture: Picture;
  role: Role;
}

export interface SpeakingPart {
  number: number;
  /** The heading as the page gives it. */
  title: string;
  /** What the heading says besides its number and role ("Gemeinsam etwas planen"). */
  subtitle: string;
  lines: Array<{ text: string; role: Role }>;
  cards: Card[];
  links: Array<{ href: string; role: Role }>;
}

export interface SpeakingModule {
  intro: string[];
  parts: SpeakingPart[];
  /** The criteria the page lists, with the parts they judge ("Aufgabe 1, 2, 3": all three). */
  criteria: Array<{ parts: number[]; title: string; max: number }>;
}

const PART = /^(Teil|Aufgabe)\s*(\d+)\s*(.*)$/;
/** The page's footer and a line of dots on a card's place, not the test. */
const NOT_THE_TEST = /^(Konzept\/Koordination|©|\.{3}$)/;
const ROLE = /Prüfungsteilnehmer\/-in\s+([AB])\b/;
/** "maximal 8 Punkte - Erfüllung". */
const MAXIMUM = /^maximal\s+(\d+(?:,\d+)?)\s+Punkte?\s*[-–]\s*(.+)$/;

/** What a card's picture says, from its description. */
export function cardText(alt: string): string {
  const shown = /Textumgebung:\s*(.+)$/.exec(alt)?.[1];
  if (shown) return shown.trim();
  const content = /Inhaltsbereich:\s*(.+)$/.exec(alt)?.[1]?.trim();
  if (content) {
    const theme = /Thema\s+(.+?)\s+und\s+Inhaltsbereich/.exec(alt)?.[1];
    return theme ? `${theme}: ${content}` : content;
  }
  // "… - Inhalt im folgenden Link": its text is the linked page's.
  return /im folgenden Link/i.test(alt) ? "" : alt.trim();
}

const isLeaf = (tag: string) => tag === "p" || tag === "li" || /^h[4-6]$/.test(tag);

export function readSpeaking(html: string): SpeakingModule {
  const root = parseHtml(html);
  const all = findAll(root, () => true);
  const start = Math.max(
    0,
    all.findIndex((e) => e.attrs.id === "Inhalt"),
  );
  const heads = all.flatMap((e, i) => (e.tag === "h3" && i > start ? [i] : []));
  const leaf = (i: number) => {
    const el = all[i];
    return (
      !!el &&
      isLeaf(el.tag) &&
      !findAll(el, (e) => ["p", "li", "div", "ul", "ol", "table", "form"].includes(e.tag)).length
    );
  };
  const intro = all
    .slice(start, heads[0] ?? all.length)
    .filter((e) => e.tag === "p" && leaf(all.indexOf(e)))
    .map(textOf)
    .filter((t) => t && !CHROME.test(t));
  const parts: SpeakingPart[] = [];
  const criteria: SpeakingModule["criteria"] = [];
  heads.forEach((at, h) => {
    const title = textOf(all[at] as (typeof all)[number]);
    const range = all.slice(at + 1, heads[h + 1] ?? all.length);
    if (/^Bewertung/i.test(title)) {
      // "Aufgabe 1" / "Aufgabe 1, 2, 3", then its criteria with their maxima.
      let judged: number[] = [];
      for (const el of range) {
        if (!leaf(all.indexOf(el))) continue;
        const text = textOf(el);
        const max = MAXIMUM.exec(text);
        if (max)
          criteria.push({
            parts: judged,
            title: (max[2] as string).trim(),
            max: Number((max[1] as string).replace(",", ".")),
          });
        else if (/^Aufgabe\s/.test(text)) judged = (text.match(/\d+/g) ?? []).map(Number);
      }
      return;
    }
    const head = PART.exec(title);
    if (!head) return;
    let role: Role = (ROLE.exec(title)?.[1] ?? /^([AB])\b/.exec(head[3] ?? "")?.[1]) as Role;
    const part: SpeakingPart = {
      number: Number(head[2]),
      title,
      subtitle: (head[3] ?? "")
        .replace(/^[AB]\b/, "")
        .replace(ROLE, "")
        .replace(/^[\s\-–:]+/, "")
        .trim(),
      lines: [],
      cards: [],
      links: [],
    };
    for (const el of range) {
      if (el.tag === "img") {
        const picture = pictureOf(el);
        if (picture?.alt) part.cards.push({ text: cardText(picture.alt), picture, role });
      } else if (el.tag === "a" && /^(?!https?:).*\.html?$/.test(el.attrs.href ?? ""))
        part.links.push({ href: el.attrs.href as string, role });
      else if (leaf(all.indexOf(el))) {
        if (findAll(el, (e) => e.tag === "a").length) continue;
        const text = textOf(el);
        if (!text || CHROME.test(text) || NOT_THE_TEST.test(text) || /^Notizen\b/.test(text))
          continue;
        // "Prüfungsteilnehmer/-in B": what follows is that candidate's.
        const marked = ROLE.exec(text);
        if (marked && text.length < 40) {
          role = marked[1] as Role;
          continue;
        }
        part.lines.push({ text: el.tag === "li" ? `• ${text}` : text, role });
      }
    }
    parts.push(part);
  });
  return { intro, parts, criteria };
}
