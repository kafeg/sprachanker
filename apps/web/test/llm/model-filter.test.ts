import { expect, test } from "bun:test";
import {
  filterModels,
  groupModels,
  initialFilters,
  modelFacets,
  NO_FILTERS,
} from "../../src/llm/model-filter.ts";
import type { ListedModel } from "../../src/llm/setup-api.ts";

const models: ListedModel[] = [
  {
    id: "a/big",
    name: "A: Big",
    publisher: "a",
    json: true,
    contextLength: 200_000,
    price: { input: 3, output: 15 },
  },
  {
    id: "a/small:free",
    name: "A: Small (free)",
    publisher: "a",
    json: false,
    free: true,
    contextLength: 32_000,
  },
  { id: "b/mid", name: "B: Mid", publisher: "b", json: true, contextLength: 64_000 },
];

test("filters are offered where the list tells them; a plain server's list offers none", () => {
  expect(modelFacets(models)).toEqual({
    free: 1,
    json: 2,
    context: true,
    publishers: [
      ["a", 2],
      ["b", 1],
    ],
  });
  expect(modelFacets([{ id: "qwen3-8b" }])).toEqual({
    free: 0,
    json: 0,
    context: false,
    publishers: [],
  });
  // Free and JSON are on from the start where the list tells them.
  expect(initialFilters(models)).toMatchObject({ free: true, json: true });
  expect(initialFilters([{ id: "qwen3-8b" }])).toMatchObject({ free: false, json: false });
});

test("search by every word in id or name; filters combine; the chosen model always stays", () => {
  const ids = (f: Partial<typeof NO_FILTERS>, keep?: string) =>
    filterModels(models, { ...NO_FILTERS, ...f }, keep).map((m) => m.id);
  expect(ids({ search: "a small" })).toEqual(["a/small:free"]);
  expect(ids({ free: true })).toEqual(["a/small:free"]);
  expect(ids({ json: true, minContext: 128_000 })).toEqual(["a/big"]);
  expect(ids({ publishers: ["b"] })).toEqual(["b/mid"]);
  expect(ids({ publishers: ["b"] }, "a/big")).toEqual(["a/big", "b/mid"]);
});

test("groups by publisher, most models first; free ones lead their group", () => {
  expect(groupModels(models).map((g) => [g.publisher, g.models.map((m) => m.id)])).toEqual([
    ["a", ["a/small:free", "a/big"]],
    ["b", ["b/mid"]],
  ]);
  expect(groupModels([{ id: "x" }, { id: "y" }])).toEqual([
    { publisher: "", models: [{ id: "x" }, { id: "y" }] },
  ]);
});
