import { expect, test } from "bun:test";
import { canonicalJson } from "../src/canonical-json.ts";

test("keys are sorted recursively and whitespace is dropped", () => {
  expect(canonicalJson({ b: [3, { d: 1, c: null }], a: "x" })).toBe(
    '{"a":"x","b":[3,{"c":null,"d":1}]}',
  );
});

test("undefined properties are omitted, like JSON.stringify", () => {
  expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
});

test("RFC 8785 examples: numbers and string escaping", () => {
  expect(canonicalJson([1e21, 0.000001, 1e-7, -0, 4.5])).toBe("[1e+21,0.000001,1e-7,0,4.5]");
  expect(canonicalJson('€$\u000f\nA\'B"\\\\"/')).toBe('"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"');
});

test("keys sort by UTF-16 code units", () => {
  expect(canonicalJson({ "€": 1, "\r": 2, "😀": 3, "1": 4, ö: 5 })).toBe(
    '{"\\r":2,"1":4,"ö":5,"€":1,"😀":3}',
  );
});

test("non-finite numbers are rejected", () => {
  expect(() => canonicalJson(Number.NaN)).toThrow();
});
