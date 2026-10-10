// A module page's blocks (page.ts) put together as the test is: its Teile, each with its instructions,
// its material (a text, pictures, a recording, the letters a set of answers is chosen from) and its
// questions — the examples apart. Where a recording belongs is read from where it stands: inside a
// question before its options it is that question's; after a group of questions (B1) it is theirs —
// the Teil's when they are all of it; before any question it is the Teil's.
import type { AnswerTable, Block, Choice, Fieldset, Picture } from "./page.ts";

export interface Question {
  /** "Beispiel 0": shown answered, never scored. */
  example: boolean;
  /** The number its heading gives, if any (checked against its place). */
  number?: number;
  /** What the heading says besides its number: the question (no legend) or its situation. */
  heading: string;
  legend: string;
  choices: Choice[];
  pictures: Picture[];
  /** Pages holding the text of its pictures. */
  links: string[];
  texts: string[];
  audio?: string;
  /** A one-letter answer or a form's gap: its label and what the example holds. */
  typed?: { label: string; value: string };
  /** A line of an answer table (a weekday). */
  line?: string;
}

/** One of the letters an answer is chosen from (A2 Hören 2's pictures, the ads a–f). */
export interface Letter {
  letter: string;
  texts: string[];
  picture?: Picture;
}

export interface Teil {
  number: number;
  title: string;
  instructions: string[];
  form?: { id: string; action: string };
  texts: string[];
  pictures: Picture[];
  audio?: string;
  letters: Letter[];
  questions: Question[];
}

export interface Module {
  /** The page's lines before its first Teil (its time). */
  intro: string[];
  teile: Teil[];
}

/** A heading that opens a question: its kind, number and the rest. */
const QUESTION =
  /^(Beispiel|Aufgabe(?!n)|Aussage|Situation)\b\s*:?\s*(?:zu\s+(?:Text|Beispiel)\s+\d+\s+Nummer\s+\d+|(\d+))?\s*(.*)$/i;
/** A heading naming a group or a text, not a question ("Die Aufgaben 6 bis 10", "Text - Teil 1"). */
const LABEL = /(\bTeil\s*\d|^Die\s|^Aufgaben\b|^Text\b|text\b.*Teil|^Internet|^Situationen)/i;
const LETTER = /^Anzeige\s+([a-z])$/i;

const emptyQuestion = (
  example: boolean,
  number: number | undefined,
  heading: string,
): Question => ({
  example,
  ...(number !== undefined && { number }),
  heading,
  legend: "",
  choices: [],
  pictures: [],
  links: [],
  texts: [],
});

const answered = (q: Question) => q.choices.length > 0 || q.typed !== undefined;

/** A heading's rest without the "- Teil 2" and dashes around it. */
const tail = (rest: string) =>
  rest
    .replace(/^[-–:]?\s*Teil\s*\d+\s*/i, "")
    .replace(/^[-–:\s]+/, "")
    .trim();

export function readModule(blocks: Block[]): Module {
  const intro: string[] = [];
  const teile: Teil[] = [];
  let teil: Teil | undefined;
  let question: Question | undefined;
  /** Questions since the last recording: a recording after them is theirs. */
  let group: Question[] = [];
  /** A recording after a group of questions: whose it is, settled once the Teil is read. */
  const after = new Map<Question, Question[]>();
  let letter: Letter | undefined;
  /** Whether what comes is the Teil's material (after a label heading) rather than its instructions. */
  let material = false;
  /** A form opened before its Teil's heading (B1 Lesen 2): that Teil's. */
  let nextForm: Teil["form"];

  const close = () => {
    // A question that never got its options was a label for what followed: its recording and texts
    // are the Teil's.
    if (question && teil && !answered(question)) {
      if (question.audio) teil.audio ??= question.audio;
      teil.texts.push(
        ...question.texts,
        ...(question.heading && !LABEL.test(question.heading) ? [question.heading] : []),
      );
      teil.pictures.push(...question.pictures);
      teil.questions = teil.questions.filter((q) => q !== question);
      group = group.filter((q) => q !== question);
    }
    question = undefined;
  };
  const start = (example: boolean, number: number | undefined, heading: string) => {
    if (!teil) return;
    // A second heading before the question's options says more of the same question (A2 Hören 4).
    if (question && !answered(question) && !question.choices.length) {
      question.example ||= example;
      if (heading) question.heading = heading;
      if (number !== undefined) question.number = number;
      return;
    }
    close();
    question = emptyQuestion(example, number, heading);
    teil.questions.push(question);
    group.push(question);
    letter = undefined;
  };
  const fieldset = (f: Fieldset) => {
    if (!teil) return;
    if (!question || answered(question)) start(f.disabled, undefined, "");
    const q = question as Question;
    q.legend = f.legend;
    q.choices = f.choices;
    q.pictures.push(...f.pictures);
    q.links.push(...f.links);
    q.texts.push(...f.tables);
    if (f.typed[0]) q.typed = f.typed[0];
    q.example ||= f.disabled || f.choices.some((c) => c.checked);
  };
  const table = (t: AnswerTable) => {
    if (!teil) return;
    close();
    for (const col of t.columns) {
      const example = col.disabled || /Beispiel/i.test(col.number);
      const number = Number.parseInt(col.number.replace(/\D+/g, ""), 10);
      const q = emptyQuestion(example, Number.isNaN(number) ? undefined : number, "");
      q.line = col.prompt;
      q.typed = { label: "", value: col.value };
      teil.questions.push(q);
      group.push(q);
    }
  };

  for (const b of blocks) {
    if (b.kind === "teil") {
      close();
      if (teil) teile.push(teil);
      const number = Number(/\d+/.exec(b.title)?.[0] ?? teile.length + 1);
      // "Teil 2 Text 2" goes on in the form "Teil 2 Text 1" opened.
      const same = teile.at(-1);
      const form = nextForm ?? (same?.number === number ? same.form : undefined);
      nextForm = undefined;
      teil = {
        number,
        title: b.title,
        ...(form && { form }),
        instructions: [],
        texts: [],
        pictures: [],
        letters: [],
        questions: [],
      };
      group = [];
      letter = undefined;
      material = false;
      continue;
    }
    if (b.kind === "end") {
      close();
      if (teil) teile.push(teil);
      teil = undefined;
      continue;
    }
    if (!teil) {
      if (b.kind === "text") intro.push(b.text);
      continue;
    }
    switch (b.kind) {
      case "form":
        // A Teil with its form and questions already: the form is the next Teil's.
        if (teil.form && teil.questions.length) nextForm = { id: b.id, action: b.action };
        else teil.form = { id: b.id, action: b.action };
        break;
      case "formEnd":
        close();
        material = true;
        break;
      case "heading": {
        const text = b.text.trim();
        if (!text) break;
        const isQuestion = QUESTION.exec(text);
        const lettered = LETTER.exec(text);
        if (lettered) {
          close();
          letter = { letter: (lettered[1] as string).toLowerCase(), texts: [] };
          teil.letters.push(letter);
          material = true;
        } else if (isQuestion && !/^Aufgaben\b/i.test(text)) {
          const number = isQuestion[2];
          start(
            /^Beispiel/i.test(text),
            number === undefined ? undefined : Number(number),
            tail(isQuestion[3] ?? ""),
          );
        } else if (/Beispiel\s*:?\s*0/i.test(text)) {
          // "Aufgaben - Teil 1 Beispiel 0 - Teil 1": the example's question comes next.
          start(true, 0, "");
        } else if (LABEL.test(text)) {
          // A label opens the Teil's material: a recording after it is the Teil's, not the
          // questions' before it.
          close();
          material = true;
          letter = undefined;
          group = [];
        } else if (question && !answered(question)) question.texts.push(text);
        else (letter?.texts ?? teil.texts).push(text);
        break;
      }
      case "text":
        if (question && !answered(question)) question.texts.push(b.text);
        else if (letter) letter.texts.push(b.text);
        else if (material || teil.questions.length) teil.texts.push(b.text);
        else teil.instructions.push(b.text);
        break;
      case "picture":
        if (question && !answered(question)) question.pictures.push(b.picture);
        else if (letter && !letter.picture) letter.picture = b.picture;
        else teil.pictures.push(b.picture);
        break;
      case "audio":
        if (question && !answered(question)) question.audio = b.src;
        else if (group.length) {
          // After its questions (B1): theirs — kept on the first, or the Teil's when they are all.
          const first = group[0] as Question;
          first.audio ??= b.src;
          after.set(first, group);
          group = [];
        } else teil.audio ??= b.src;
        break;
      case "fieldset":
        fieldset(b.fieldset);
        break;
      case "table":
        table(b.table);
        break;
    }
  }
  close();
  if (teil) teile.push(teil);

  // A recording after every question of a Teil is the Teil's (B1 Hören 2–4).
  for (const t of teile) {
    const scored = t.questions.filter((q) => !q.example);
    for (const q of t.questions) {
      const owners = after.get(q);
      if (owners && scored.length && scored.every((s) => owners.includes(s)) && q.audio) {
        t.audio ??= q.audio;
        delete q.audio;
      }
    }
  }
  // Letters given as a row of pictures (A2 Hören 2: "Die Bilder a bis i") are the Teil's pictures in
  // order when its questions are answered by letter.
  for (const t of teile)
    if (
      !t.letters.length &&
      t.pictures.length > 1 &&
      t.questions.some((q) => q.typed && q.line !== undefined)
    ) {
      t.letters = t.pictures.map((picture, i) => ({
        letter: String.fromCharCode(97 + i),
        texts: [],
        picture,
      }));
      t.pictures = [];
    }
  return { intro, teile };
}
