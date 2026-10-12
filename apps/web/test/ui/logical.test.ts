// The layout is set in logical terms, so a right-to-left interface mirrors it: no left/right utility in the code but those kept physical on purpose.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });

/** A utility with a side in it, after any variants (`sm:`, `data-[x]:`). */
const PHYSICAL =
  /(?<=^|[\s"'`:])(?:-?(?:m[lr]|p[lr]|left|right|scroll-[mp][lr])-[\w./[\]%-]+|(?:border-[lr]|rounded-(?:[lr]|[tb][lr]))(?:-[\w./[\]%-]+)?|(?:text|float)-(?:left|right))(?=$|[\s"'`])/g;
/** Kept physical on purpose: a dialog centred by its left edge (symmetric either way). */
const KEPT = ["left-1/2"];

test("no physical left/right utilities: the logical ones (ms/me, ps/pe, start/end, text-start…)", () => {
  const found: string[] = [];
  for (const path of files(SRC)) {
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const [m] of line.matchAll(PHYSICAL))
          if (!KEPT.includes(m)) found.push(`${path.slice(SRC.length)}:${i + 1} ${m}`);
      });
  }
  expect(found).toEqual([]);
});

/** A side in an inline style's property: `left`, `marginRight`, `paddingLeft`… (`insetInlineStart`,
 *  `marginInlineEnd` and the like are the logical ones). */
const PHYSICAL_STYLE = /\b(?:left|right|(?:margin|padding|border)(?:Left|Right)\w*)\s*:/g;
/** Inline styles kept physical on purpose, as `file:property` (none yet). */
const KEPT_STYLE: string[] = [];

test("no physical left/right in inline styles (`style={{ … }}`)", () => {
  const found: string[] = [];
  for (const path of files(SRC).filter((p) => p.endsWith(".tsx"))) {
    const file = path.slice(SRC.length);
    for (const [, style = ""] of readFileSync(path, "utf8").matchAll(/style=\{\{([\s\S]*?)\}\}/g))
      for (const [m] of style.matchAll(PHYSICAL_STYLE)) {
        const property = m.replace(/\s*:$/, "");
        if (!KEPT_STYLE.includes(`${file}:${property}`)) found.push(`${file} ${property}`);
      }
  }
  expect(found).toEqual([]);
  // The pattern itself: physical sides found, logical ones and words in values not.
  const probe = `style={{ marginLeft: 4, insetInlineStart: 0, right: 2, width: "left" }}`;
  expect([...probe.matchAll(PHYSICAL_STYLE)].map(([m]) => m)).toEqual(["marginLeft:", "right:"]);
});
