// The site's pages → data. Lessons are hand-edited Joomla articles: a flat run of paragraphs,
// headings, rows and players; then a vocabulary ("Словарь") and numbered exercises ("Упражнение N")
// whose answer keys sit in tooltips (`data-tooltips-content`).
import { plainText } from "@sprachanker/course-kit";
import { type El, find, findAll, hasClass, innerHtml, isEl, type Node, parseHtml } from "./dom.ts";
import { englishLine, flatText, ipaOf, withoutIpa } from "./text.ts";

export const textOf = (el: El) => plainText(innerHtml(el, true));

// ---- index ----------------------------------------------------------------------------------

export interface IndexLesson {
  /** Last path segment: `lesson8`, `irregular-verbs`. */
  slug: string;
  title: string;
  desc: string;
  level: string;
}

export interface IndexStage {
  title: string;
  lessons: IndexLesson[];
}

/** The course index: stages ("ЭТАП 1. …") with their lessons, then the bonus materials. */
export function parseIndex(html: string): IndexStage[] {
  const container = find(parseHtml(html), (e) => hasClass(e, "course-container"));
  if (!container) throw new Error("course index: no course-container");
  const stages: IndexStage[] = [];
  for (const el of findAll(
    container,
    (e) => hasClass(e, "level-divider") || hasClass(e, "lesson-row"),
  )) {
    if (hasClass(el, "level-divider")) {
      const title = find(el, (e) => hasClass(e, "part-title"));
      stages.push({
        title: (title ? textOf(title) : "").replace(/^[^\p{L}\p{N}]+/u, ""),
        lessons: [],
      });
      continue;
    }
    const part = (cls: string) => {
      const e = find(el, (x) => hasClass(x, cls));
      return e ? textOf(e) : "";
    };
    const slug = (el.attrs.href ?? "").split("/").pop() ?? "";
    stages.at(-1)?.lessons.push({
      slug,
      title: part("lesson-title"),
      desc: part("lesson-desc"),
      level: part("lvl"),
    });
  }
  return stages;
}

// ---- lesson page -----------------------------------------------------------------------------

export interface Line {
  en: string;
  ru?: string;
}

/** An example read aloud: its recording (absolute URL; none when the player is locked) and text. */
export interface Snippet {
  audio?: string;
  lines: Line[];
}

/** A part of the explanation, split at `<h2>`; elements as in the page (players included). */
export interface Section {
  title: string;
  elements: El[];
  snippets: Snippet[];
}

export interface VocabRow {
  head: string;
  ipa?: string;
  translation: string;
  /** Part-of-speech marks of the source ("v.", "adj", "n."). */
  marks: string[];
  /** Past and participle as the source lists them ("прош. chose; прич. chosen"). */
  forms: string[];
}

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

export interface LessonPage {
  title: string;
  sections: Section[];
  vocab: VocabRow[];
  exercises: SourceExercise[];
  /** A recording of the lesson's text (full-width player outside exercises). */
  audio?: string;
}

const EXERCISE = /^(?:Упражнение|Exercise)\s*(\d+)/;
const isHeading = (el: El) => /^h[2-4]$/.test(el.tag);
const headingLike = (el: El) =>
  isHeading(el) || (el.tag === "p" && hasClass(el, "tac") && textOf(el).length < 60);
const isPlayer = (el: El) =>
  hasClass(el, "cplayer") ||
  el.tag === "audio" ||
  hasClass(el, "cplayer-lock") ||
  (el.tag === "p" && !!find(el, (e) => e.tag === "audio") && textOf(el) === "");
const playerSrc = (el: El, base: string) => {
  const src = el.attrs["data-src"] ?? find(el, (e) => e.tag === "source")?.attrs.src;
  return src ? new URL(src, base).href : undefined;
};
const tooltips = (el: El) =>
  [el, ...findAll(el, () => true)].filter((e) => "data-tooltips-content" in e.attrs);
const isKey = (tip: El) => !!find(tip, (e) => hasClass(e, "key"));
const isHint = (tip: El) => !!find(tip, (e) => /lbulb/.test(e.attrs.src ?? ""));

/** Lines of an element: `<br>` and block ends separate them; rows give English | Russian. */
export function lines(el: El): Line[] {
  return exampleLines(el) ?? [];
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
function snippetLines(place: Place): Line[] {
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
function snippets(els: El[], base: string, skip?: El, outer: Place = []): Snippet[] {
  return els.flatMap((el, i) => {
    const place = [...outer, { els, i }];
    if (!isPlayer(el)) return snippets(el.children.filter(isEl), base, skip, place);
    if (el === skip) return [];
    const audio = playerSrc(el, base);
    return [{ ...(audio ? { audio } : {}), lines: snippetLines(place) }];
  });
}

function vocabRows(els: El[]): VocabRow[] {
  const cols = els.flatMap((el) => findAll(el, (e) => /\bcol-/.test(e.attrs.class ?? "")));
  return cols.flatMap((col) =>
    innerHtml(col, true)
      .split(/<br\s*\/?>/i)
      .flatMap((entry) => {
        const head = /<strong>([\s\S]*?)<\/strong>/.exec(entry);
        if (!head) return [];
        const after = entry.slice((head.index ?? 0) + head[0].length);
        const rest = plainText(after);
        // The transcription right after the headword ("/bed/" has no IPA marks to recognise).
        const lead = /^\/[^/]+\//.exec(rest)?.[0];
        const ipa = lead ?? ipaOf(` ${rest}`);
        const marks = [...after.matchAll(/<em>\s*(v|adj|n|adv)\.?\s*<\/em>/g)].map(
          (m) => m[1] as string,
        );
        const forms = /прош/.test(after)
          ? [...after.matchAll(/(?:прош|прич)[^<]*<\/em>\s*<strong>([^<]+)<\/strong>/g)].map((m) =>
              plainText(m[1]),
            )
          : [];
        const translation = withoutIpa(` ${lead ? rest.slice(lead.length) : rest}`).replace(
          /^[\s=]+/,
          "",
        );
        return [
          {
            head: plainText(head[1]),
            ...(ipa ? { ipa } : {}),
            translation,
            marks,
            forms,
          },
        ];
      }),
  );
}

/** Key entries by number ("3", "12a", "12b"); lines before any number go to `free`. */
export function keyEntries(
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
      const part = /^([абвгaбcd])\)\s*(.*)$/i.exec(line);
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

function parseExercise(label: string, head: El, els: El[], base: string): SourceExercise {
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

/** The article's own elements: without the header, the title and the closing app promotion. */
function articleElements(html: string): { title: string; els: El[] } {
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

/** A lesson page; `base` is its URL (players' paths are relative to the site). */
export function parseLesson(html: string, base: string): LessonPage {
  const { title, els } = articleElements(html);
  const exStart = els.findIndex(
    (e) =>
      (headingLike(e) && /^(Упражнения|Exercises)/.test(textOf(e))) ||
      (e.tag === "p" && EXERCISE.test(textOf(e))),
  );
  const contentEnd = exStart < 0 ? els.length : exStart;
  const vocabStart = els
    .slice(0, contentEnd)
    .findIndex((e) => headingLike(e) && /^(Словарь( урока)?|Vocabulary):?$/.test(textOf(e)));
  // The vocabulary: rows and their sub-headings ("Дополнительные слова:"); what follows it before
  // the exercises (lesson 52: the final story) is explanation again.
  let vocabEnd = vocabStart;
  if (vocabStart >= 0)
    while (
      vocabEnd + 1 < contentEnd &&
      (hasClass(els[vocabEnd + 1], "row") || headingLike(els[vocabEnd + 1] as El))
    )
      vocabEnd++;
  const vocabEls = vocabStart < 0 ? [] : els.slice(vocabStart + 1, vocabEnd + 1);
  const before = els.slice(0, vocabStart < 0 ? contentEnd : vocabStart);
  const after = vocabStart < 0 ? [] : els.slice(vocabEnd + 1, contentEnd);

  const sections: Section[] = [];
  for (const part of [before, after]) {
    let current: Section | undefined;
    for (const el of part) {
      if (el.tag === "h2" || !current) {
        current = { title: el.tag === "h2" ? textOf(el) : title, elements: [], snippets: [] };
        sections.push(current);
        if (el.tag === "h2") continue;
      }
      current.elements.push(el);
    }
  }
  // The first full-width player reads the lesson's text: the lesson's recording.
  const full = [...before, ...after]
    .flatMap((e) => [e, ...findAll(e, () => true)])
    .find((e) => hasClass(e, "cplayer--full"));
  const audio = full ? playerSrc(full, base) : undefined;
  for (const s of sections) s.snippets = snippets(s.elements, base, full);

  const exercises: SourceExercise[] = [];
  if (exStart >= 0) {
    let head: El | undefined;
    let label = "";
    let block: El[] = [];
    const push = () => {
      if (head) exercises.push(parseExercise(label, head, block, base));
    };
    for (const el of els.slice(exStart)) {
      const m = el.tag === "p" ? EXERCISE.exec(textOf(el)) : null;
      if (m) {
        push();
        head = el;
        label = /^\S+\s*\d+/.exec(textOf(el))?.[0] ?? m[0];
        block = [];
      } else block.push(el);
    }
    push();
  }
  return {
    title,
    sections,
    vocab: vocabRows(vocabEls),
    exercises,
    ...(audio ? { audio } : {}),
  };
}

/** The irregular verbs table: infinitive, past, participle, translation. */
export interface VerbRow {
  forms: [string, string, string];
  translation: string;
}

export function parseVerbTable(html: string): { title: string; elements: El[]; rows: VerbRow[] } {
  const { title, els } = articleElements(html);
  const table = els.flatMap((e) =>
    e.tag === "table" ? [e] : findAll(e, (x) => x.tag === "table"),
  )[0];
  const cell = (td: El) =>
    plainText(innerHtml(td, true).replace(/<br\s*\/?>/gi, " / "))
      .replace(/\s*\/\s*(?=\/)/g, " ")
      .replace(/,\s*\//g, ",")
      .trim();
  const rows = table
    ? findAll(table, (e) => e.tag === "tr").flatMap((tr) => {
        const tds = tr.children.filter((c): c is El => isEl(c) && c.tag === "td");
        if (tds.length !== 4 || hasClass(tr, "tac")) return [];
        const [a, b, c, d] = tds.map(cell) as [string, string, string, string];
        return [
          { forms: [a, b, c] as [string, string, string], translation: d.replace(/ \/ /g, ", ") },
        ];
      })
    : [];
  return { title, elements: els, rows };
}
