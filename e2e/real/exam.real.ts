// Run-throughs of the installed exams (10, "Run-throughs"; 09, Exams): in a profile of its own, the
// federal state chosen on the exam's page, a mock exam drawn, every question answered through the
// screen — two of three right — and handed in; its result, then practice of the mistakes (each
// checked at once), the catalogue with a question opened, the Notebook; then the profile's
// database read to check that all of it is stored as it should be. `REAL=bamf.lid bun run e2e:real`.
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { CLIENT_HEADERS, type ExamItem } from "@sprachanker/schema";
import { REAL_DATA } from "./data.ts";
import { readStore } from "./read-store.ts";
import { examFile, examScenarios } from "./scenarios.ts";
import { examProblems, storeProblems } from "./store.ts";

/** Federal state the run-through takes the exam for. */
const STATE = { code: "be", name: "Berlin" };

type Choice = Extract<ExamItem, { type: "single_choice" }>;

/** The option of a question to choose: its right one, or the first other. */
const optionOf = (item: Choice, right: boolean) =>
  item.options.find((o) => item.answer.optionIds.includes(o.id) === right) ??
  (item.options[0] as Choice["options"][number]);

/** Answers a question in its card, rightly or not: an option by its text or its picture's file; a
 *  typed gap with an accepted text or another; an open answer with its model answer. */
async function answer(card: Locator, item: ExamItem, right: boolean) {
  if (item.type === "single_choice") {
    const option = optionOf(item, right);
    // The question's own buttons: an example above it is answered already (its buttons disabled).
    const button = option.media?.image
      ? card.locator(
          `button:not([disabled]):has(img[src$="${option.media.image.split("/").pop()}"])`,
        )
      : card.getByRole("button", { name: option.text ?? "", exact: true, disabled: false });
    await button.first().click();
  } else if (item.type === "gap_text") {
    const boxes = card.getByRole("textbox");
    for (const [i, { accepted }] of Object.values(item.answer).entries())
      await boxes.nth(i).fill(right ? (accepted[0] ?? "") : "xyz");
    await boxes.last().blur();
  } else {
    await card.getByRole("textbox").fill(item.reference[0] ?? "…");
    await card.getByRole("textbox").blur();
  }
}

/** The run open on the page, as the server gives it. */
async function runOf(page: Page) {
  const id = page.url().split("/run/")[1]?.split(/[?#]/)[0];
  const res = await page.request.get(`/api/exams/runs/${id}`, { headers: { ...CLIENT_HEADERS } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as {
    run: { id: string; plan: { items: string[]; snapshot?: ExamItem[] } };
  };
}

const visible = (l: Locator) => l.filter({ visible: true });

for (const s of examScenarios())
  test(`exam ${s.key} [${s.edition}]`, async ({ page }) => {
    const exam = examFile(s);
    const items = new Map(exam.items.map((i) => [i.key as string, i]));
    const [native, target] = s.edition.split("-") as [string, string];
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(e.message));

    const made = await page.request.post("/api/profiles", {
      data: { name: `exam ${s.key}`.slice(0, 40) },
      headers: { ...CLIENT_HEADERS },
    });
    expect(made.ok()).toBe(true);
    const { profile } = (await made.json()) as { profile: { id: string } };
    for (const [key, value] of [
      ["uiLanguage", "en"],
      ["learner.native", native],
      ["learner.target", target],
    ] as const)
      await page.request.put("/api/settings", {
        data: { key, value },
        headers: { ...CLIENT_HEADERS },
      });
    await page.request.put("/api/profile", {
      data: { onboarded: true },
      headers: { ...CLIENT_HEADERS },
    });

    // The exam from the Exams section; its page asks for the state first.
    await page.goto("/exams/downloaded");
    await page.locator(`a[href="/exam/${s.series}/${s.course}/${s.exam}"]`).first().click();
    const begin = page.getByRole("button", { name: /^Begin/ });
    const asksState = exam.sections.some((x) => x.filter?.setting === "exam.federalState");
    if (asksState) {
      await expect(begin).toBeDisabled();
      await page.getByRole("combobox", { name: "Federal state" }).click();
      await page.getByRole("option", { name: STATE.name }).click();
    }
    await begin.click();
    await expect(page).toHaveURL(/\/run\//);

    // The mock exam: every question answered through its card, two of three right.
    const { run: test1 } = await runOf(page);
    const asked = test1.plan.snapshot ?? [];
    expect(asked.map((i) => i.key)).toEqual(test1.plan.items);
    // A question at a time: the grid of all of them above; each answered on its screen, then on.
    const grid = page.getByRole("navigation", { name: "Questions" });
    await expect(grid.getByRole("button")).toHaveCount(asked.length);
    const onScreen = (i: number, of: number) =>
      page.getByRole("region", { name: `Question ${i + 1} of ${of}` });
    const next = () =>
      visible(page.getByRole("button", { name: "Next", exact: true }))
        .first()
        .click();
    let right = 0;
    for (const [i, item] of asked.entries()) {
      const good = i % 3 !== 2;
      if (good) right++;
      await answer(onScreen(i, asked.length), item, good);
      // Nothing marked before it is handed in.
      await expect(onScreen(i, asked.length).getByRole("status")).toHaveCount(0);
      if (i < asked.length - 1) await next();
    }
    await expect(page.getByText(`Answered: ${asked.length} of ${asked.length}`)).toBeVisible();
    await visible(page.getByRole("button", { name: "Hand in" }))
      .first()
      .click();

    // The result: the points, passed or not as the server judged it by the exam's rule (store checks
    // below recompute it).
    await expect(page.getByRole("heading", { name: /mistakes?$/ })).toBeVisible();
    const handed = (await runOf(page)).run as unknown as {
      result: { pass?: boolean; passed: string[] };
    };
    const passed = handed.result.pass ?? handed.result.passed.length > 0;
    await expect(
      page.getByRole("heading", { name: passed ? "Passed" : "Not passed" }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: `${right}/${asked.length}` })).toBeVisible();
    const wrong = asked.length - right;
    await expect(page.getByRole("heading", { name: `${wrong} mistakes` })).toBeVisible();

    // Practice of the mistakes: the wrong ones come first, each checked at once.
    await page.getByRole("button", { name: "Practise the mistakes" }).click();
    await expect(page).not.toHaveURL(new RegExp(test1.id));
    const { run: practice } = await runOf(page);
    const firstWrong = asked.filter((_, i) => i % 3 === 2).map((i) => i.key);
    expect(new Set(practice.plan.items.slice(0, wrong))).toEqual(new Set(firstWrong));
    const fixed = Math.min(3, wrong);
    for (let i = 0; i < fixed; i++) {
      const item = items.get(practice.plan.items[i] as string) as ExamItem;
      const card = onScreen(i, practice.plan.items.length);
      await answer(card, item, true);
      await expect(card.getByRole("status").filter({ hasText: /^Correct$/ })).toBeAttached();
      if (i < fixed - 1) await next();
    }
    await visible(page.getByRole("button", { name: "End practice" }))
      .first()
      .click();
    await expect(
      page.getByRole("heading", {
        name: `${fixed} of ${fixed} answer${fixed === 1 ? "" : "s"} right`,
      }),
    ).toBeVisible();

    // The catalogue: every open question as a line; one opened shows its right answer.
    await page.goto(`/exam/${s.series}/${s.course}/${s.exam}/catalog`);
    const open = exam.sections.flatMap((x) =>
      x.filter
        ? x.pool.filter((k) => items.get(k)?.tags[x.filter?.tag ?? ""] === STATE.code)
        : x.pool,
    );
    await expect(page.getByText(`${open.length} questions`, { exact: true })).toBeVisible();
    const first = page.locator("ol > li button[aria-expanded]").first();
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(
      page
        .locator("main")
        .getByRole("status")
        .filter({ hasText: /^Correct$/ })
        .first(),
    ).toBeAttached();

    // The Notebook lists the mock exam.
    await page.goto("/notebook");
    await expect(page.getByRole("heading", { name: "Exams" })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: new RegExp(`${right} of ${asked.length}\\s*${passed ? "Passed" : "Not passed"}`),
      }),
    ).toBeVisible();
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide, "nothing wider than the screen").toBeLessThanOrEqual(1);

    await page.waitForLoadState("networkidle");
    const stored = readStore(join(REAL_DATA, "profiles", profile.id, "profile.sqlite"));
    expect(
      examProblems(stored, exam, target, { state: STATE.code, tests: 1, practices: 1 }),
      `stored for ${s.key}`,
    ).toEqual([]);
    expect(storeProblems(stored), "the store as a whole").toEqual([]);
    expect(consoleErrors, "errors in the page").toEqual([]);
  });
