import { expect, test } from "bun:test";
import type { Exam, ExamItem, ExamRun } from "@sprachanker/schema";
import { fireEvent } from "@testing-library/react";
import { ExamCatalog } from "../../src/exams/catalog.tsx";
import { ExamPage } from "../../src/exams/page.tsx";
import { ExamResultView } from "../../src/exams/result.tsx";
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
    data: lists([row({ started: true, tests: 1, last: finished(2, ["lid"]) })]),
  });
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

test("an exam's page: how ready, the state asked of, the three ways in, the questions' map, the mock exams", async () => {
  const view = await renderApp(<ExamPage params={params} />, {
    path: "/exam/bamf.lid/lid/test",
    data: [
      [["exams"], [row()]],
      [["settings"], { "exam.federalState": "be" }],
      [["exam", KEY, "de-de"], pageData({ runs: [finished(1, ["lid"])] })],
    ],
  });
  expect(await view.findByRole("heading", { name: "Leben in Deutschland" })).toBeTruthy();
  // Berlin's: the two general questions and Berlin's one, of which one known.
  expect(view.getByText(/You know 1 of 3 questions/)).toBeTruthy();
  expect(view.getByText(/1 question in 60 minutes|2 questions in 60 minutes/)).toBeTruthy();
  expect(
    view.getByRole("img", { name: "Of 3 questions: 1 known, 1 wrong last time" }),
  ).toBeTruthy();
  expect(view.getByRole("button", { name: /Begin/ })).toBeTruthy();
  expect(view.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
    "/exam/bamf.lid/lid/test/catalog",
  );
  const result = view.getByRole("button", { name: /1 of 2/ });
  expect(result.textContent).toContain("Passed");
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

test("the catalogue: the questions open to the learner with their answers, narrowed by what the answers say", async () => {
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
  fireEvent.click(view.getByRole("button", { name: "Wrong last time" }));
  expect(view.getByText("1 question")).toBeTruthy();
  expect(view.getByText("Frage be-01?")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "All" }));
  fireEvent.change(view.getByRole("searchbox", { name: "Find in the questions" }), {
    target: { value: "richtig 002" },
  });
  expect(view.getByText("1 question")).toBeTruthy();
  expect(view.getByText("Frage 002?")).toBeTruthy();
});
