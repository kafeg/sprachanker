// A numbered exercise ("Упражнение N") of a lesson page → its questions, fields and answer keys. The
// keys sit in tooltips (`data-tooltips-content`).
import {
  type El,
  find,
  findAll,
  hasClass,
  innerHtml,
  isEl,
  type Node,
  plainText,
} from "@sprachanker/course-kit";
import { isPlayer, playerSrc, textOf } from "./page.ts";
import { type Snippet, snippetLines, snippets } from "./snippets.ts";

/** One answer-key entry ("3. <strong>hear</strong>: Когда я…"), lines as HTML. */
export type KeyEntry = string[];

/** Text, a text gap, a drop-down gap, or a check box for a comma (`comma`: options "," and "–"). */
export type Seg = string | { input: true } | { options: string[]; comma?: true };

/** One question of an exercise: a list item (or its part a/b) with its key entry. */
export interface Unit {
  /** Number in its list, with the part letter: "3", "12a". */
  n: string;
  segs: Seg[];
  /** Intro of the list it belongs to ("a. Задайте общий вопрос."). */
  intro?: string;
  /** Prompt given in a hint tooltip of the list ("лампочка"). */
  hint?: string;
  key?: KeyEntry;
  /** A worked example: its fields are filled in (`readonly`). */
  example: boolean;
  /** Free-text answer fields (`form-control`) of the unit. */
  fields: number;
  checkbox: boolean;
}

export interface SourceExercise {
  label: string;
  instructionHtml: string;
  units: Unit[];
  /** Text of the task outside lists (paragraphs between the instruction and the answer field). */
  paragraphs: string[];
  /** Question/answer rows ("Question: … Answer: …"). */
  qa: Array<{ q: string; a: string }>;
  textarea: boolean;
  /** Rows of a grid of words: the given word and its answer fields. */
  grid: Array<{ prompt: string; fields: number }>;
  /** Every key line of the exercise in page order, numbers removed (keys of grids). */
  keyLines: string[];
  /** Answers given in tooltips on the task's own words ("1856" → "eighteen fifty-six"). */
  inline: Array<{ prompt: string; answers: string[] }>;
  /** Key text without item numbers (keys of a whole text). */
  freeKey: string[];
  players: Snippet[];
  /** Players after the exercise's key: the lesson's closing phrase. */
  epilogue: Snippet[];
}

const tooltips = (el: El) =>
  [el, ...findAll(el, () => true)].filter((e) => "data-tooltips-content" in e.attrs);
const isKey = (tip: El) => !!find(tip, (e) => hasClass(e, "key"));
const isHint = (tip: El) => !!find(tip, (e) => /lbulb/.test(e.attrs.src ?? ""));

/** Key entries by number ("3", "12a", "12b"); lines before any number go to `free`. */
function keyEntries(
  tips: El[],
  into: Map<string, KeyEntry> = new Map(),
): { entries: Map<string, KeyEntry>; free: string[] } {
  const free: string[] = [];
  for (const tip of tips) {
    let current: KeyEntry | undefined;
    let n = "";
    for (const raw of (tip.attrs["data-tooltips-content"] ?? "").split(/<br\s*\/?>|\n/i)) {
      const line = raw.replace(/&emsp;/g, " ").trim();
      if (!line) continue;
      const num = /^(\d+)\.\s*(.*)$/.exec(line);
      const part = /^([абвгabcd])\)\s*(.*)$/i.exec(line);
      if (num) {
        n = num[1] as string;
        const sub = /^([аa])\)\s*(.*)$/i.exec(num[2] ?? "");
        current = [sub ? (sub[2] ?? "") : (num[2] ?? "")];
        into.set(sub ? `${n}a` : n, current);
      } else if (part && n) {
        const letter = "abcd"["абвг".indexOf(part[1]?.toLowerCase() ?? "")] ?? part[1] ?? "";
        current = [part[2] ?? ""];
        into.set(`${n}${letter.toLowerCase()}`, current);
      } else if (current) {
        current.push(line);
      } else {
        free.push(line);
      }
    }
  }
  return { entries: into, free };
}

/** A list item → its units: split at free-text fields; "a) … b) …" parts become separate units. */
function itemUnits(li: El, n: number): Unit[] {
  const units: Unit[] = [];
  let segs: Seg[] = [];
  let fields = 0;
  let example = false;
  let checkbox = false;
  const flush = () => {
    const text = segs.filter((s) => typeof s === "string").join("");
    const hasGap = segs.some((s) => typeof s !== "string");
    const last = units.at(-1);
    if (last && !hasGap && !text.trim()) {
      last.fields += fields;
    } else if (hasGap || text.trim() || fields) {
      units.push({ n: String(n), segs, example, fields, checkbox });
    }
    segs = [];
    fields = 0;
  };
  const walk = (node: Node) => {
    if (!isEl(node)) {
      segs.push(node.text);
      return;
    }
    if (node.tag === "input") {
      const readonly = "readonly" in node.attrs;
      if (node.attrs.type === "checkbox") {
        checkbox = true;
        segs.push({ options: [",", "–"], comma: true });
      } else if (hasClass(node, "form-control")) {
        fields++;
        if (readonly) example = true;
        flush();
      } else if (readonly) {
        example = true;
        segs.push({ input: true });
      } else segs.push({ input: true });
      return;
    }
    if (node.tag === "select") {
      const options = findAll(node, (e) => e.tag === "option")
        .map(textOf)
        .filter(Boolean);
      segs.push({ options });
      return;
    }
    if (node.tag === "br") {
      segs.push(" ");
      return;
    }
    if (node.tag === "textarea") {
      fields++;
      return;
    }
    for (const child of node.children) walk(child);
  };
  for (const child of li.children) walk(child);
  flush();
  if (units.length > 1) for (const [i, u] of units.entries()) u.n = `${n}${"abcdefgh"[i]}`;
  // "a) " / "b) " labels belong to the numbering, not to the sentence.
  for (const u of units) {
    const first = u.segs.findIndex((s) => typeof s === "string" && s.trim());
    if (first >= 0) u.segs[first] = (u.segs[first] as string).replace(/^\s*[a-dа-г]\)\s*/i, "");
  }
  return units;
}

export function parseExercise(label: string, head: El, els: El[], base: string): SourceExercise {
  const instruction = innerHtml(head).replace(
    /^\s*<strong>[^<]*<\/strong>\s*(\([^)]*\))?\s*\.?\s*/,
    "",
  );
  const ex: SourceExercise = {
    label,
    instructionHtml: instruction,
    units: [],
    paragraphs: [],
    qa: [],
    textarea: false,
    grid: [],
    keyLines: [],
    inline: [],
    freeKey: [],
    players: [],
    epilogue: [],
  };
  let keyed = false;
  let intro: string | undefined;
  let hints = new Map<string, KeyEntry>();
  let list: Unit[] = [];
  let keys = new Map<string, KeyEntry>();
  const closeList = () => {
    for (const u of list) {
      const key = keys.get(u.n) ?? keys.get(u.n.replace(/[a-h]$/, ""));
      const hint = hints.get(u.n)?.join(" ");
      if (key) u.key = key;
      if (hint) u.hint = plainText(hint);
      if (intro) u.intro = intro;
    }
    ex.units.push(...list);
    list = [];
    keys = new Map();
  };
  for (const [i, el] of els.entries()) {
    const tips = tooltips(el);
    for (const tip of tips.filter(isKey))
      for (const line of (tip.attrs["data-tooltips-content"] ?? "").split(/<br\s*\/?>|\n/i)) {
        const text = line
          .replace(/&emsp;/g, " ")
          .replace(/^\s*\d+\.\s*/, "")
          .trim();
        if (text) ex.keyLines.push(text);
      }
    if (el.tag === "ol" || el.tag === "form") {
      closeList();
      const lis = findAll(el, (e) => e.tag === "li");
      list = lis.flatMap((li, k) => itemUnits(li, k + 1));
      keyEntries(tips.filter(isKey), keys);
      keyed ||= tips.some(isKey);
      continue;
    }
    if (isPlayer(el)) {
      const audio = playerSrc(el, base);
      const snippet = { ...(audio ? { audio } : {}), lines: snippetLines([{ els, i }]) };
      (keyed ? ex.epilogue : ex.players).push(snippet);
      continue;
    }
    if (el.tag !== "ol" && el.tag !== "form") ex.players.push(...snippets([el], base));
    if (tips.some(isKey)) {
      const { free } = keyEntries(tips.filter(isKey), keys);
      if (!list.length) ex.freeKey.push(...free);
      keyed = true;
    }
    const fields = findAll(el, (e) => e.tag === "input" && hasClass(e, "form-control")).length;
    if (hasClass(el, "row") && fields) {
      const cells = el.children.filter(isEl).filter((c) => !find(c, (e) => e.tag === "input"));
      ex.grid.push({ prompt: cells.map(textOf).join(" ").trim(), fields });
      continue;
    }
    if (keyed && !list.length && !tips.some(isKey)) continue;
    if (find(el, (e) => e.tag === "textarea")) ex.textarea = true;
    if (el.tag === "p" && !hasClass(el, "tar"))
      for (const tip of tips.filter((t) => !isKey(t) && !isHint(t)))
        ex.inline.push({
          prompt: textOf(tip),
          answers: (tip.attrs["data-tooltips-content"] ?? "")
            .split(/<br\s*\/?>|\n/i)
            .map((l) => plainText(l))
            .filter(Boolean),
        });
    const label2 = find(el, (e) => e.tag === "em" && /^(Question|Answer):$/.test(textOf(e)));
    if (label2 && hasClass(el, "row")) {
      const value = textOf(el).replace(/^(Question|Answer):\s*/, "");
      if (textOf(label2) === "Question:") ex.qa.push({ q: value, a: "" });
      else if (ex.qa.at(-1)) (ex.qa.at(-1) as { a: string }).a = value;
      continue;
    }
    if (tips.some(isHint)) {
      closeList();
      hints = keyEntries(tips.filter(isHint)).entries;
      intro = textOf(el);
      continue;
    }
    if (
      el.tag === "p" &&
      !tips.length &&
      !hasClass(el, "tar") &&
      !find(el, (e) => e.tag === "textarea")
    ) {
      const text = textOf(el);
      if (text) ex.paragraphs.push(innerHtml(el));
    }
  }
  closeList();
  return ex;
}
