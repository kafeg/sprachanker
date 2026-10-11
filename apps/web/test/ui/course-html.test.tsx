import { expect, test } from "bun:test";
import { markScroll } from "../../src/ui/course-html.tsx";

/** A box `width` wide showing `shown` of it, scrolled by `at`. */
const box = (width: number, shown: number, at = 0) => {
  const el = document.createElement("table");
  Object.defineProperty(el, "scrollWidth", { value: width });
  Object.defineProperty(el, "clientWidth", { value: shown });
  Object.defineProperty(el, "scrollLeft", { value: at });
  return el;
};

test("a table wider than its room is marked while more of it is past its end", () => {
  const wide = box(500, 300);
  markScroll(wide);
  expect(wide.hasAttribute("data-more")).toBe(true);
  // Scrolled to its end (or to its start, right to left: a negative offset), nothing more past it.
  const end = box(500, 300, 200);
  markScroll(end);
  expect(end.hasAttribute("data-more")).toBe(false);
  const fits = box(300, 300);
  fits.setAttribute("data-more", "");
  markScroll(fits);
  expect(fits.hasAttribute("data-more")).toBe(false);
});
