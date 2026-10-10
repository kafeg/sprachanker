import { expect, test } from "bun:test";
import { SectionTabs } from "../../src/ui/section-tabs.tsx";
import { renderApp } from "../render.tsx";

test("only the tab of the page is current, not one whose address starts the page's", async () => {
  const view = await renderApp(
    <SectionTabs
      label="Review"
      tabs={[
        { to: "/review", label: "Study", current: false },
        { to: "/review/decks", label: "Decks", current: true },
        { to: "/review/words", label: "Words", current: false },
      ]}
    />,
    { path: "/review/decks" },
  );
  expect(
    view.getAllByRole("link").map((l) => [l.textContent, l.getAttribute("aria-current")]),
  ).toEqual([
    ["Study", null],
    ["Decks", "page"],
    ["Words", null],
  ]);
});
