import { expect, test } from "bun:test";
import type { Exercise, ItemOf, Outcome } from "@sprachanker/schema";
import { EXAM_GAP_ROOM, gapRoom, gapWidth, runs, tailAfter } from "../../src/exercises/gaps.tsx";
import { ItemCard } from "../../src/exercises/item-card.tsx";
import { SourceOrder } from "../../src/exercises/shared.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

/** Text as it is, its no-break spaces kept. */
const RAW = { normalizer: (s: string) => s };

const exercise = (type: "gap_text" | "gap_choice", item: Record<string, unknown>) =>
  ({
    key: "sprachanker.test/demo/00-01/ex-05",
    type,
    fingerprint: "x",
    newWords: [],
    ruleIds: [],
    items: [{ key: "sprachanker.test/demo/00-01/ex-05#1", ...item }],
  }) as unknown as Exercise;

const card = (ex: Exercise, answer: unknown, outcome?: Outcome) =>
  renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={ex}
        locale={null}
        index={0}
        answer={answer}
        outcome={outcome}
        url={(p) => p}
        onAnswer={() => undefined}
      />
    </TargetLang>,
  );

const gapItem = (...answers: string[][]) =>
  ({
    answer: Object.fromEntries(answers.map((accepted, i) => [`g${i + 1}`, { accepted }])),
  }) as unknown as ItemOf<"gap_text">;

test("every typed gap of an exercise has one room — its longest answer, rounded up — and grows with typing", () => {
  // Short answers say nothing apart: "du" and "ich", "wo" and "wie" have the floor alike.
  expect(gapRoom([gapItem(["du"], ["ich"])])).toBe(8);
  expect(gapRoom([gapItem(["wo"]), gapItem(["wie"])])).toBe(8);
  // The longest answer of any gap of any item sets it for all.
  expect(gapRoom([gapItem(["ja"]), gapItem(["Touristeninformation"])])).toBe(24);
  expect(gapWidth(8)).toBe(8);
  expect(gapWidth(8, "Ich weiß es nicht")).toBe(19);
});

test("two gaps with answers of different length are fields of one width; an exam's are all alike", async () => {
  const ex = exercise("gap_text", {
    segments: [{ gap: "g1" }, " wohnst in Köln, ", { gap: "g2" }, " wohne in Bonn."],
    answer: { g1: { accepted: ["Du"] }, g2: { accepted: ["Ich"] } },
  });
  const view = await card(ex, {});
  const widths = view.getAllByRole("textbox").map((f) => (f as HTMLInputElement).style.width);
  expect(widths).toEqual(["calc(8ch + 1.25rem)", "calc(8ch + 1.25rem)"]);
  view.unmount();
  const inExam = await renderApp(
    <SourceOrder.Provider value>
      <TargetLang value="de">
        <ItemCard
          exercise={typed}
          locale={null}
          index={0}
          answer={{}}
          url={(p) => p}
          onAnswer={() => undefined}
        />
      </TargetLang>
    </SourceOrder.Provider>,
  );
  expect((inExam.getByRole("textbox") as HTMLInputElement).style.width).toBe(
    `calc(${EXAM_GAP_ROOM}ch + 1.25rem)`,
  );
});

test("an ellipsis after a space stays apart; a 's after a gap goes with it", async () => {
  const ex = exercise("gap_text", {
    segments: ["Das ist ", { gap: "g1" }, "’s Auto, ", { gap: "g2" }, " …und weiter."],
    answer: { g1: { accepted: ["Nico"] }, g2: { accepted: ["ja"] } },
  });
  const view = await card(ex, { g1: "Tom", g2: "nein" }, {
    result: "wrong",
    score: 0,
    parts: { g1: false, g2: false },
  } as Outcome);
  expect(view.getByText("→ Nico", RAW).parentElement?.nextSibling?.textContent).toBe("’s");
  expect(view.getByText(/Auto/).textContent).toBe(" Auto, ");
  expect(view.getByText(/und weiter/).textContent).toBe(" …und weiter.");
});

const typed = exercise("gap_text", {
  segments: ["Das ist ", { gap: "g1" }, ". Er wohnt hier."],
  answer: { g1: { accepted: ["die Touristeninformation"] } },
});

test("a checked typed gap shows the answer given as text, the right one and the full stop with it", async () => {
  const view = await card(typed, { g1: "das Hotel" }, {
    result: "wrong",
    score: 0,
    parts: { g1: false },
  } as Outcome);
  expect(view.queryByRole("textbox")).toBeNull();
  expect(view.getByText("das Hotel")).toBeTruthy();
  // The full stop stays with the gap (no line starts with "."), after it: the right answer is under it.
  const right = view.getByText("→\u00a0die Touristeninformation", RAW);
  expect(right.parentElement?.nextSibling?.textContent).toBe(".");
  expect(view.getByText(/Er wohnt hier/).textContent).toBe(" Er wohnt hier.");
});

test("a space before a comma after a gap is dropped; an opening quote after a space stays apart", async () => {
  const ex = exercise("gap_text", {
    segments: ["Eine ", { gap: "g1" }, " , sagt er. Er heißt ", { gap: "g2" }, ' "Max".'],
    answer: { g1: { accepted: ["Brücke"] }, g2: { accepted: ["nicht"] } },
  });
  const view = await card(ex, { g1: "Straße", g2: "nicht" }, {
    result: "partial",
    score: 0.5,
    parts: { g1: false, g2: true },
  } as Outcome);
  expect(view.getByText("→ Brücke", RAW).parentElement?.nextSibling?.textContent).toBe(",");
  expect(view.getByText(/sagt er/).textContent).toBe(" sagt er. Er heißt ");
  expect(view.getByText(/Max/).textContent).toBe(' "Max".');
});

test("an open typed gap is a field as wide as its answer needs", async () => {
  const view = await card(typed, {});
  const field = view.getByRole("textbox", { name: "Gap 1" }) as HTMLInputElement;
  expect(field.style.width).toBe("calc(28ch + 1.25rem)");
});

test("a checked drop-down gap shows the choice as text with its mark, no greyed list", async () => {
  const chosen = exercise("gap_choice", {
    segments: ["Guten Tag, ", { gap: "g1" }, " Weber."],
    gaps: {
      g1: {
        options: [
          { id: "a", text: "Herr" },
          { id: "b", text: "Frau" },
        ],
      },
    },
    display: "dropdown",
    answer: { g1: "b" },
  });
  const view = await card(chosen, { g1: "a" }, {
    result: "wrong",
    score: 0,
    parts: { g1: false },
  } as Outcome);
  expect(view.queryByRole("combobox")).toBeNull();
  expect(view.getByText("Herr")).toBeTruthy();
  expect(view.getByText("→\u00a0Frau", RAW)).toBeTruthy();
  // The mark in words too, for screen readers.
  expect(view.getByText("wrong").className).toContain("sr-only");
});

test("what touches a gap goes with it: a stem, an opening quote, the punctuation after it", () => {
  // An article before a gap stays with it, its space kept; another word before a space does not.
  expect(
    runs(["Ich mag die ", { gap: "g1" }, " und Ein ", { gap: "g2" }, ", nicht ", { gap: "g3" }]),
  ).toEqual([
    { text: "Ich mag " },
    { gap: "g1", head: "die ", tail: "" },
    { text: " und " },
    { gap: "g2", head: "Ein ", tail: "," },
    { text: " nicht " },
    { gap: "g3", head: "", tail: "" },
  ]);
  // An ending after its stem: "mein[em] Vater", never "mein / [em]".
  expect(runs(["Dativ: mit mein", { gap: "g1" }, " Vater"])).toEqual([
    { text: "Dativ: mit " },
    { gap: "g1", head: "mein", tail: "" },
    { text: " Vater" },
  ]);
  // „ with its gap, “. after it.
  expect(runs(["kommt von „", { gap: "g1" }, "“.\nDas Nomen"])).toEqual([
    { text: "kommt von " },
    { gap: "g1", head: "„", tail: "“." },
    { text: "\nDas Nomen" },
  ]);
  // A form's label keeps its colon; letters between two gaps go with the first one.
  expect(
    runs(["Angaben\n", { gap: "g1" }, ": Moser\n", { gap: "g2" }, "en", { gap: "g3" }]),
  ).toEqual([
    { text: "Angaben\n" },
    { gap: "g1", head: "", tail: ":" },
    { text: " Moser\n" },
    { gap: "g2", head: "", tail: "en" },
    { gap: "g3", head: "", tail: "" },
  ]);
});

test("a checked ending gap stays on its stem, the right answer under it", async () => {
  const ex = exercise("gap_choice", {
    segments: ["mit mein", { gap: "g1" }, " Vater."],
    gaps: {
      g1: {
        options: [
          { id: "a", text: "en" },
          { id: "b", text: "em" },
        ],
      },
    },
    display: "dropdown",
    answer: { g1: "b" },
  });
  const view = await card(ex, { g1: "a" }, {
    result: "wrong",
    score: 0,
    parts: { g1: false },
  } as Outcome);
  const right = view.getByText("→ em", RAW);
  // The answer given and the right one in one column, the stem before them, in one unit.
  expect(right.previousSibling?.textContent).toContain("en");
  expect(right.parentElement?.previousSibling?.textContent).toBe("mein");
  expect(view.getByText(/mit/).textContent).toBe("mit ");
});

test("an answer ending with the mark that follows the gap shows it once", () => {
  expect(tailAfter(".", "Bin schon da.")).toBe("");
  expect(tailAfter("?“", "Wie bitte?")).toBe("“");
  expect(tailAfter(".", "da")).toBe(".");
  expect(tailAfter(",", "ja,")).toBe(",");
});

const dash = exercise("gap_choice", {
  segments: ["Ich wasche ", { gap: "g1" }, " die Hände."],
  gaps: {
    g1: {
      options: [
        { id: "a", text: "mir" },
        { id: "b", text: "-" },
      ],
    },
  },
  display: "bank",
  answer: { g1: "a" },
});

test("an option of only a dash says it is no word; every slot of a bank has one width", async () => {
  const open = await card(dash, {});
  expect(open.getByText("— (nothing)")).toBeTruthy();
  open.unmount();
  const view = await card(dash, { g1: "b" }, {
    result: "wrong",
    score: 0,
    parts: { g1: false },
  } as Outcome);
  // The answer given read as no word; the slot as wide as the longest option and its mark.
  const slot = view.getByRole("button", { name: "Gap 1" });
  expect(slot.textContent).toContain("— (nothing)");
  expect(slot.style.width).toBe("calc(11ch + 3.25rem)");
});
