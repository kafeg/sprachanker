// A lesson page → data: explanation sections split at `<h2>` with their examples, then a vocabulary
// ("Словарь") and numbered exercises ("Упражнение N").
import { type El, findAll, hasClass } from "@sprachanker/course-kit";
import { parseExercise, type SourceExercise } from "./exercise.ts";
import { articleElements, isHeading, playerSrc, textOf } from "./page.ts";
import { type Snippet, snippets } from "./snippets.ts";
import { type VocabRow, vocabRows } from "./vocab.ts";

/** A part of the explanation, split at `<h2>`; elements as in the page (players included). */
export interface Section {
  title: string;
  elements: El[];
  snippets: Snippet[];
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
const headingLike = (el: El) =>
  isHeading(el) || (el.tag === "p" && hasClass(el, "tac") && textOf(el).length < 60);

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
