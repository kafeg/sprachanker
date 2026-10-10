// Shared pieces of the site's pages: an element's text, players, and an article's own elements.
// Lessons are hand-edited Joomla articles: a flat run of paragraphs, headings, rows and players.
import {
  type El,
  find,
  hasClass,
  innerHtml,
  isEl,
  parseHtml,
  plainText,
} from "@sprachanker/course-kit";

export const textOf = (el: El) => plainText(innerHtml(el, true));

export const isHeading = (el: El) => /^h[2-4]$/.test(el.tag);
export const isPlayer = (el: El) =>
  hasClass(el, "cplayer") ||
  el.tag === "audio" ||
  hasClass(el, "cplayer-lock") ||
  (el.tag === "p" && !!find(el, (e) => e.tag === "audio") && textOf(el) === "");
export const playerSrc = (el: El, base: string) => {
  const src = el.attrs["data-src"] ?? find(el, (e) => e.tag === "source")?.attrs.src;
  return src ? new URL(src, base).href : undefined;
};

/** The article's own elements: without the header, the title and the closing app promotion. */
export function articleElements(html: string): { title: string; els: El[] } {
  const body = find(parseHtml(html), (e) => hasClass(e, "com-content-article__body"));
  if (!body) throw new Error("lesson page: no article body");
  const all = body.children.filter(isEl);
  const h1 = find(body, (e) => e.tag === "h1");
  let end = all.findIndex((e) => /Курс доступен в виде приложения/.test(textOf(e)));
  if (end < 0) {
    end = all.findLastIndex((e) => !!find(e, (a) => /apps\.apple\.com/.test(a.attrs.href ?? "")));
    if (end >= 0 && all[end - 1]?.tag === "p") end--;
  }
  const els = all
    .slice(0, end < 0 ? all.length : end)
    .filter((e) => !hasClass(e, "bg-en") && !hasClass(e, "module-title-surround"));
  return { title: h1 ? textOf(h1) : "", els };
}
