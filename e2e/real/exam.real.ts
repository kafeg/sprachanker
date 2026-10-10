// Run-throughs of the installed exams (10, "Run-throughs"; 09, Exams): in a profile of its own, the
// federal state chosen on the exam's page, a mock exam drawn, every question answered through the
// screen — two of three right — and handed in; its result, then practice of the mistakes (each
// checked at once), the catalogue narrowed to the wrong ones, the Notebook; then the profile's
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
    const button = option.media?.image
      ? card.locator(`button:has(img[src$="${option.media.image.split("/").pop()}"])`)
      : card.getByRole("button", { name: option.text ?? "", exact: true });
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
    const cards = page.getByRole("list", { name: "Items" }).locator(":scope > li");
    await expect(cards).toHaveCount(asked.length);
    let right = 0;
    for (const [i, item] of asked.entries()) {
      const good = i % 3 !== 2;
      if (good) right++;
      await answer(cards.nth(i), item, good);
    }
    // Nothing marked before it is handed in.
    await expect(page.getByRole("status").filter({ hasText: /^(Correct|Not quite)$/ })).toHaveCount(
      0,
    );
    await expect(
      visible(page.getByText(`Answered: ${asked.length} of ${asked.length}`)),
    ).toBeVisible();
    await visible(page.getByRole("button", { name: "Hand in" })).click();

    // The result: the points, passed or not by the exam's first pass mark.
    const passed = right >= (exam.thresholds[0]?.minPoints ?? Infinity);
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
      await answer(cards.nth(i), item, true);
      await expect(
        cards
          .nth(i)
          .getByRole("status")
          .filter({ hasText: /^Correct$/ }),
      ).toBeAttached();
    }
    await visible(page.getByRole("button", { name: "End practice" })).click();
    await expect(
      page.getByRole("heading", {
        name: `${fixed} of ${fixed} answer${fixed === 1 ? "" : "s"} right`,
      }),
    ).toBeVisible();

    // The catalogue: every open question, those wrong last time the mistakes not yet put right.
    await page.goto(`/exam/${s.series}/${s.course}/${s.exam}/catalog`);
    await page.getByRole("button", { name: "Wrong last time" }).click();
    await expect(
      page.getByText(`${wrong - fixed} question${wrong - fixed === 1 ? "" : "s"}`, { exact: true }),
    ).toBeVisible();

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
