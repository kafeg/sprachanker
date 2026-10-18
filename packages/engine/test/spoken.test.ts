// Answers said aloud checked against the source's answer as heard (synthetic phrases).
import { describe, expect, test } from "bun:test";
import type { Exercise, Outcome, TypedEvent } from "@sprachanker/schema";
import {
  answerToHear,
  checkItem,
  completes,
  exerciseMark,
  exerciseResults,
  judgeSpoken,
  mistakesOf,
  sentencesOf,
  spokenAnswers,
  spokenFreely,
} from "../src/index.ts";

describe("sentencesOf", () => {
  test.each<[string, string[]]>([
    ["Hallo! Danke, gut. Und dir?", ["Hallo!", "Danke, gut.", "Und dir?"]],
    ["»Ja, ich gehe gern.« »Nein.«", ["»Ja, ich gehe gern.«", "»Nein.«"]],
    ["Ich wohne im 3. Stock", ["Ich wohne im 3.", "Stock"]],
    ["  ", []],
  ])("%j", (text, out) => expect(sentencesOf(text)).toEqual(out));
});

describe("a frame completed", () => {
  const frame = (reference: string) =>
    spokenAnswers("de", { reference: [reference] }, reference.replace(/…|\.\.\./g, "x"))?.frames;
  test("its words in order, each gap filled with a word or more, nothing else", () => {
    const [f] = frame("Morgen gehe ich … und dann …") ?? [];
    if (!f) throw new Error("no frame");
    expect(completes("de", f, "Morgen gehe ich schwimmen und dann ins Kino.")).toEqual([
      ["schwimmen"],
      ["ins", "Kino."],
    ]);
    // A gap left empty, a word of the frame missing or a word said outside a gap: not completed.
    expect(completes("de", f, "Morgen gehe ich und dann ins Kino")).toBeUndefined();
    expect(completes("de", f, "Morgen gehe schwimmen und dann ins Kino")).toBeUndefined();
    expect(completes("de", f, "Ja, morgen gehe ich schwimmen und dann ins Kino")).toBeUndefined();
  });
  test("words in brackets are a gap, side by side with an ellipsis one gap", () => {
    const [f] = frame("Nein, das ist ... (die Tasche)") ?? [];
    if (!f) throw new Error("no frame");
    expect(f).toEqual(["Nein,", "das", "ist", null]);
    expect(completes("de", f, "Nein, das ist eine Tasche.")).toEqual([["eine", "Tasche."]]);
  });
});

describe("spokenAnswers", () => {
  test("a line to say is the answer (exact); a heard recording is not needed", () => {
    expect(spokenAnswers("de", { text: "Guten Tag!" }, "anything")).toEqual({
      answers: ["Guten Tag!"],
      frames: [],
      exact: true,
    });
  });
  test("a frame: the shortest runs of the heard sentences that complete it", () => {
    const item = { reference: ["Hallo. Danke, gut …?"] };
    expect(spokenAnswers("de", item, "Hallo! Danke! Gut! Und dir?")?.answers).toEqual([
      "Hallo! Danke! Gut! Und dir?",
    ]);
    // Several answers one after the other: each its own.
    const two = { reference: ["Ja, ich … / Nein, ich …"] };
    expect(
      spokenAnswers("de", two, "Ja, ich spiele gern. Nein, ich spiele nicht gern.")?.answers,
    ).toEqual(["Ja, ich spiele gern.", "Nein, ich spiele nicht gern."]);
  });
  test("a recording that completes none of the frame is not used", () => {
    expect(spokenAnswers("de", { reference: ["Ich heiße …"] }, "Ich heiße")).toBeUndefined();
    expect(spokenAnswers("de", { reference: ["Ich heiße …"] }, "Wie heißt du?")).toBeUndefined();
    expect(spokenAnswers("de", { reference: ["Ich heiße …"] })).toBeUndefined();
  });
  test("no frame: the whole text and each sentence; a spelled word none", () => {
    expect(spokenAnswers("de", {}, "Danke. Bis bald.")).toEqual({
      answers: ["Danke. Bis bald.", "Danke.", "Bis bald."],
      frames: [],
      exact: false,
    });
    expect(spokenAnswers("de", {}, "M-A-R-A")).toBeUndefined();
  });
});

describe("judgeSpoken", () => {
  const framed = spokenAnswers(
    "de",
    { reference: ["Guten Abend. Danke, gut ...?"] },
    "Guten Abend! Danke, gut! Und Ihnen?",
  );
  const free = spokenAnswers("de", {}, "Ich trinke gern Tee.");
  if (!framed || !free) throw new Error("no answers");
  test.each<[string, string, string | undefined]>([
    ["the source's answer said", "Guten Abend. Danke, gut. Und Ihnen?", "correct"],
    ["the frame completed otherwise", "Guten Abend. Danke, gut. Wie geht es Ihnen?", "correct"],
    // The question said back: the frame's words missed.
    ["the question repeated", "Guten Abend! Wie geht es Ihnen?", "wrong"],
  ])("a frame: %s", (_, said, verdict) =>
    expect(judgeSpoken("de", framed, said).verdict).toBe(verdict as never),
  );
  test("a frame completed otherwise is right, in one's own words (a note)", () => {
    const own = judgeSpoken("de", framed, "Guten Abend. Danke, gut. Und wie geht es dir?");
    expect([own.verdict, own.ownWords]).toEqual(["correct", true]);
    expect(judgeSpoken("de", framed, "Guten Abend. Danke, gut. Und Ihnen?").ownWords).toBe(
      undefined,
    );
  });
  test.each<[string, string | undefined]>([
    ["Ich trinke gern Tee", "correct"],
    // Unlike the source's answer: maybe the learner's own — not judged (the AI's, where set up).
    ["Ich mag Kaffee", undefined],
    // A word more than the source's: not judged either, never "words missing".
    ["Ich trinke sehr gern Tee", undefined],
  ])("no frame: %j", (said, verdict) =>
    expect(judgeSpoken("de", free, said).verdict).toBe(verdict as never),
  );
});

describe("a right answer is never wrong", () => {
  const judge = (reference: string, heard: string, said: string) => {
    const target = spokenAnswers("de", { reference: [reference] }, heard);
    if (!target) throw new Error(`no answers for ${reference}`);
    return judgeSpoken("de", target, said).verdict;
  };
  test.each<[string, string, string, string | undefined]>([
    // One's own words in the gap, the other branch, a choice in brackets: right.
    ["Ich heiße ...", "Ich heiße Nico.", "Ich heiße Anna.", "correct"],
    ["Ja, ich ... / Nein, ich ...", "Ja, ich spiele gern.", "Nein, ich spiele nicht.", "correct"],
    ["Das ist (falsch/richtig).", "Das ist richtig.", "Das ist falsch.", "correct"],
    [
      "Ich mache … Urlaub.",
      "Ich mache einmal Urlaub.",
      "Ich mache zweimal im Jahr Urlaub.",
      "correct",
    ],
    // Words around the frame, another order: not judged (the AI checks).
    ["Ich trinke ...", "Ich trinke Kaffee.", "Ja, ich trinke Tee.", undefined],
    ["Ich trinke ...", "Ich trinke Kaffee.", "Am liebsten trinke ich Tee.", undefined],
    [
      "Ich heiße ... und komme aus ...",
      "Ich heiße Nico und komme aus Spanien.",
      "Ich heiße Anna und ich komme aus Polen.",
      undefined,
    ],
    // How it is written is not heard: ß and ss, "geht's", numbers in digits.
    ["Wie geht es ...?", "Wie geht es dir?", "Wie geht's dir?", "correct"],
    ["Ich heiße ...", "Ich heiße Nico.", "Ich heisse Nico.", "correct"],
    [
      "Das kostet ... Euro ...",
      "Das kostet zwei Euro fünfzig.",
      "Das kostet 2 Euro 50.",
      "correct",
    ],
    // The frame's words mostly missed: wrong.
    ["Ich heiße ...", "Ich heiße Nico.", "Wie heißt du?", "wrong"],
  ])("%j said as %j", (reference, heard, said, verdict) =>
    expect(judge(reference, heard, said)).toBe(verdict as never),
  );
  test.each<[string, string, string, string | undefined]>([
    // English as German: numbers in digits and short forms are not heard.
    ["I am ... years old.", "I am twenty-one years old.", "I'm 21 years old.", "correct"],
    ["It costs ... dollars.", "It costs five dollars.", "It costs 5 dollars.", "correct"],
    ["I don't like ...", "I do not like coffee.", "I don't like tea.", "correct"],
  ])("English: %j said as %j", (reference, heard, said, verdict) => {
    const target = spokenAnswers("en", { reference: [reference] }, heard);
    if (!target) throw new Error(`no answers for ${reference}`);
    expect(judgeSpoken("en", target, said).verdict).toBe(verdict as never);
  });
  test("a frame of gaps only is none: the source's answer as heard, unlike it not judged", () => {
    const target = spokenAnswers(
      "de",
      { reference: ["(seit – zwei Monate)"] },
      "Seit zwei Monaten.",
    );
    expect(target).toMatchObject({ answers: ["Seit zwei Monaten."], frames: [] });
    if (!target) return;
    expect(judgeSpoken("de", target, "Seit zwei Monaten").verdict).toBe("correct");
    expect(judgeSpoken("de", target, "Ich weiß nicht").verdict).toBeUndefined();
  });
  test('" / " inside brackets is the hint\'s, not two frames', () => {
    const target = spokenAnswers(
      "de",
      { reference: ["Ich trinke (Kaffee / Tee)."] },
      "Ich trinke Tee.",
    );
    expect(target?.frames).toEqual([["Ich", "trinke", null]]);
  });
  test("a recording of more sentences than an answer has is not used", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Ich heiße Nummer ${i}.`).join(" ");
    expect(spokenAnswers("de", { reference: ["Ich heiße ..."] }, long)).toBeUndefined();
  });
  test("a line with no gap beside a frame is an answer too", () => {
    const target = spokenAnswers("de", { reference: ["Nein.", "Ja, ich ..."] }, "Ja, ich komme.");
    expect(target?.answers).toEqual(["Ja, ich komme.", "Nein."]);
    if (target) expect(judgeSpoken("de", target, "Nein").verdict).toBe("correct");
  });
});

const exercise = {
  key: "s.x/c/00-01/ex-02",
  type: "speech_selfrate",
  fingerprint: "0".repeat(64),
  newWords: [],
  ruleIds: [],
  items: [
    {
      key: "s.x/c/00-01/ex-02#1",
      prompt: "Guten Abend. Wie geht es Ihnen?",
      reference: ["Guten Abend. Danke, gut ...?"],
      answerAudio: "media/audio/answer-1.mp3",
    },
    { key: "s.x/c/00-01/ex-02#2", answerAudio: "media/audio/answer-2.mp3" },
    { key: "s.x/c/00-01/ex-02#3", text: "Bis morgen!", answerAudio: "media/audio/answer-3.mp3" },
  ],
} as unknown as Exercise;
const heard = {
  "media/audio/answer-1.mp3": "Guten Abend! Danke, gut! Und Ihnen?",
  "media/audio/answer-2.mp3": "Ich trinke gern Tee.",
};

describe("checkItem with the source's answers heard", () => {
  test("what is heard of a speaking item's answer: only one without a line to say", () => {
    expect([0, 1, 2].map((i) => answerToHear(exercise, i))).toEqual([
      "media/audio/answer-1.mp3",
      "media/audio/answer-2.mp3",
      undefined,
    ]);
  });
  test("a source's answer no frame reads is not heard: spelled, choices joined by a slash", () => {
    const of = (reference: string[]) =>
      answerToHear(
        {
          ...exercise,
          items: [{ key: "k#1", reference, answerAudio: "media/audio/a.mp3" }],
        } as never,
        0,
      );
    expect(of(["E-M-M-A"])).toBeUndefined();
    expect(of(["Ich mag den Frühling/den Sommer/…"])).toBeUndefined();
    expect(of(["Das ist (falsch/richtig)."])).toBe("media/audio/a.mp3");
  });
  test("judged into `spoken`, in no score; nothing heard of the source: not judged", () => {
    const wrong = checkItem(
      exercise,
      0,
      { transcript: "Guten Abend! Wie geht es Ihnen?" },
      "de",
      heard,
    );
    expect([wrong.result, wrong.score, wrong.spoken]).toEqual(["unscored", 0, "wrong"]);
    expect(wrong.diff?.some((d) => d.op !== "equal")).toBe(true);
    expect(
      checkItem(exercise, 0, { transcript: "Guten Abend! Wie geht es Ihnen?" }, "de").spoken,
    ).toBeUndefined();
    expect(checkItem(exercise, 2, { transcript: "Bis morgen" }, "de").spoken).toBe("correct");
    expect(checkItem(exercise, 0, { recording: "r" }, "de", heard).spoken).toBeUndefined();
  });
  test("the AI checks only what the engine did not judge", () => {
    const said = { transcript: "Ich mag Kaffee" };
    const o = checkItem(exercise, 1, said, "de", heard);
    expect(spokenFreely(exercise, 1, said, o)).toBe("Ich mag Kaffee");
    const right = { transcript: "Ich trinke gern Tee" };
    expect(
      spokenFreely(exercise, 1, right, checkItem(exercise, 1, right, "de", heard)),
    ).toBeUndefined();
  });
});

describe("the mark of a spoken answer", () => {
  let n = 0;
  const answered = (itemKey: string, answer: unknown, outcome: Outcome): TypedEvent =>
    ({
      id: `e${++n}`,
      runId: "r",
      type: "answered",
      itemKey,
      ts: n,
      payload: { answer, outcome, attempt: 1, ms: 1 },
    }) as unknown as TypedEvent;
  const key = "s.x/c/00-01/ex-02#1";
  const said = (transcript: string) => ({ transcript });
  const outcome = (transcript: string) => checkItem(exercise, 0, said(transcript), "de", heard);
  test("its first attempt marks the exercise, a later one does not", () => {
    const events = [
      answered(
        key,
        said("Guten Abend! Wie geht es Ihnen?"),
        outcome("Guten Abend! Wie geht es Ihnen?"),
      ),
      answered(
        key,
        said("Guten Abend. Danke, gut. Und Ihnen?"),
        outcome("Guten Abend. Danke, gut. Und Ihnen?"),
      ),
    ];
    const r = exerciseResults(events)[exercise.key];
    expect(exerciseMark(exercise, r)).toBe("wrong");
    const [mistake] = mistakesOf([{ events }]);
    expect([mistake?.result, mistake?.fixed, !!mistake?.diff]).toEqual(["wrong", true, true]);
  });
  test("a take kept before it was heard gives way to the first one heard", () => {
    const unheard = { result: "unscored", score: 0 } as Outcome;
    const events = [
      answered(key, { recording: "r1" }, unheard),
      answered(
        key,
        { recording: "r1", ...said("Guten Abend. Danke, gut. Und Ihnen?") },
        outcome("Guten Abend. Danke, gut. Und Ihnen?"),
      ),
    ];
    expect(exerciseMark(exercise, exerciseResults(events)[exercise.key])).toBe("correct");
  });
  test("a wrong answer heard late is the mistake the step is marked by", () => {
    const unheard = { result: "unscored", score: 0 } as Outcome;
    const late = "Guten Abend! Wie geht es Ihnen?";
    const events = [
      answered(key, { recording: "r1" }, unheard),
      answered(key, { recording: "r1", ...said(late) }, outcome(late)),
    ];
    expect(exerciseMark(exercise, exerciseResults(events)[exercise.key])).toBe("wrong");
    const [mistake] = mistakesOf([{ events }]);
    expect([mistake?.result, mistake?.answer]).toEqual([
      "wrong",
      { recording: "r1", transcript: late },
    ]);
  });
  test("answers in one's own words mark the exercise right, and are no mistakes", () => {
    const own = "Guten Abend. Danke, gut. Und wie geht es dir?";
    const o = outcome(own);
    expect([o.spoken, o.ownWords]).toEqual(["correct", true]);
    const events = [answered(key, said(own), o)];
    expect(exerciseMark(exercise, exerciseResults(events)[exercise.key])).toBe("correct");
    expect(mistakesOf([{ events }])).toEqual([]);
  });
  test("the model's check marks what the engine did not judge", () => {
    const k2 = "s.x/c/00-01/ex-02#2";
    const answer = said("Ich mag Kaffee");
    const events = [
      answered(k2, answer, checkItem(exercise, 1, answer, "de", heard)),
      {
        id: "v",
        runId: "r",
        type: "llm_verdict",
        itemKey: k2,
        ts: 99,
        payload: {
          task: "speaking",
          input: "Ich mag Kaffee",
          result: { verdict: "good", corrected: "Ich mag Kaffee.", corrections: [], feedback: "" },
          model: "m",
          latencyMs: 1,
        },
      } as unknown as TypedEvent,
    ];
    expect(exerciseMark(exercise, exerciseResults(events)[exercise.key])).toBe("correct");
    // Recorded only (nothing heard): done, no mark.
    const kept = [answered(k2, { recording: "r" }, { result: "unscored", score: 0 })];
    expect(exerciseMark(exercise, exerciseResults(kept)[exercise.key])).toBe("done");
  });
});
