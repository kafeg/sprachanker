// A speaking part (speaking.ts) as a section of the exam: one open answer said aloud, rated by the
// part's criteria — those the page lists (B1: each at the score sheet's bands for its maximum, those
// for all parts with the last), else the level's from its score sheet (catalog). The learner's cards
// or slides are the section's letters (picture and text); what candidate B has (their card, calendar,
// slides) is the partner's, for the assistant playing them. Pure: the pages and media are given.
import {
  type Exam,
  type ExamItem,
  type ExamItemKey,
  type ExamKey,
  examItemKey,
  type LocaleItem,
  type MediaPath,
} from "@sprachanker/schema";
import type { Level } from "./catalog.ts";
import type { SpeakingModule, SpeakingPart } from "./speaking.ts";
import { criterionId } from "./writing-exam.ts";

type Letters = NonNullable<Exam["sections"][number]["letters"]>;

export interface SpeakingSection {
  item?: ExamItem;
  locale: LocaleItem;
  instructions: string[];
  /** A text the learner has (A2's calendar): its linked page's. */
  text?: string;
  letters: Letters;
  problems: string[];
  /** The part's criteria read with every level's points. */
  criteria: { passed: number; of: number };
}

export function speakingSection(input: {
  level: Level;
  exam: ExamKey;
  module: string;
  /** The page's parts of one number (A2 Teil 3: candidate A's and B's). */
  parts: SpeakingPart[];
  listed: SpeakingModule["criteria"];
  longdesc(href: string): string | undefined;
  media(href: string): MediaPath | undefined;
}): SpeakingSection {
  const { level, exam, module, parts } = input;
  const number = parts[0]?.number ?? 0;
  const where = `${level.course} ${module}-${number}`;
  const out: SpeakingSection = {
    locale: {},
    instructions: [],
    letters: [],
    problems: [],
    criteria: { passed: 0, of: 1 },
  };
  const mine = <T extends { role?: "A" | "B" }>(list: T[]) => list.filter((x) => x.role !== "B");
  const theirs = <T extends { role?: "A" | "B" }>(list: T[]) => list.filter((x) => x.role === "B");
  const lines = parts.flatMap((p) => p.lines);
  const cards = parts.flatMap((p) => p.cards);
  const links = parts.flatMap((p) => p.links);
  const linked = (list: typeof links) =>
    list.flatMap((l) => input.longdesc(l.href) ?? []).join("\n\n");

  // The learner's: the task, the cards (a card shown only as a picture takes its linked text).
  out.instructions = [...new Set(mine(lines).map((l) => l.text))];
  const ownText = linked(mine(links));
  out.letters = mine(cards).map((card, i) => {
    const image = input.media(card.picture.src);
    const text = card.text || ownText;
    return {
      letter: String(i + 1),
      ...(text && { text }),
      ...(image && { media: { image } }),
    };
  });
  if (ownText && !mine(cards).some((c) => !c.text)) out.text = ownText;
  // The partner's: what candidate B is given.
  const partner = [
    ...new Set(theirs(lines).map((l) => l.text)),
    ...theirs(cards).flatMap((c) => (c.text ? [c.text] : [])),
    linked(theirs(links)),
  ]
    .filter(Boolean)
    .join("\n");

  // The criteria: the page's for this part (those of several parts with the last of them), else the
  // level's.
  const listed = input.listed.filter(
    (c) => c.parts.includes(number) && Math.max(...c.parts) === number,
  );
  const own = listed.length
    ? listed.map((c) => ({
        title: c.parts.length > 1 ? `${c.title} (Aufgabe ${c.parts.join(", ")})` : c.title,
        levels: level.speaking?.bands?.[c.max],
        voids: c.title === level.speaking?.voids,
      }))
    : (level.speaking?.criteria?.[number] ?? []);
  const criteria: NonNullable<ExamItem["criteria"]> = [];
  const named: NonNullable<LocaleItem["criteria"]> = {};
  for (const c of own) {
    if (!c.levels) {
      out.problems.push(`${where}: no points for "${c.title}"`);
      continue;
    }
    const id = criterionId(c.title);
    criteria.push({ id, levels: c.levels, ...(c.voids && { voids: true }) });
    named[id] = { title: c.title };
  }
  if (!criteria.length) {
    out.problems.push(`${where}: no criteria`);
    return out;
  }
  if (criteria.length === own.length) out.criteria.passed++;
  const subtitle = parts.find((p) => p.subtitle)?.subtitle;
  out.item = {
    key: examItemKey(exam, `${module}-${number}`) as ExamItemKey,
    type: "respond",
    tags: {},
    input: "speech",
    reference: [],
    ...(subtitle && { prompt: subtitle }),
    criteria,
    ...(partner && { partner }),
  };
  out.locale = { criteria: named };
  return out;
}
