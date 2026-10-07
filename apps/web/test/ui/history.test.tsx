import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { Chip } from "../../src/ui/chip.tsx";
import { HistoryList, ListRow } from "../../src/ui/history.tsx";
import { renderApp } from "../render.tsx";

test("a history opens one item at a time, and says which is open", async () => {
  const view = await renderApp(
    <HistoryList
      title="Earlier"
      items={[{ id: "a" }, { id: "b" }]}
      keyOf={(i) => i.id}
      summary={(i) => `row ${i.id}`}
      detail={(i) => <p>detail {i.id}</p>}
    />,
  );
  const a = view.getByRole("button", { name: /row a/ });
  const b = view.getByRole("button", { name: /row b/ });
  expect(a.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(a);
  expect(view.getByText("detail a")).toBeTruthy();
  fireEvent.click(b);
  expect(view.queryByText("detail a")).toBeNull();
  expect(view.getByText("detail b")).toBeTruthy();
  expect([a.getAttribute("aria-expanded"), b.getAttribute("aria-expanded")]).toEqual([
    "false",
    "true",
  ]);
  fireEvent.click(b);
  expect(view.queryByText("detail b")).toBeNull();
});

test("an empty history shows nothing; a row that opens a page is no disclosure", async () => {
  const empty = await renderApp(
    <HistoryList title="Earlier" items={[]} keyOf={() => 1} summary={() => ""} detail={() => ""} />,
  );
  expect(empty.container.textContent).toBe("");
  let opened = 0;
  const view = await renderApp(<ListRow onClick={() => opened++}>a page</ListRow>);
  const row = view.getByRole("button", { name: "a page" });
  expect(row.hasAttribute("aria-expanded")).toBe(false);
  fireEvent.click(row);
  expect(opened).toBe(1);
});

test("a chip says whether it is on", async () => {
  const view = await renderApp(
    <Chip on onClick={() => {}}>
      German
    </Chip>,
  );
  expect(view.getByRole("button", { name: "German" }).getAttribute("aria-pressed")).toBe("true");
});
