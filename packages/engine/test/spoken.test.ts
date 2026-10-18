// Answers said aloud checked against the source's answer as heard (synthetic phrases).
import { describe, expect, test } from "bun:test";
import type { Exercise, Outcome, TypedEvent } from "@sprachanker/schema";
import {
  answerToHear,
  checkItem,
  completes,
  exerciseMark,
  exerciseResults,
  judgedEvents,
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
    // Unlike the source's answer: maybe the learner's own — at most "almost", never wrong.
    ["Ich mag Kaffee", "partial"],
    ["Ich trinke sehr gern Tee", "partial"],
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
    // Words around the frame, another order: compared with the closest answer, "almost" at worst.
    ["Ich trinke ...", "Ich trinke Kaffee.", "Ja, ich trinke Tee.", "partial"],
    ["Ich trinke ...", "Ich trinke Kaffee.", "Am liebsten trinke ich Tee.", "partial"],
    [
      "Ich heiße ... und komme aus ...",
      "Ich heiße Nico und komme aus Spanien.",
      "Ich heiße Anna und ich komme aus Polen.",
      "partial",
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
    // Nicos Weg A1 0-3's exercise 9: the question said back, the greeting alone wrong; the answer
    // without the greeting almost.
    [
      "Guten Morgen. Danke, gut ...?",
      "Guten Morgen! Danke! Gut! Und Ihnen?",
      "Guten Morgen! Wie geht es Ihnen?",
      "wrong",
    ],
    [
      "Guten Morgen. Danke, gut ...?",
      "Guten Morgen! Danke! Gut! Und Ihnen?",
      "Guten Morgen",
      "wrong",
    ],
    [
      "Guten Morgen. Danke, gut ...?",
      "Guten Morgen! Danke! Gut! Und Ihnen?",
      "Danke, gut. Und Ihnen?",
      "partial",
    ],
    [
      "Guten Morgen. Danke, gut ...?",
      "Guten Morgen! Danke! Gut! Und Ihnen?",
      "Guten Morgen, danke, sehr gut, und Ihnen?",
      "partial",
    ],
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
  test('a frame of gaps only is none: the source\'s answer as heard, unlike it "almost"', () => {
    const target = spokenAnswers(
      "de",
      { reference: ["(seit – zwei Monate)"] },
      "Seit zwei Monaten.",
    );
    expect(target).toMatchObject({ answers: ["Seit zwei Monaten."], frames: [] });
    if (!target) return;
    expect(judgeSpoken("de", target, "Seit zwei Monaten").verdict).toBe("correct");
    expect(judgeSpoken("de", target, "Ich weiß nicht").verdict).toBe("partial");
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
  test("the AI checks by itself only what nothing here can check", () => {
    // The source's answer heard: the engine judges every answer, the AI only on "Why?".
    const said = { transcript: "Ich mag Kaffee" };
    expect(checkItem(exercise, 1, said, "de", heard).spoken).toBe("partial");
    expect(spokenFreely(exercise, 1, said, "de", heard)).toBeUndefined();
    const own = { transcript: "Guten Abend. Danke, sehr gut. Und Ihnen?" };
    expect(checkItem(exercise, 0, own, "de", heard).spoken).toBe("partial");
    expect(spokenFreely(exercise, 0, own, "de", heard)).toBeUndefined();
    // A line to say: never the AI's.
    expect(spokenFreely(exercise, 2, { transcript: "Bis morgen" }, "de")).toBeUndefined();
    // Nothing heard of the source's answer (a frame alone, nothing at all): the AI's.
    expect(spokenFreely(exercise, 0, own, "de")).toBe(own.transcript);
    expect(spokenFreely(exercise, 1, said, "de")).toBe("Ich mag Kaffee");
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
  test("the model's check marks what the engine could not judge", () => {
    const k2 = "s.x/c/00-01/ex-02#2";
    const answer = said("Ich mag Kaffee");
    const events = [
      // The source's answer not heard: nothing for the engine to judge it by.
      answered(k2, answer, checkItem(exercise, 1, answer, "de")),
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

describe("answers said aloud kept from before the engine judged them", () => {
  // As the owner's profile kept them (Nicos Weg A1, 2026-10-16/17): `unscored` with a word diff of the
  // line to say, or nothing, and what was heard — no `spoken`.
  const lines = {
    key: "s.x/c/00-03/ex-06",
    type: "speech_selfrate",
    fingerprint: "0".repeat(64),
    newWords: [],
    ruleIds: [],
    items: [
      { key: "s.x/c/00-03/ex-06#1", text: "Auf Wiedersehen!" },
      { key: "s.x/c/00-03/ex-06#2", text: "Mach’s gut!" },
    ],
  } as unknown as Exercise;
  const framed = {
    ...lines,
    key: "s.x/c/00-03/ex-09",
    items: [
      {
        key: "s.x/c/00-03/ex-09#1",
        prompt: "Guten Morgen. Wie geht es Ihnen?",
        reference: ["Guten Morgen. Danke, gut ...?"],
        answerAudio: "media/audio/answer-9.mp3",
      },
    ],
  } as unknown as Exercise;
  const lesson = { pages: [{ exercise: lines }, { exercise: framed }] } as never;
  const sourceHeard = { "media/audio/answer-9.mp3": "Guten Morgen! Danke! Gut! Und Ihnen?" };
  let n = 0;
  const kept = (itemKey: string, transcript: string, outcome: object): TypedEvent =>
    ({
      id: `k${++n}`,
      runId: "r",
      type: "answered",
      itemKey,
      ts: n,
      payload: {
        answer: { recording: `rec${n}`, transcript },
        attempt: 1,
        ms: 1000,
        outcome: { result: "unscored", score: 0, ...outcome },
      },
    }) as unknown as TypedEvent;
  const said = [
    kept("s.x/c/00-03/ex-06#1", "Auf Wiedersehen.", {
      diff: [
        { op: "equal", expected: "Auf", actual: "Auf" },
        { op: "equal", expected: "Wiedersehen!", actual: "Wiedersehen." },
      ],
    }),
    kept("s.x/c/00-03/ex-06#2", "Mach's gut!", {
      diff: [
        { op: "equal", expected: "Mach's", actual: "Mach's" },
        { op: "equal", expected: "gut!", actual: "gut!" },
      ],
    }),
  ];

  test("read as kept, nothing marks them: the exercise only done", () => {
    expect(exerciseMark(lines, exerciseResults(said)[lines.key])).toBe("done");
  });
  test("judged as they are read, by the check a new answer gets: marked", () => {
    const judged = judgedEvents(said, { lang: "de", lesson });
    expect(exerciseMark(lines, exerciseResults(judged)[lines.key])).toBe("correct");
    expect(exerciseResults(judged)[lines.key]?.last["s.x/c/00-03/ex-06#1"]?.outcome).toEqual(
      checkItem(lines, 0, { recording: "rec1", transcript: "Auf Wiedersehen." }, "de"),
    );
    // A line said wrong first: a mistake, its words against the line.
    const wrong = judgedEvents(
      [said[0] as TypedEvent, kept("s.x/c/00-03/ex-06#2", "Macht gut!", {})],
      { lang: "de", lesson },
    );
    expect(exerciseMark(lines, exerciseResults(wrong)[lines.key])).toBe("partial");
    const [mistake] = mistakesOf([{ events: wrong }]);
    expect([mistake?.itemKey as string, mistake?.result, !!mistake?.diff]).toEqual([
      "s.x/c/00-03/ex-06#2",
      "wrong",
      true,
    ]);
  });
  test("a frame, by the source's answer as heard: the question said back wrong, no AI", () => {
    const back = kept("s.x/c/00-03/ex-09#1", "Guten Morgen! Wie geht es Ihnen?", {});
    const [judged] = judgedEvents([back], { lang: "de", heard: sourceHeard, lesson });
    expect(judged?.type === "answered" && judged.payload.outcome.spoken).toBe("wrong");
    const answer = { transcript: "Guten Morgen! Danke! Gut! Und Ihnen?" };
    expect(spokenFreely(framed, 0, answer, "de", sourceHeard)).toBeUndefined();
    expect(checkItem(framed, 0, answer, "de", sourceHeard).spoken).toBe("correct");
    // The source's answer not heard yet: as kept, nothing to judge it by.
    expect(judgedEvents([back], { lang: "de", lesson })[0]).toBe(back);
  });
  test("the exercise as the run showed it, before the lesson as it is now", () => {
    const shown = {
      id: "p",
      runId: "r",
      type: "page_shown",
      itemKey: null,
      ts: 0,
      payload: { pageIndex: 0, exerciseKey: lines.key, snapshot: { exercise: lines } },
    } as unknown as TypedEvent;
    const changed = { pages: [{ exercise: { ...lines, items: [{ text: "Hallo!" }] } }] } as never;
    const judged = judgedEvents([shown, ...said], { lang: "de", lesson: changed });
    expect(exerciseMark(lines, exerciseResults(judged)[lines.key])).toBe("correct");
  });
});
