import { expect, test } from "bun:test";
import { createOnce } from "../src/once.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

test("one promise per key while it runs; forgotten once settled", async () => {
  const once = createOnce<number>();
  let made = 0;
  const make = async () => ++made;
  const [a, b] = await Promise.all([once("k", make), once("k", make)]);
  expect([a, b, made]).toEqual([1, 1, 1]);
  await tick();
  expect(await once("k", make)).toBe(2);
});

test("kept: a success stays while its stamp does, a failure is forgotten", async () => {
  const once = createOnce<number>({ keep: true });
  let made = 0;
  const make = async () => ++made;
  expect(await once("k", make, "s1")).toBe(1);
  expect(await once("k", make, "s1")).toBe(1);
  expect(await once("k", make, "s2")).toBe(2);
  await expect(once("f", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
  await tick();
  expect(await once("f", make)).toBe(3);
});
