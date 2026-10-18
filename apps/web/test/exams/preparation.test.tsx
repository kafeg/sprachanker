// A module's preparation before its Teile: each Teil's task and cards with a field for notes, its
// time; the notes kept as a field is left, Begin with them; once over it says so; a Teil's notes
// shown with it while speaking.
import { expect, test } from "bun:test";
import type { ExamItem, LocaleExam } from "@sprachanker/schema";
import { fireEvent } from "@testing-library/react";
import { Preparation, TeilNotes } from "../../src/exams/preparation.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const item = (n: number) =>
  ({
    key: `x/b1/exam-m/q-sprechen-${n}`,
    type: "respond",
    tags: {},
    input: "speech",
    reference: [],
  }) as unknown as ExamItem;
const section = (n: number) => ({
  key: `x/b1/exam-m/s-sprechen-${n}`,
  module: "sprechen",
  pool: [item(n).key],
  draw: 1,
  filter: null,
  ...(n === 2 && { letters: [{ letter: "1", text: "Folie 1. Brauchen Kinder Handys?" }] }),
});
const locale = {
  sections: {
    [section(1).key]: { title: "Aufgabe 1", instructions: "Planen Sie einen Besuch." },
    [section(2).key]: { title: "Aufgabe 2", instructions: "Präsentieren Sie ein Thema." },
  },
} as unknown as LocaleExam;

const prepare = (props: { left?: number }, kept: unknown[], begun: unknown[]) =>
  renderApp(
    <TargetLang value="de">
      <Preparation
        module="sprechen"
        title="Sprechen"
        teile={[1, 2].map((n) => ({ item: item(n), section: section(n) as never }))}
        locale={locale}
        notes={{}}
        {...(props.left !== undefined && { left: props.left })}
        minutes={15}
        url={(p) => p}
        onNotes={(n) => kept.push(n)}
        onBegin={(n) => begun.push(n)}
      />
    </TargetLang>,
  );

test("the preparation: each Teil's task and cards, notes kept as a field is left, Begin with them", async () => {
  const kept: unknown[] = [];
  const begun: unknown[] = [];
  const v = await prepare({ left: 600_000 }, kept, begun);
  expect(v.getByText("Preparation: Sprechen")).toBeTruthy();
  expect(v.getByText(/You have 15 minutes to prepare the parts/)).toBeTruthy();
  expect(v.getByRole("timer").textContent).toContain("10:00 left to prepare");
  expect(v.getByText("Planen Sie einen Besuch.")).toBeTruthy();
  expect(v.getByText("Folie 1. Brauchen Kinder Handys?")).toBeTruthy();
  const fields = v.getAllByRole("textbox");
  expect(fields).toHaveLength(2);
  fireEvent.change(fields[0] as HTMLElement, { target: { value: "Mittwoch, 17 Uhr" } });
  fireEvent.blur(fields[0] as HTMLElement);
  expect(kept).toEqual([{ [item(1).key]: "Mittwoch, 17 Uhr" }]);
  fireEvent.click(v.getByRole("button", { name: "Begin the parts" }));
  expect(begun).toEqual([{ [item(1).key]: "Mittwoch, 17 Uhr" }]);
  v.unmount();
  // Over: said so.
  const over = await prepare({}, [], []);
  expect(over.getByText("The time to prepare is over.")).toBeTruthy();
  over.unmount();
});

test("a Teil's notes shown while speaking; none, nothing shown", async () => {
  const v = await renderApp(
    <TargetLang value="de">
      <TeilNotes text="Mittwoch, 17 Uhr" />
      <TeilNotes text="  " />
    </TargetLang>,
  );
  expect(v.getByText("Your notes from the preparation")).toBeTruthy();
  expect(v.getAllByText("Your notes from the preparation")).toHaveLength(1);
  expect(v.getByText("Mittwoch, 17 Uhr")).toBeTruthy();
  v.unmount();
});
