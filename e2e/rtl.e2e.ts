// A right-to-left interface: the page `dir="rtl"`, nothing past the screen's
// edges at phone and desktop width on the main screens, a course's German left to right. Runs once a
// right-to-left catalog is there (ar.json, fa.json); skipped before.
import { expect, type Page, test } from "@playwright/test";
import { DEMO_LESSON, freshLessonRun, put } from "./api.ts";
import { catalogs } from "./catalogs.ts";

const rtl = catalogs.find((c) => c.lang === "ar") ?? catalogs.find((c) => c.dir === "rtl");

/** Elements reaching past the window's sides, those inside something scrolled or clipped sideways
 *  (a tab bar, a table, the calendar) aside. */
const pastTheEdges = (page: Page) =>
  page.evaluate(() => {
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
        if (getComputedStyle(p).overflowX !== "visible") return true;
      return false;
    };
    return [...document.body.querySelectorAll("*")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || clipped(el)) return false;
        return r.left < -1 || r.right > innerWidth + 1;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120));
  });

test("a right-to-left interface: mirrored, nothing past the screen's edges, German left to right", async ({
  page,
  request,
}) => {
  test.skip(!rtl, "no right-to-left catalog (ar.json, fa.json) yet");
  if (!rtl) return;
  await freshLessonRun(request);
  await put(request, "/api/settings", { key: "uiLanguage", value: rtl.lang });
  const lesson = `/lesson/${DEMO_LESSON}`;
  try {
    for (const size of [
      { width: 375, height: 812 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      for (const path of ["/downloaded", lesson, "/review", "/settings"]) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        await expect(page.locator("html")).toHaveAttribute("lang", rtl.lang);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(await pastTheEdges(page), `${path} at ${size.width} px`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
    // In a lesson the course's German runs left to right inside the right-to-left page.
    await page.goto(lesson);
    await page.getByRole("button", { name: rtl.msg("lesson.start") }).click();
    await page.getByRole("button", { name: rtl.msg("lesson.skip"), exact: true }).click();
    await page.getByRole("button", { name: rtl.msg("lesson.next"), exact: true }).click();
    await expect(page.getByRole("button", { name: "Im Café.", exact: true })).toBeVisible();
    expect(await pastTheEdges(page)).toEqual([]);
    const directions = await page
      .locator('[lang="de"]')
      .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).direction))]);
    expect(directions).toEqual(["ltr"]);
  } finally {
    await put(request, "/api/settings", { key: "uiLanguage", value: "en" });
  }
});
