import { expect, test } from "bun:test";
import { htmlSections } from "../../src/ui/sections.ts";

test("a page splits at its section titles; what comes first is a section without one", () => {
  expect(htmlSections("<p>intro</p><h3>A <em>x</em></h3><p>a</p><h3>B</h3><p>b</p>")).toEqual([
    { html: "<p>intro</p>" },
    { titleHtml: "A <em>x</em>", html: "<p>a</p>" },
    { titleHtml: "B", html: "<p>b</p>" },
  ]);
  expect(htmlSections("<p>only</p>")).toEqual([{ html: "<p>only</p>" }]);
  expect(htmlSections("")).toEqual([]);
});

test("a title with nothing under it heads the next section, whose title is a bold line in it", () => {
  expect(htmlSections("<h3>Cities</h3>\n<h3><em>Woher?</em></h3><p>a</p><h3>End</h3>")).toEqual([
    { titleHtml: "Cities", html: "<p><strong><em>Woher?</em></strong></p><p>a</p>" },
    { titleHtml: "End", html: "" },
  ]);
});
