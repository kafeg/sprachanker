import { afterEach, expect, test } from "bun:test";
import { fireEvent, within } from "@testing-library/react";
import { switchLanguage } from "../../src/i18n/index.ts";
import { BarChart, type ChartBar } from "../../src/ui/bar-chart.tsx";
import { renderApp } from "../render.tsx";

afterEach(async () => {
  await switchLanguage("en");
});

const BARS: ChartBar[] = [
  { key: 1, parts: [2, 3], title: "Mon: 5 cards, 2 new" },
  { key: 2, parts: [0, 0], title: "Tue: nothing" },
  { key: 3, parts: [0, 4], title: "Wed: 4 cards" },
];
const chart = (bars = BARS) => (
  <BarChart
    bars={bars}
    tones={["bg-srs-new", "bg-correct"]}
    label="Cards answered"
    top="5"
    ends={["Mon", "Wed"]}
  />
);

test("bars over time: each a button named by what it holds, its value shown when tapped or focused, the span's ends otherwise", async () => {
  const view = await renderApp(chart());
  const figure = view.getByRole("figure", { name: "Cards answered" });
  const bars = within(figure).getAllByRole("button");
  expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual(BARS.map((b) => b.title));
  // Parts stacked in their tones, in proportion to the highest bar; an empty bar has none.
  const heights = (bar: HTMLElement) =>
    [...bar.children].map((p) => [p.className.split(" ").at(-1), (p as HTMLElement).style.height]);
  expect(heights(bars[0] as HTMLElement)).toEqual([
    ["bg-srs-new", "40%"],
    ["bg-correct", "60%"],
  ]);
  expect(bars[1]?.children).toHaveLength(0);
  const caption = () => figure.querySelector("figcaption")?.textContent;
  expect(caption()).toBe("MonWed");
  // A tap (a phone has no pointer to hover with) shows the bar's value under the bars.
  fireEvent.click(bars[0] as HTMLElement);
  expect(caption()).toBe("Mon: 5 cards, 2 new");
  // One tab stop: the chosen bar, else the latest.
  expect(bars.map((b) => b.tabIndex)).toEqual([0, -1, -1]);
  fireEvent.keyDown(bars[0] as HTMLElement, { key: "ArrowRight" });
  expect(caption()).toBe("Tue: nothing");
  expect(document.activeElement).toBe(bars[1] as HTMLElement);
  fireEvent.keyDown(bars[1] as HTMLElement, { key: "End" });
  expect(caption()).toBe("Wed: 4 cards");
  // Past the last: nothing moves.
  fireEvent.keyDown(bars[2] as HTMLElement, { key: "ArrowRight" });
  expect(document.activeElement).toBe(bars[2] as HTMLElement);
});

test("nothing that is a value (0 % remembered) is a mark on the baseline; a bar with nothing to tell, none", async () => {
  const view = await renderApp(
    chart([
      { key: 1, parts: [0], title: "none answered" },
      { key: 2, parts: [0], title: "0 %", zero: true },
    ]),
  );
  const [none, zero] = view.getAllByRole("button");
  expect(none?.children).toHaveLength(0);
  expect(zero?.children).toHaveLength(1);
  expect(zero?.firstElementChild?.className).toContain("bg-wrong");
});

test("right to left: the bars run along the reading direction, ← goes on to the later bar", async () => {
  await switchLanguage("ar");
  expect(document.documentElement.dir).toBe("rtl");
  const view = await renderApp(chart());
  const bars = view.getAllByRole("button");
  // The latest is the tab stop; ← moves on, → back.
  expect(bars.map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
  fireEvent.keyDown(bars[2] as HTMLElement, { key: "ArrowRight" });
  expect(document.activeElement).toBe(bars[1] as HTMLElement);
  fireEvent.keyDown(bars[1] as HTMLElement, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(bars[2] as HTMLElement);
  // The ends start-aligned and end-aligned (logical: they swap sides with the direction).
  const caption = view.container.querySelector("figcaption");
  expect(caption?.className).toContain("justify-between");
  expect(caption?.className).not.toMatch(/\b(left|right)-/);
});
