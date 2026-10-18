import { expect, test } from "bun:test";
import { OfferCard } from "../../src/library/card.tsx";
import { renderApp } from "../render.tsx";

const offer = {
  key: "x.demo/a1",
  series: "x.demo",
  course: "a1",
  edition: "ru-de",
  title: "Demo A1",
  source: { publisher: "X", url: "https://x.test", licence: "public-domain" },
  approxBytes: 1e6,
  installed: false,
  state: "available",
} as const;
const data: Array<[unknown[], unknown]> = [[["downloads"], { available: true, jobs: [] }]];

test("an experimental offer (a server started with --experimental shows them) is marked; a ready one is not", async () => {
  const marked = await renderApp(<OfferCard offer={{ ...offer, experimental: true }} />, { data });
  expect(marked.getByText("Experimental: not ready for learning")).toBeTruthy();
  marked.unmount();
  const ready = await renderApp(<OfferCard offer={offer} />, { data });
  expect(ready.getByText("Demo A1")).toBeTruthy();
  expect(ready.queryByText(/Experimental/)).toBeNull();
});
