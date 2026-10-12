// An exam's speaking part said from its script: the examiner's line, the learner's place with its hint
// (practice) or without (a mock exam), each line kept and the partner's next one coming; said through,
// the part is handed over once; shown again as it was; checked, each line with the script's good one.
import { expect, test } from "bun:test";
import type { ExamPart, RespondAnswer } from "@sprachanker/schema";
import { fireEvent } from "@testing-library/react";
import { ExamPartView } from "../../src/llm/exam-part.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const PART: ExamPart = {
  examiner: { gender: "f" },
  partner: { name: "Jonas", gender: "m" },
  lines: [
    { speaker: "examiner", text: "Bitte fragen Sie Ihren Partner." },
    { speaker: "learner", text: "Was machst du am Wochenende?", hint: "Ask about the weekend." },
    { speaker: "partner", text: "Ich gehe schwimmen." },
    { speaker: "learner", text: "Schön!", hint: "Say you like it." },
    { speaker: "examiner", text: "Danke." },
  ],
};
const script = {
  id: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A71",
  runId: "R",
  ts: 1,
  type: "llm_verdict",
  itemKey: "q",
  cardId: null,
  payload: { task: "exam_part", input: "", result: PART, model: "m", latencyMs: 1 },
};

const view = (
  props: { hints?: boolean; said?: RespondAnswer; checked?: boolean },
  onSaid: (a: RespondAnswer | undefined) => void = () => {},
) =>
  renderApp(
    <TargetLang value="de">
      <ExamPartView
        runId="R"
        itemKey="q"
        events={[script] as never}
        onStored={() => {}}
        onSaid={onSaid}
        hints={props.hints ?? true}
        checked={props.checked ?? false}
        {...(props.said && { said: props.said })}
      />
    </TargetLang>,
    { data: [[["llm"], { provider: "custom", model: "m" }]] },
  );

/** A line typed where nothing hears, and kept. */
const say = (v: Awaited<ReturnType<typeof view>>, text: string) => {
  fireEvent.change(v.getByPlaceholderText("Your line…"), { target: { value: text } });
  fireEvent.submit(v.getByPlaceholderText("Your line…").closest("form") as HTMLFormElement);
};

test("practice: the examiner, the learner's hint; each line kept, the partner's next; said through, handed over once", async () => {
  const given: Array<RespondAnswer | undefined> = [];
  const v = await view({}, (a) => given.push(a));
  expect(v.getByText("Bitte fragen Sie Ihren Partner.")).toBeTruthy();
  expect(v.getAllByText(/Ask about the weekend\./).length).toBeGreaterThan(0);
  expect(v.queryByText("Ich gehe schwimmen.")).toBeNull();
  say(v, "Was machst du am Wochenende?");
  expect(v.getByText("Ich gehe schwimmen.")).toBeTruthy();
  expect(given).toEqual([]);
  say(v, "Toll!");
  expect(v.getByText("Danke.")).toBeTruthy();
  expect(given).toEqual([
    {
      text: "Was machst du am Wochenende?\nToll!",
      lines: [{ transcript: "Was machst du am Wochenende?" }, { transcript: "Toll!" }],
    },
  ]);
  v.unmount();
});

test("a mock exam shows no hints; what was said shows again as it was; checked, each line with the script's good one", async () => {
  const mock = await view({ hints: false });
  expect(mock.queryByText(/Ask about the weekend\./)).toBeNull();
  mock.unmount();
  const said: RespondAnswer = {
    text: "Was machst du?\nToll!",
    lines: [{ transcript: "Was machst du?" }, { transcript: "Toll!" }],
  };
  const again = await view({ said });
  expect(again.getByText("Was machst du?")).toBeTruthy();
  expect(again.getByText("Danke.")).toBeTruthy();
  expect(again.queryByText(/A good way to say it/)).toBeNull();
  again.unmount();
  const checked = await view({ said, checked: true });
  expect(checked.getAllByText(/A good way to say it/)).toHaveLength(2);
  expect(checked.queryByPlaceholderText("Your line…")).toBeNull();
  checked.unmount();
});
