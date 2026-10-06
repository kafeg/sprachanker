// Examples read aloud: each player of a page with the example lines it reads.
import { type El, find, hasClass, innerHtml, isEl } from "../dom.ts";
import { englishLine, flatText } from "../text.ts";
import { isHeading, isPlayer, playerSrc, textOf } from "./page.ts";

export interface Line {
  en: string;
  ru?: string;
}

/** An example read aloud: its recording (absolute URL; none when the player is locked) and text. */
export interface Snippet {
  audio?: string;
  lines: Line[];
}

/**
 * English lines of an element when it is an example block (at least half of its lines are
 * English examples); rows of two columns give English | Russian.
 */
function exampleLines(el: El): Line[] | undefined {
  const cols = el.children.filter(isEl);
  if (
    hasClass(el, "row") &&
    cols.length === 2 &&
    cols.every((c) => /\bcol-/.test(c.attrs.class ?? ""))
  ) {
    const [a, b] = cols.map((c) => flatText(innerHtml(c, true))) as [string, string];
    const en = englishLine(a);
    if (en && !englishLine(b)) return [{ en: en.en, ...(b ? { ru: b } : {}) }];
  }
  const raw = innerHtml(el, true)
    .replace(/<\/(p|li|div|h\d|tr|td)>|<br\s*\/?>/gi, "\n")
    .split("\n")
    .filter((l) => flatText(l));
  const found = raw.flatMap((l) => {
    const line = englishLine(l);
    return line ? [line] : [];
  });
  return found.length && found.length * 2 >= raw.length ? found : undefined;
}

/** Where a player sits: its siblings and its index, for each level up to the section. */
type Place = Array<{ els: El[]; i: number }>;

/**
 * Text of a player: the next example block, else (a table read after it is shown) the previous, up to
 * the next heading or recording outside an example block. A player alone in its container (a column)
 * looks around that container. Players grouped in a container with no text of its own (the same word in
 * two accents) belong to what was shown before them, so above it they only look back. A recording
 * without its own lines (the whole alphabet) thus gets none rather than an example further down.
 */
export function snippetLines(place: Place): Line[] {
  const holdsPlayer = (el: El) => isPlayer(el) || !!find(el, isPlayer);
  const stop = (el: El) => isPlayer(el) || isHeading(el) || (holdsPlayer(el) && !exampleLines(el));
  const blank = (el: El) => !holdsPlayer(el) && textOf(el) === "";
  let grouped = false;
  for (let level = place.length - 1; level >= 0; level--) {
    const { els, i } = place[level] as Place[number];
    for (let j = i + 1; !grouped && j < els.length && !stop(els[j] as El); j++) {
      const found = exampleLines(els[j] as El);
      if (!found) continue;
      // A parallel text: consecutive rows.
      for (let k = j + 1; hasClass(els[j], "row") && k < els.length && hasClass(els[k], "row"); k++)
        found.push(...(exampleLines(els[k] as El) ?? []));
      return found;
    }
    for (let j = i - 1; j >= 0 && !stop(els[j] as El); j--) {
      const found = exampleLines(els[j] as El);
      if (found) return found;
    }
    const others = els.filter((e, j) => j !== i && !blank(e));
    const parent = level > 0 ? place[level - 1] : undefined;
    const container = parent?.els[parent.i];
    if (others.length && others.every(holdsPlayer) && container && textOf(container) === "")
      grouped = true;
  }
  return [];
}

/** Players at any depth, each with the elements around it (its siblings) for its text. */
export function snippets(els: El[], base: string, skip?: El, outer: Place = []): Snippet[] {
  return els.flatMap((el, i) => {
    const place = [...outer, { els, i }];
    if (!isPlayer(el)) return snippets(el.children.filter(isEl), base, skip, place);
    if (el === skip) return [];
    const audio = playerSrc(el, base);
    return [{ ...(audio ? { audio } : {}), lines: snippetLines(place) }];
  });
}
