// Explanation sections → locale page HTML: players and paid-audio notices removed, images dropped,
// sub-headings as section titles (`<h3>`), tooltips shown (short ones — transcriptions — in place,
// translations after their paragraph), two-column rows (English | Russian) as table rows.
import { type El, hasClass, isEl, type Node, sanitizeCourseHtml } from "@sprachanker/course-kit";

const DROP = ["cplayer", "cplayer-lock", "audio-notice", "adw", "key"];
const SKIP_TAGS = ["audio", "img", "input", "textarea", "select", "iframe", "caption"];
/** Tooltips up to this length stay next to their word. */
const INLINE_TIP = 40;

interface Out {
  /** Long tooltips waiting for the end of their top-level block. */
  pending: string[];
}

function node(n: Node, out: Out): string {
  if (!isEl(n)) return n.text;
  if (DROP.some((c) => hasClass(n, c)) || SKIP_TAGS.includes(n.tag)) return "";
  if (n.tag === "br") return "<br>";
  // Links to other sites (video mirrors, social networks) mean nothing without the link.
  if (n.tag === "a" && /^https?:/.test(n.attrs.href ?? "") && !n.attrs.href?.includes("lingust.ru"))
    return "";
  const inner = elements(n.children, out);
  const tip = n.attrs["data-tooltips-content"]?.replace(/&quot;/g, '"');
  if (tip !== undefined) {
    if (tip.length <= INLINE_TIP) return `${inner} <small>${tip}</small>`;
    out.pending.push(tip);
    return inner;
  }
  // The source's sub-headings title the parts of a section (02: `<h3>`, a card each).
  if (/^h[3-6]$/.test(n.tag)) return `<h3>${inner}</h3>`;
  if (/\bcol-/.test(n.attrs.class ?? "")) return `<p>${inner}</p>`;
  return `<${n.tag}>${inner}</${n.tag}>`;
}

const cols = (n: El) => n.children.filter(isEl);
const isPairRow = (n: Node | undefined): n is El =>
  hasClass(n, "row") &&
  cols(n as El).length === 2 &&
  cols(n as El).every((c) => /\bcol-/.test(c.attrs.class ?? ""));

/** Consecutive two-column rows become one table; everything else is rendered as it is. */
function elements(nodes: Node[], out: Out, top = false): string {
  let html = "";
  let rows: string[] = [];
  const flush = () => {
    if (rows.length) html += `<table><tbody>${rows.join("")}</tbody></table>`;
    rows = [];
  };
  const tips = () => {
    if (top && out.pending.length) {
      html += out.pending.map((t) => `<p><small>${t}</small></p>`).join("");
      out.pending = [];
    }
  };
  for (const n of nodes) {
    if (isPairRow(n)) {
      const cells = cols(n).map((c) => `<td>${elements(c.children, out)}</td>`);
      rows.push(`<tr>${cells.join("")}</tr>`);
      continue;
    }
    if (isEl(n) || n.text.trim()) flush();
    tips();
    html += node(n, out);
    tips();
  }
  flush();
  tips();
  return html;
}

export function renderSection(els: El[]): string {
  return sanitizeCourseHtml(elements(els, { pending: [] }, true), { image: () => undefined });
}
