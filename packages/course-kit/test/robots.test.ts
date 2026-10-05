import { expect, test } from "bun:test";
import { isAllowed, parseRobots } from "../src/robots.ts";

const rules = parseRobots(`# comment
User-agent: *
Disallow: /*/*/l-*/ler$
Disallow: /*/*/final-*
Disallow: /*/search$

User-agent: GPTBot
Disallow: /
`);

test.each([
  ["/ru/x/l-1/e-2", true],
  ["/ru/x/l-1/ler", false],
  ["/ru/x/l-1/lerx", true],
  ["/ru/x/final-test", false],
  ["/de/search", false],
  ["/", true],
])("%s allowed: %p", (path, allowed) => {
  expect(isAllowed(rules, path)).toBe(allowed);
});
