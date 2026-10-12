// A practice step's mark from the run (04, "AI practice in courses"): its first work, as an exercise's
// first attempt — a text answered through by its questions right, a text checked or a task said by
// the check's verdict, a role-play by its lines that fit.
import { expect, test } from "bun:test";
import type { TypedEvent } from "@sprachanker/schema";
import { practiceMarks } from "../src/index.ts";

const ev = (n: number, type: TypedEvent["type"], payload: unknown) =>
  ({ id: `E${n}`, runId: "R", ts: n, type, itemKey: null, payload }) as TypedEvent;
const verdict = (n: number, task: string, result: unknown) =>
  ev(n, "llm_verdict", { task, input: "", model: "m", latencyMs: 1, result });

const question = { phase: "reading", question: "Q?", options: ["a", "b"], answer: 0 };
const text = (n: number, step: string | undefined, questions = 2) =>
  verdict(n, "understanding", {
    kind: "reading",
    ...(step && { step }),
    title: "t",
    situation: "",
    lines: [{ text: "x" }],
    glossary: [],
    questions: Array.from({ length: questions }, () => question),
  });
const answered = (n: number, on: number, q: number, result: string) =>
  ev(n, "practice_answered", {
    verdict: `E${on}`,
    question: q,
    answer: { optionId: "a" },
    outcome: { result, score: result === "correct" ? 1 : 0 },
  });
const check = (v: string) => ({
  verdict: v,
  corrected: "",
  corrections: [],
  criteria: {
    task: { score: 2, comment: "" },
    communication: { score: 2, comment: "" },
    accuracy: { score: 2, comment: "" },
  },
  feedback: "",
});

test("a text: marked once every question is answered — all right, some, none; its first answers; the first text counts", () => {
  expect(practiceMarks([text(1, "reading"), answered(2, 1, 0, "correct")]).has("reading")).toBe(
    false,
  );
  const half = [text(1, "reading"), answered(2, 1, 0, "correct"), answered(3, 1, 1, "wrong")];
  expect(practiceMarks(half).get("reading")).toEqual({ mark: "partial", right: 1, of: 2 });
  // A second answer to a question does not change its first; a later text does not change the mark.
  const again = [...half, answered(4, 1, 1, "correct"), text(5, "reading")];
  expect(
    practiceMarks([...again, answered(6, 5, 0, "correct"), answered(7, 5, 1, "correct")]).get(
      "reading",
    ),
  ).toEqual({ mark: "partial", right: 1, of: 2 });
  // A text before the two steps: Reading's when it was to read.
  const old = [text(1, undefined), answered(2, 1, 0, "correct"), answered(3, 1, 1, "correct")];
  expect(practiceMarks(old).get("reading")).toEqual({ mark: "correct", right: 2, of: 2 });
  const none = [text(1, "listening"), answered(2, 1, 0, "wrong"), answered(3, 1, 1, "wrong")];
  expect(practiceMarks(none).get("listening")?.mark).toBe("wrong");
});

test("a text checked and a monologue said: by the check's verdict, the first one", () => {
  const marks = practiceMarks([
    verdict(1, "writing", check("minor_errors")),
    verdict(2, "writing", check("good")),
    verdict(3, "talk", { task: { kind: "monologue" }, said: [], check: check("off_task") }),
  ]);
  expect(marks.get("writing")).toEqual({ mark: "partial" });
  expect(marks.get("speaking")).toEqual({ mark: "wrong" });
  expect(practiceMarks([verdict(1, "writing", check("good"))]).get("writing")?.mark).toBe(
    "correct",
  );
});

test("a role-play: every line fits without a correction right; some fitting partly; none wrong", () => {
  const play = (turns: Array<{ fits: boolean; corrections?: number }>) =>
    practiceMarks([
      verdict(1, "talk", {
        task: { kind: "roleplay" },
        said: [],
        check: {
          turns: turns.map((t, n) => ({
            n,
            fits: t.fits,
            corrections: Array.from({ length: t.corrections ?? 0 }, () => ({
              wrong: "a",
              right: "b",
              explanation: "",
            })),
          })),
          feedback: "",
        },
      }),
    ]).get("speaking");
  expect(play([{ fits: true }, { fits: true }])).toEqual({ mark: "correct" });
  expect(play([{ fits: true }, { fits: true, corrections: 1 }])?.mark).toBe("partial");
  expect(play([{ fits: true }, { fits: false }])).toEqual({ mark: "partial" });
  expect(play([{ fits: false }])?.mark).toBe("wrong");
});
