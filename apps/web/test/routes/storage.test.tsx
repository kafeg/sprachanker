import { expect, test } from "bun:test";
import { StorageSection } from "../../src/routes/storage.tsx";
import { renderApp } from "../render.tsx";

const GB = 1024 ** 3;

test("Storage names each source by its courses; those the catalogue does not offer (experimental, hidden) are one row, not by name", async () => {
  const view = await renderApp(<StorageSection />, {
    data: [
      [
        ["storage"],
        {
          dataRoot: "/data",
          free: 10 * GB,
          series: [
            { series: "dw.nicos-weg", bytes: 3 * GB },
            { series: "dw.deutschtrainer", bytes: 2 * GB },
            { series: "coerll.dib", bytes: GB },
          ],
        },
      ],
      [["catalog"], [{ series: "dw.nicos-weg", course: "a1", title: "Nicos Weg A1" }]],
      [["recordings"], { count: 0, bytes: 0 }],
    ],
  });
  const rows = [...view.container.querySelectorAll("li")].map((li) => li.textContent);
  expect(rows[0]).toContain("Nicos Weg A1");
  expect(rows[1]).toContain("Other courses kept here, not shown (experimental)");
  expect(rows[1]).toContain("3");
  expect(view.container.textContent).not.toContain("dw.deutschtrainer");
  expect(view.container.textContent).not.toContain("coerll.dib");
});
