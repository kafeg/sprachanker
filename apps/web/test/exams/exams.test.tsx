import { expect, test } from "bun:test";
import type { Exam, ExamItem, ExamRun } from "@sprachanker/schema";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ExamCatalog } from "../../src/exams/catalog.tsx";
import { ExamPage } from "../../src/exams/page.tsx";
import { OpenAnswerRating } from "../../src/exams/rating.tsx";
import { ExamResultView } from "../../src/exams/result.tsx";
import { ExamNotebook } from "../../src/notebook/exam.tsx";
import { ExamsPage } from "../../src/routes/exams.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const KEY = "bamf.lid/lid/exam-test";
const params = { series: "bamf.lid", course: "lid", exam: "test" };
const q = (id: string, state: string | null, right = "a"): ExamItem =>
  ({
    key: `${KEY}/q-${id}`,
    type: "single_choice",
    tags: { federalState: state },
    prompt: `Frage ${id}?`,
    options: [
      { id: "a", text: `richtig ${id}` },
      { id: "b", text: `falsch ${id}` },
    ],
    answer: { optionIds: [right] },
  }) as unknown as ExamItem;
const items = [q("001", null), q("002", null), q("be-01", "be"), q("by-01", "by")];
const exam = {
  format: 1,
  key: KEY,
  timeLimitSec: 3600,
  sections: [
    { key: `${KEY}/s-general`, pool: [items[0]?.key, items[1]?.key], draw: 1, filter: null },
    {
      key: `${KEY}/s-state`,
      pool: [items[2]?.key, items[3]?.key],
      draw: 1,
      filter: { tag: "federalState", setting: "exam.federalState" },
    },
  ],
  items,
  thresholds: [{ id: "lid", minPoints: 1 }],
} as unknown as Exam;
const locale = {
  format: 1,
  edition: "de-de",
  exam: KEY,
  title: "Leben in Deutschland",
  sections: { [`${KEY}/s-general`]: { title: "Allgemein" }, [`${KEY}/s-state`]: { title: "Land" } },
  thresholds: { lid: { title: "Test bestanden" } },
  items: {},
};
const finished = (points: number, passed: string[]): ExamRun =>
  ({
    id: "01JAAAAAAAAAAAAAAAAAAAAAAA",
    exam: KEY,
    edition: "de-de",
    status: "finished",
    endReason: "completed",
    startedAt: 1,
    finishedAt: 2,
    plan: {
      mode: "test",
      items: [items[0]?.key, items[2]?.key],
      deadline: 10,
      snapshot: [items[0], items[2]],
    },
    result: { points, max: 2, answered: 2, sections: {}, passed },
  }) as unknown as ExamRun;
const row = (extra: object = {}) => ({
  key: KEY,
  series: "bamf.lid",
  course: "lid",
  kind: "exam",
  editions: ["de-de"],
  titles: { "de-de": "Leben in Deutschland" },
  courseTitles: { "de-de": "Leben in Deutschland" },
  source: { publisher: "BAMF", url: "https://www.bamf.de/", licence: "free-access" },
  questions: 4,
  asked: 2,
  timeLimitSec: 3600,
  readiness: 0.5,
  needs: [],
  active: null,
  last: null,
  best: null,
  tests: 0,
  started: false,
  ...extra,
});
const lists = (rows: object[], offers: object[] = []): Array<[unknown[], unknown]> => [
  [["exams"], rows],
  [["catalog"], offers],
];

test("Exams in tabs as Courses: begun ones, downloaded with how ready and the last mock exam, those to download", async () => {
  const mine = await renderApp(<ExamsPage tab="mine" />, { path: "/exams", data: lists([row()]) });
  expect(mine.getByText("You haven't begun an exam yet.")).toBeTruthy();
  expect(mine.getByRole("link", { name: /Downloaded\s*1/ })).toBeTruthy();

  const view = await renderApp(<ExamsPage tab="downloaded" />, {
    path: "/exams/downloaded",
    data: [
      ...lists([row({ started: true, tests: 1, last: finished(2, ["lid"]) })]),
      [["downloads"], { available: true, jobs: [] }],
    ],
  });
  // Its course's check, sync and export, as a downloaded course's; an exam's file to import.
  expect(view.getByRole("button", { name: "Check" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Export to a file" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Import from a file…" })).toBeTruthy();
  expect(view.getByText("last: 2 of 2")).toBeTruthy();
  expect(view.getByText("You know 50% of the questions")).toBeTruthy();
  expect(view.getByText(/Last mock exam .*: passed/).className).toContain("text-correct");
  expect(view.getByRole("link", { name: /Mock exam/ }).getAttribute("href")).toBe(
    "/exam/bamf.lid/lid/test?start=test",
  );
  expect(view.getByRole("link", { name: /Practice/ }).getAttribute("href")).toBe(
    "/exam/bamf.lid/lid/test?start=practice",
  );

  const offered = await renderApp(<ExamsPage tab="available" />, {
    path: "/exams/catalog",
    data: [
      ...lists([]),
      [["downloads"], { available: true, jobs: [] }],
      [
        ["catalog"],
        [
          {
            series: "bamf.lid",
            course: "lid",
            key: "bamf.lid/lid",
            edition: "de-de",
            kind: "exam",
            title: "Leben in Deutschland",
            source: { publisher: "BAMF", url: "https://www.bamf.de/", licence: "free-access" },
            approxBytes: 6e7,
            installed: false,
            state: "available",
          },
        ],
      ],
    ],
  });
  expect(offered.getByRole("heading", { name: "Leben in Deutschland" })).toBeTruthy();
  expect(offered.getByRole("button", { name: /Download/ })).toBeTruthy();
});

const pageData = (extra: object = {}) => ({
  exam,
  locale,
  readiness: 0.5,
  needs: [],
  stats: {
    [`${KEY}/q-001`]: { last: "right", right: 1, wrong: 0 },
    [`${KEY}/q-be-01`]: { last: "wrong", right: 0, wrong: 1 },
  },
  active: null,
  last: null,
  best: null,
  runs: [],
  ...extra,
});

test("an exam's page: how ready, the state asked of, the three ways in, the latest mock exam and the way to the Notebook", async () => {
  const view = await renderApp(<ExamPage params={params} />, {
    path: "/exam/bamf.lid/lid/test",
    data: [
      [["exams"], [row()]],
      [["settings"], { "exam.federalState": "be" }],
      [
        ["exam", KEY, "de-de"],
        pageData({ last: finished(1, ["lid"]), runs: [finished(1, ["lid"])] }),
      ],
    ],
  });
  expect(await view.findByRole("heading", { name: "Leben in Deutschland" })).toBeTruthy();
  expect(view.getByText(/1 question in 60 minutes|2 questions in 60 minutes/)).toBeTruthy();
  expect(view.getByRole("button", { name: /Begin/ })).toBeTruthy();
  expect(view.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
    "/exam/bamf.lid/lid/test/catalog",
  );
  // No statistics here: the latest result, the rest in the Notebook.
  expect(view.queryByRole("img", { name: /known/ })).toBeNull();
  expect(
    view.getByRole("button", { name: /Last mock exam, .*: 1 of 2\s*All in the Notebook/ }),
  ).toBeTruthy();
});

test("an exam in the Notebook: its runs, the map of its questions, those answered wrongly last time", async () => {
  const view = await renderApp(<ExamNotebook params={params} />, {
    path: "/notebook/exam/bamf.lid/lid/test",
    data: [
      [
        ["notebook", "exam", KEY],
        {
          entry: {
            key: KEY,
            title: "Leben in Deutschland",
            lastAt: 2,
            open: false,
            runCount: 1,
            figures: [],
            runs: [
              {
                id: "01JAAAAAAAAAAAAAAAAAAAAAAA",
                edition: "de-de",
                status: "finished",
                endReason: "completed",
                startedAt: 1,
                finishedAt: 2,
                mode: "test",
                points: 1,
                max: 2,
                passed: true,
              },
            ],
          },
          // Berlin's: the two general questions and Berlin's one, of which one known, one wrong.
          items: [
            { key: `${KEY}/q-001`, state: "right", line: "Frage 001?" },
            { key: `${KEY}/q-002`, state: "unseen", line: "Frage 002?" },
            { key: `${KEY}/q-be-01`, state: "wrong", line: "Frage be-01?" },
          ],
          lang: "de",
        },
      ],
    ],
  });
  expect(await view.findByRole("heading", { name: "Leben in Deutschland" })).toBeTruthy();
  expect(view.getByRole("button", { name: /Mock exam\s*1 of 2\s*Passed/ })).toBeTruthy();
  expect(view.getByText(/You know 1 of 3 questions/)).toBeTruthy();
  expect(
    view.getByRole("img", { name: "Of 3 questions: 1 known, 1 wrong last time" }),
  ).toBeTruthy();
  expect(view.getByText("1 question answered wrongly last time")).toBeTruthy();
  expect(view.getByText("Frage be-01?")).toBeTruthy();
});

test("a language exam in the Notebook: questions by their Teil and number, never by their keys", async () => {
  const view = await renderApp(<ExamNotebook params={gParams} />, {
    path: "/notebook/exam/goethe.zertifikat/a1/modellsatz",
    data: [
      [
        ["notebook", "exam", GKEY],
        {
          entry: {
            key: GKEY,
            title: "Goethe-Zertifikat A1",
            lastAt: 2,
            open: false,
            runCount: 0,
            figures: [],
            runs: [],
          },
          items: [
            { key: `${GKEY}/q-hoeren-2`, state: "wrong", line: "Wann?", group: "Hören · Teil 1" },
            { key: `${GKEY}/q-hoeren-3`, state: "wrong", line: "Wo?", group: "Hören · Teil 1" },
            {
              key: `${GKEY}/q-schreiben-1-3`,
              state: "wrong",
              line: "Ort: …",
              group: "Schreiben · Teil 1",
            },
          ],
          lang: "de",
        },
      ],
    ],
  });
  expect(await view.findByText("Hören · Teil 1")).toBeTruthy();
  expect(view.getAllByText("Hören · Teil 1")).toHaveLength(1);
  expect(view.getByText("Schreiben · Teil 1")).toBeTruthy();
  expect(view.getByText("Ort: …").previousElementSibling?.textContent).toBe("1-3");
  expect(view.container.textContent).not.toContain("hoeren-2");
  expect(view.container.querySelector('[title="Hören · Teil 1 · 2"]')).toBeTruthy();
});

test("an exam asked of the learner's state cannot begin before it is chosen", async () => {
  const view = await renderApp(<ExamPage params={params} />, {
    path: "/exam/bamf.lid/lid/test",
    data: [
      [["exams"], [row({ needs: ["exam.federalState"] })]],
      [["exam", KEY, "de-de"], pageData({ needs: ["exam.federalState"] })],
    ],
  });
  expect(
    await view.findByText("Choose your federal state: the test asks three questions about it."),
  ).toBeTruthy();
  expect((view.getByRole("button", { name: /Begin/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(view.getByRole("combobox", { name: "Federal state" })).toBeTruthy();
});

test("a result: passed or not by each pass mark, the mistakes with their right answers, all on request", async () => {
  const run = finished(1, ["lid"]);
  const events = [
    {
      id: "e1",
      runId: run.id,
      ts: 1,
      type: "answered",
      itemKey: items[0]?.key,
      cardId: null,
      payload: {
        answer: { optionId: "a" },
        attempt: 1,
        ms: 1,
        outcome: { result: "correct", score: 1, ruleIds: [], lexemes: [] },
      },
    },
    {
      id: "e2",
      runId: run.id,
      ts: 2,
      type: "answered",
      itemKey: items[2]?.key,
      cardId: null,
      payload: {
        answer: { optionId: "b" },
        attempt: 1,
        ms: 1,
        outcome: { result: "wrong", score: 0, ruleIds: [], lexemes: [] },
      },
    },
  ];
  const view = await renderApp(
    <TargetLang value="de">
      <ExamResultView
        title="Leben in Deutschland"
        params={params}
        run={run}
        exam={exam}
        locale={locale as never}
        items={[items[0] as ExamItem, items[2] as ExamItem]}
        events={events as never}
        onLeave={() => {}}
      />
    </TargetLang>,
    { path: "/exam/run" },
  );
  expect(view.getByRole("heading", { name: "Passed" })).toBeTruthy();
  expect(view.getByText("Test bestanden")).toBeTruthy();
  expect(view.getByRole("heading", { name: "1 mistake" })).toBeTruthy();
  // Only the wrong one, with the right answer shown.
  expect(view.queryByText("Frage 001?")).toBeNull();
  expect(view.getByText("Frage be-01?")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Show all answers" }));
  expect(view.getByText("Frage 001?")).toBeTruthy();
  expect(view.getByRole("button", { name: "Practise the mistakes" })).toBeTruthy();
});

test("an open answer rated: a criterion that voids the answer, not rated yet, is told as what keeps it at 0", async () => {
  const item = {
    key: `${KEY}/q-w1`,
    type: "respond",
    criteria: [
      { id: "task", levels: [0, 1, 2], voids: true },
      { id: "form", levels: [0, 1] },
    ],
  } as unknown as ExamItem & { criteria: NonNullable<ExamItem["criteria"]> };
  const view = await renderApp(
    <OpenAnswerRating
      runId="R"
      item={item}
      locale={{ criteria: { task: { title: "Erfüllung" } } } as never}
      events={[]}
      answer="Hallo"
    />,
    { path: "/exam/run" },
  );
  const level = (name: string, points: string) =>
    within(view.getByRole("group", { name })).getByRole("button", { name: points });
  fireEvent.click(level("form", "1"));
  expect(view.getByText(/0 until “Erfüllung” is rated/)).toBeTruthy();
  fireEvent.click(level("Erfüllung", "0"));
  expect(view.getByText("the task not done: 0 for the whole answer")).toBeTruthy();
  fireEvent.click(level("Erfüllung", "2"));
  expect(view.getByText("3 of 3")).toBeTruthy();
  expect(view.queryByText(/is rated|not done/)).toBeNull();
});

test("the AI's proposal after one's own rating: not counted until accepted — accept it or keep one's own", async () => {
  const item = {
    key: `${KEY}/q-w1`,
    type: "respond",
    criteria: [
      { id: "task", levels: [0, 1, 2], voids: true },
      { id: "form", levels: [0, 1] },
    ],
  } as unknown as ExamItem & { criteria: NonNullable<ExamItem["criteria"]> };
  const event = (n: number, type: string, payload: unknown) => ({
    id: `E${n}`,
    runId: "R",
    ts: n,
    type,
    itemKey: item.key,
    payload,
  });
  const events = [
    event(1, "exam_rated", { ratings: { task: 2, form: 0 }, by: "self" }),
    event(2, "llm_verdict", {
      task: "exam",
      input: "Hallo",
      result: {
        criteria: [
          { id: "task", points: 1, reason: "Teilweise." },
          { id: "form", points: 1, reason: "Gruß da." },
        ],
        feedback: "Mehr Details.",
      },
      model: "m",
      latencyMs: 1,
    }),
  ];
  const sent: unknown[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    sent.push(await request.json());
    return Response.json({ run: {}, events: [] });
  }) as typeof fetch;
  try {
    const view = await renderApp(
      <OpenAnswerRating runId="R" item={item} events={events as never} answer="Hallo" />,
      { path: "/exam/run" },
    );
    expect(view.getByText("Not accepted yet: the result counts 2 of 3.")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ ratings: { task: 2, form: 0 }, by: "self" });
    fireEvent.click(view.getByRole("button", { name: "Accept the proposal" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ ratings: { task: 1, form: 1 }, by: "assistant", model: "m" });
  } finally {
    globalThis.fetch = real;
  }
});

test("the catalogue: the questions open to the learner as a list, one opened with its answer, found by words", async () => {
  const view = await renderApp(<ExamCatalog params={params} />, {
    path: "/exam/bamf.lid/lid/test/catalog",
    data: [
      [["exams"], [row()]],
      [["settings"], { "exam.federalState": "be" }],
      [["exam", KEY, "de-de"], pageData()],
    ],
  });
  expect(await view.findByText("Frage 001?")).toBeTruthy();
  // Not Bavaria's.
  expect(view.queryByText("Frage by-01?")).toBeNull();
  expect(view.getByText("3 questions")).toBeTruthy();
  // Closed, a question shows only what it asks; opened, its options with the right one marked.
  expect(view.queryByText("richtig 001")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /Frage 001\?/ }));
  expect(view.getByText("richtig 001")).toBeTruthy();
  expect(view.getAllByRole("status").some((s) => s.textContent === "Correct")).toBe(true);
  fireEvent.change(view.getByRole("searchbox", { name: "Find in the questions" }), {
    target: { value: "richtig 002" },
  });
  expect(view.getByText("1 question")).toBeTruthy();
  expect(view.getByText("Frage 002?")).toBeTruthy();
});

// A language exam: Lesen with a Teil's text and example, Schreiben with a typed form; passed only
// with both pass marks.
const GKEY = "goethe.a1/a1/exam-modell";
const gq = (id: string, extra: object) => ({ key: `${GKEY}/q-${id}`, tags: {}, ...extra });
const gItems = [
  gq("l0", {
    type: "single_choice",
    prompt: "Beispiel: Wer schreibt?",
    options: [
      { id: "a", text: "Tom" },
      { id: "b", text: "Eva" },
    ],
    answer: { optionIds: ["a"] },
  }),
  gq("l1", {
    type: "single_choice",
    prompt: "Tom kommt am Montag.",
    options: [
      { id: "a", text: "Richtig" },
      { id: "b", text: "Falsch" },
    ],
    answer: { optionIds: ["b"] },
  }),
  gq("s1", {
    type: "gap_text",
    segments: ["Name: ", { gap: "g1" }],
    answer: { g1: { accepted: ["Tom Weber"] } },
  }),
] as unknown as ExamItem[];
const gExam = {
  format: 1,
  key: GKEY,
  timeLimitSec: 240,
  modules: [
    { id: "lesen", timeLimitSec: 180, scaleTo: 25 },
    { id: "schreiben", timeLimitSec: 60, scaleTo: 25 },
  ],
  sections: [
    {
      key: `${GKEY}/s-l1`,
      module: "lesen",
      pool: [`${GKEY}/q-l1`],
      draw: 1,
      filter: null,
      text: "Liebe Lena,\n\nich komme am Sonntag.",
      examples: [`${GKEY}/q-l0`],
    },
    { key: `${GKEY}/s-s1`, module: "schreiben", pool: [`${GKEY}/q-s1`], draw: 1, filter: null },
  ],
  items: gItems,
  thresholds: [
    { id: "pass", minPoints: 30 },
    { id: "written", minPoints: 10, modules: ["schreiben"] },
  ],
  passWhen: "all",
} as unknown as Exam;
const gLocale = {
  format: 1,
  edition: "de-de",
  exam: GKEY,
  title: "Goethe-Zertifikat A1",
  modules: { lesen: { title: "Lesen" }, schreiben: { title: "Schreiben" } },
  sections: {
    [`${GKEY}/s-l1`]: { title: "Teil 1", instructions: "Lies den Text." },
    [`${GKEY}/s-s1`]: { title: "Teil 1", instructions: "Füll das Formular aus." },
  },
  thresholds: { pass: { title: "Bestanden" }, written: { title: "Schreiben: mindestens 10" } },
  items: {},
};
const gParams = { series: "goethe.a1", course: "a1", exam: "modell" };

test("a language exam's catalogue: its Teile named, a question opened with its Teil's text and example", async () => {
  const view = await renderApp(<ExamCatalog params={gParams} />, {
    path: "/exam/goethe.a1/a1/modell/catalog",
    data: [
      [
        ["exams"],
        [
          row({
            key: GKEY,
            series: "goethe.a1",
            course: "a1",
            titles: { "de-de": "Goethe-Zertifikat A1" },
          }),
        ],
      ],
      [["exam", GKEY, "de-de"], pageData({ exam: gExam, locale: gLocale, stats: {} })],
    ],
  });
  expect(await view.findByText("Lesen · Teil 1")).toBeTruthy();
  expect(view.getByText("Schreiben · Teil 1")).toBeTruthy();
  // The example is no question of the catalogue's: two questions.
  expect(view.getByText("2 questions")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: /Tom kommt am Montag/ }));
  expect(view.getByText("Lies den Text.")).toBeTruthy();
  expect(view.getByText("ich komme am Sonntag.")).toBeTruthy();
  expect(view.getByText("Example")).toBeTruthy();
});

test("a language exam's result: points by module as scaled, every pass mark needed", async () => {
  const run = {
    ...finished(1, []),
    exam: GKEY,
    plan: { mode: "test", items: [`${GKEY}/q-l1`, `${GKEY}/q-s1`], sections: {}, deadline: 10 },
    result: {
      points: 1,
      max: 2,
      answered: 2,
      sections: {},
      modules: {
        lesen: { points: 1, max: 1, scaled: 25 },
        schreiben: { points: 0, max: 1, scaled: 0 },
      },
      score: { points: 25, max: 50 },
      passed: [],
      pass: false,
    },
  } as unknown as ExamRun;
  const view = await renderApp(
    <TargetLang value="de">
      <ExamResultView
        title="Goethe-Zertifikat A1"
        params={gParams}
        run={run}
        exam={gExam}
        locale={gLocale as never}
        items={[gItems[1], gItems[2]] as ExamItem[]}
        events={[]}
        onLeave={() => {}}
      />
    </TargetLang>,
    { path: "/exam/run" },
  );
  expect(view.getByRole("heading", { name: "Not passed" })).toBeTruthy();
  // One scale: the result as its pass marks count it, the ring its share; the tasks' points as detail.
  expect(view.getByText("25 of 50")).toBeTruthy();
  expect(view.getByRole("img", { name: "50%" })).toBeTruthy();
  expect(view.getByText("Lesen").parentElement?.textContent).toContain("25 of 25");
  expect(view.getByText("Lesen").parentElement?.textContent).toContain("tasks: 1 of 1");
  expect(view.getByText("Schreiben: mindestens 10").parentElement?.textContent).toContain(
    "10 of 25",
  );
  expect(view.getByText("Bestanden").parentElement?.textContent).toContain("30 of 50");
});

test("an exam's sources and checks: the documents read with their copies, every check, a question's places", async () => {
  const sources = {
    format: 1,
    exam: KEY,
    read: Date.UTC(2026, 9, 10),
    documents: [
      {
        id: "catalogue",
        title: "Gesamtfragenkatalog",
        url: "https://www.bamf.de/x.pdf",
        raw: "raw/de-de/lid/x.pdf",
        sha256: "a".repeat(64),
      },
      { id: "centre", title: "Online-Testcenter", url: "https://oet.bamf.de/" },
    ],
    checks: [
      { id: "questions-complete", passed: 4, of: 4 },
      { id: "options-agree", passed: 4, of: 4 },
    ],
    items: { [`${KEY}/q-001`]: [{ document: "catalogue", at: "Allgemeine Fragen, Aufgabe 1" }] },
  };
  const page = await renderApp(<ExamPage params={params} />, {
    path: "/exam/bamf.lid/lid/test",
    data: [
      [["exams"], [row()]],
      [["settings"], { "exam.federalState": "be" }],
      [["exam", KEY, "de-de"], pageData({ sources })],
    ],
  });
  expect(await page.findByText("Sources and checks")).toBeTruthy();
  expect(page.getByText("every check passed")).toBeTruthy();
  expect(page.getByRole("link", { name: /Gesamtfragenkatalog/ }).getAttribute("href")).toBe(
    "https://www.bamf.de/x.pdf",
  );
  expect(page.getByText(/copy kept, SHA-256 aaaaaaaaaaaaaaaa…/)).toBeTruthy();
  expect(page.getByText("Options the same word for word in both sources")).toBeTruthy();

  const catalog = await renderApp(<ExamCatalog params={params} />, {
    path: "/exam/bamf.lid/lid/test/catalog",
    data: [
      [["exams"], [row()]],
      [["settings"], { "exam.federalState": "be" }],
      [["exam", KEY, "de-de"], pageData({ sources })],
    ],
  });
  fireEvent.click(await catalog.findByRole("button", { name: /Frage 001\?/ }));
  expect(catalog.getByText(/Allgemeine Fragen, Aufgabe 1/)).toBeTruthy();
});
