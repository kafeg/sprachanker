// A writing Teil (writing.ts) as a section of the exam: a form's gaps as questions whose answers come
// from the Teil's solution page (A1 Teil 1: typed, a choice ticked), the form itself the section's
// text; a text to write as an open answer rated by the Teil's criteria — each level's points as the
// page gives them, else the score sheet's bands for the criterion's maximum (catalog) — with what
// each level means in the locale. Pure: the pages and media are given.
import {
  type ExamItem,
  type ExamItemKey,
  type ExamKey,
  type ExamSources,
  examItemKey,
  type LocaleItem,
  optionId,
} from "@sprachanker/schema";
import type { Level } from "./catalog.ts";
import { criterionId, rubric } from "./criteria.ts";
import { optionFor } from "./options.ts";
import type { Solution } from "./solutions.ts";
import type { FormField, WritingCriterion, WritingTeil } from "./writing.ts";

export interface WritingSection {
  items: ExamItem[];
  locale: Record<string, LocaleItem>;
  pool: ExamItemKey[];
  /** The form as it stands (its lines), or the text the task answers. */
  text?: string;
  placed: ExamSources["items"];
  problems: string[];
  /** Gaps whose answer the solution page gives, of the form's gaps. */
  answers: { passed: number; of: number };
  /** Texts to write whose criteria were read with every level's points. */
  criteria: { passed: number; of: number };
  /** Questions made, of the gaps and texts the Teil asks. */
  questions: { passed: number; of: number };
}

/** A line of the form as the candidate sees it: "Reisetermin: (5)", "PLZ: 78014". */
const lineOf = (f: FormField) => {
  const label = /:$/.test(f.label) ? f.label : `${f.label}:`;
  if (f.value !== undefined) return `${label} ${f.value}`;
  if (f.gap !== undefined)
    return `${label} (${f.gap})${f.choices ? ` ${f.choices.join(" / ")}` : ""}`;
  return f.label;
};

/** "pro Inhaltspunkt": the criterion judges each point of the task on its own (A1). */
const perPoint = (c: WritingCriterion) => /pro Inhaltspunkt/i.test(c.title);

export function writingSection(input: {
  level: Level;
  exam: ExamKey;
  module: string;
  teil: WritingTeil;
  /** The Teil's solution page read, and its id among the sources' documents. */
  solutions: Solution[];
  solutionId: string;
  /** A linked text page's text. */
  longdesc(href: string): string | undefined;
}): WritingSection {
  const { level, exam, module, teil } = input;
  const out: WritingSection = {
    items: [],
    locale: {},
    pool: [],
    placed: {},
    problems: [],
    answers: { passed: 0, of: 0 },
    criteria: { passed: 0, of: 0 },
    questions: { passed: 0, of: 0 },
  };
  const where = `${level.course} ${module}-${teil.number}`;

  if (teil.fields.length) {
    out.text = [teil.heading, ...teil.fields.map(lineOf)].filter(Boolean).join("\n");
    for (const field of teil.fields) {
      if (field.gap === undefined) continue;
      const key = examItemKey(exam, `${module}-${teil.number}-${field.gap}`);
      const answers = input.solutions.find((s) => s.number === field.gap)?.answers ?? [];
      out.answers.of++;
      out.questions.of++;
      const prompt = field.label;
      let item: ExamItem | undefined;
      if (field.choices) {
        const options = field.choices.map((text, i) => ({ id: optionId(i), text }));
        const right = answers.map((a) => optionFor(a, options)).find(Boolean);
        if (right)
          item = {
            key,
            type: "single_choice",
            tags: {},
            prompt,
            options,
            answer: { optionIds: [right] },
          };
      } else if (answers.length)
        item = {
          key,
          type: "gap_text",
          tags: {},
          segments: [`${prompt} `, { gap: "g1" }],
          answer: { g1: { accepted: answers } },
        } as ExamItem;
      if (!item) {
        out.problems.push(`${where}: (${field.gap}) — no answer for ${JSON.stringify(answers)}`);
        continue;
      }
      out.answers.passed++;
      out.questions.passed++;
      out.items.push(item);
      out.pool.push(key);
      out.placed[key] = [
        { document: module, at: `${teil.title}, (${field.gap})` },
        { document: input.solutionId, at: `Lösung ${field.gap}` },
      ];
    }
    return out;
  }

  out.questions.of++;
  if (teil.box === undefined) {
    out.problems.push(`${where}: neither a form nor a text to write`);
    return out;
  }
  out.text = teil.links.flatMap((href) => input.longdesc(href) ?? []).join("\n\n") || undefined;
  // Each criterion with its levels' points: as the page says them, else the bands of its maximum.
  const { criteria, named, add } = rubric();
  let complete = teil.criteria.length > 0;
  for (const c of teil.criteria) {
    const given = c.levels.length > 1 && c.levels.every((l) => l.points !== undefined);
    const max = c.max ?? level.writing?.max;
    const points = given
      ? c.levels.map((l) => l.points as number)
      : max !== undefined
        ? level.writing?.bands[max]
        : undefined;
    if (!points) {
      out.problems.push(`${where}: no points for "${c.title}"`);
      complete = false;
      continue;
    }
    const texts = points.map((_, i) => c.levels[i]?.text ?? "");
    const voids = c.voids || c.title === level.writing?.voids;
    const own = (id: string, title: string) => add(id, title, points, voids, texts);
    if (perPoint(c) && teil.points.length)
      teil.points.forEach((point, i) => {
        own(`inhaltspunkt-${i + 1}`, `Inhaltspunkt ${i + 1}: ${point}`);
      });
    else own(criterionId(c.title), c.title);
  }
  out.criteria.of++;
  if (complete) out.criteria.passed++;
  if (!criteria.length) {
    out.problems.push(`${where}: no criteria`);
    return out;
  }
  const key = examItemKey(exam, `${module}-${teil.number}`);
  out.items.push({
    key,
    type: "respond",
    tags: {},
    input: "text",
    reference: [],
    ...(teil.box && { prompt: teil.box }),
    criteria,
  });
  out.locale[key] = { criteria: named };
  out.questions.passed++;
  out.pool.push(key);
  out.placed[key] = [{ document: module, at: teil.title }];
  return out;
}
