// Aligning an edition with the canonical lesson (02, "Editions"): a course's editions are separate
// source courses — the same target-language exercises, but an edition may add or drop one, reorder
// options, or change a picture. Canonical files come from the primary edition; another edition's
// locale texts are re-keyed by matching content, never by position, so its titles, hints and option
// translations land on the right exercise and option. Pure; works on normalised files only.
import type { Exercise, Lesson, LocaleItem, LocaleLesson, Option } from "@sprachanker/schema";
import { correctOptions } from "@sprachanker/schema";
import { canonicalJson } from "./canonical-json.ts";

export interface AlignReport {
  /** Edition exercises without a canonical counterpart (their texts are not used). */
  unmatchedExercises: string[];
  /** Exercises paired by position although their content differs (changed wording or pictures). */
  approximate: string[];
  /** Edition words without a canonical entry (their translations are not used). */
  unmatchedWords: string[];
}

type Item = Exercise["items"][number];
type IdLists = Record<string, Option[]>;

const token = (o: Option) =>
  `${o.text ?? ""}|${o.media?.image ?? o.media?.audio ?? o.media?.video ?? ""}`;

/** The option lists of an item, by role (ids are only unique within a role). */
function idLists(type: Exercise["type"], item: Item): IdLists {
  const it = item as unknown as Record<string, unknown>;
  switch (type) {
    case "single_choice":
    case "multi_choice":
      return { options: it.options as Option[] };
    case "match":
      return { left: it.left as Option[], right: it.right as Option[] };
    case "order":
      return { parts: it.parts as Option[] };
    case "gap_choice":
      return Object.fromEntries(
        Object.entries(it.gaps as Record<string, { options: Option[] }>).map(([g, v]) => [
          `gap:${g}`,
          v.options,
        ]),
      );
    default:
      return {};
  }
}

/** An item's content with option ids replaced by their content, so a reordering compares equal. */
function itemSignature(type: Exercise["type"], item: Item): unknown {
  const { key: _, ...rest } = item as Item & { key: string };
  const lists = idLists(type, item);
  const text = (role: string, id: string) => {
    const o = lists[role]?.find((x) => x.id === id);
    return o ? token(o) : `?${id}`;
  };
  const sorted = (os: Option[]) => os.map(token).sort();
  const it = rest as Record<string, unknown>;
  switch (type) {
    case "single_choice":
    case "multi_choice": {
      const answer = (it.answer as { optionIds: string[] }).optionIds;
      return {
        ...it,
        options: sorted(lists.options ?? []),
        answer: answer.map((id) => text("options", id)).sort(),
      };
    }
    case "match": {
      const pairs = (it.answer as { pairs: [string, string][] }).pairs;
      return {
        ...it,
        left: sorted(lists.left ?? []),
        right: sorted(lists.right ?? []),
        answer: pairs.map(([l, r]) => `${text("left", l)}=${text("right", r)}`).sort(),
      };
    }
    case "order": {
      const sequence = (it.answer as { sequence: string[] }).sequence;
      return {
        ...it,
        parts: sorted(lists.parts ?? []),
        answer: sequence.map((id) => text("parts", id)),
      };
    }
    case "gap_choice": {
      const gaps = it.gaps as Record<string, { options: Option[] }>;
      const answer = it.answer as Record<string, string | string[]>;
      return {
        ...it,
        gaps: Object.fromEntries(Object.entries(gaps).map(([g, v]) => [g, sorted(v.options)])),
        answer: Object.fromEntries(
          Object.entries(answer).map(([g, w]) => [
            g,
            correctOptions(w)
              .map((id) => text(`gap:${g}`, id))
              .sort(),
          ]),
        ),
      };
    }
    default:
      return it;
  }
}

export function exerciseSignature(ex: Exercise): string {
  const { key: _k, fingerprint: _f, items, ...rest } = ex;
  // Canonical JSON: files read from disk and drafts in memory order their keys differently.
  return canonicalJson({ ...rest, items: items.map((i) => itemSignature(ex.type, i)) });
}

/** Longest common subsequence of two lists of signatures: index pairs in order. */
function lcs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (t[i] as number[])[j] =
        a[i] === b[j]
          ? ((t[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((t[i + 1] as number[])[j] as number, (t[i] as number[])[j + 1] as number);
  const out: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (((t[i + 1] as number[])[j] as number) >= ((t[i] as number[])[j + 1] as number)) i++;
    else j++;
  }
  return out;
}

/**
 * Pairs the edition's exercises with the canonical ones: identical content first (in order), then,
 * between two such anchors, the remaining ones by position when both runs have the same length and
 * types (an edited exercise). Returns edition index → canonical index.
 */
function pairExercises(canonical: Exercise[], edition: Exercise[]) {
  const exact = lcs(canonical.map(exerciseSignature), edition.map(exerciseSignature));
  const pairs = new Map<number, { to: number; exact: boolean }>();
  for (const [c, e] of exact) pairs.set(e, { to: c, exact: true });
  const anchors: Array<[number, number]> = [[-1, -1], ...exact, [canonical.length, edition.length]];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [c0, e0] = anchors[k] as [number, number];
    const [c1, e1] = anchors[k + 1] as [number, number];
    const cs = canonical.slice(c0 + 1, c1);
    const es = edition.slice(e0 + 1, e1);
    if (cs.length && cs.length === es.length && cs.every((c, i) => c.type === es[i]?.type))
      for (let i = 0; i < cs.length; i++) pairs.set(e0 + 1 + i, { to: c0 + 1 + i, exact: false });
  }
  return pairs;
}

/** Edition option id → canonical option id, per role, by equal content. */
function optionMap(type: Exercise["type"], from: Item, to: Item) {
  const a = idLists(type, from);
  const b = idLists(type, to);
  const map = new Map<string, string>();
  for (const [role, options] of Object.entries(a)) {
    const free = [...(b[role] ?? [])];
    for (const o of options) {
      const i = free.findIndex((x) => token(x) === token(o));
      if (i < 0) continue;
      map.set(`${role}:${o.id}`, (free[i] as Option).id);
      free.splice(i, 1);
    }
  }
  return map;
}

/** Locale texts of one item, with option ids moved to the canonical item's ids. */
function remapItem(loc: LocaleItem, type: Exercise["type"], from: Item, to: Item) {
  const map = optionMap(type, from, to);
  const role = type === "order" ? "parts" : type === "match" ? undefined : "options";
  const move = (rec: Record<string, string> | undefined, roles: string[]) => {
    if (!rec) return undefined;
    const out: Record<string, string> = {};
    for (const [id, text] of Object.entries(rec)) {
      if (id === "item") {
        out[id] = text;
        continue;
      }
      const target = roles.map((r) => map.get(`${r}:${id}`)).find(Boolean);
      if (target) out[target] = text;
    }
    return Object.keys(out).length ? out : undefined;
  };
  // Option texts of match items are keyed by id across both sides; try either.
  const roles = role ? [role] : ["left", "right"];
  const { options, alt, ...rest } = loc;
  const o = move(options, roles);
  const a = move(alt, roles);
  return { ...rest, ...(o ? { options: o } : {}), ...(a ? { alt: a } : {}) };
}

/**
 * Re-keys an edition's locale lesson (normalised from its own pages as `draft`) onto the canonical
 * lesson: exercises and their items and options by content, words by headword.
 */
export function alignLocale(
  canonical: Lesson,
  draft: Lesson,
  locale: LocaleLesson,
): { locale: LocaleLesson; report: AlignReport } {
  const cEx = canonical.pages.map((p) => p.exercise);
  const dEx = draft.pages.map((p) => p.exercise);
  const pairs = pairExercises(cEx, dEx);
  const report: AlignReport = { unmatchedExercises: [], approximate: [], unmatchedWords: [] };
  const exercises: LocaleLesson["exercises"] = {};
  dEx.forEach((ex, i) => {
    const texts = locale.exercises[ex.key];
    const pair = pairs.get(i);
    if (!pair) {
      report.unmatchedExercises.push(ex.key);
      return;
    }
    const target = cEx[pair.to] as Exercise;
    if (!pair.exact) report.approximate.push(target.key);
    if (!texts) return;
    const items: typeof texts.items = {};
    for (const [ref, loc] of Object.entries(texts.items)) {
      const n = Number(ref.slice(1));
      const from = ex.items[n - 1];
      const to = target.items[n - 1];
      if (from && to) items[ref] = remapItem(loc, ex.type, from, to);
    }
    exercises[target.key] = { ...texts, items };
  });

  const byHeadword = new Map(canonical.vocab.map((v) => [v.target, v.key]));
  const vocab: LocaleLesson["vocab"] = {};
  for (const entry of draft.vocab) {
    const text = locale.vocab[entry.key];
    const key = byHeadword.get(entry.target);
    if (!key) report.unmatchedWords.push(entry.target);
    else if (text) vocab[key] = text;
  }
  return { locale: { ...locale, exercises, vocab }, report };
}
