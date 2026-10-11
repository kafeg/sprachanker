// The Tutor section against the fake model (fake-llm.ts): a chat started from the section, kept,
// listed after a reload, continued, deleted after asking; a start offered in a new chat, its language
// shown; the section gone from the navigation while the tutor's place is off.
import { expect, type Page, test } from "@playwright/test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { beginCourse, put } from "./api.ts";
import { FAKE_LLM_PORT, FAKE_TEXT } from "./fake-llm.ts";

test.beforeEach(async ({ request }) => {
  await put(request, "/api/llm/providers/custom", {
    baseUrl: `http://127.0.0.1:${FAKE_LLM_PORT}/v1`,
  });
  await put(request, "/api/llm/route", { provider: "custom", model: "fake-model" });
  await put(request, "/api/settings", { key: "llm.offIn", value: [] });
  // The tutor talks about what the learner has met: a course begun.
  await beginCourse(request);
});

/** The navigation's entry as this size shows it: the sidebar's on a desktop, the tab bar's on a phone. */
const navEntry = (page: Page) => page.locator('a[href="/tutor"]:visible');
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("a chat started from the section, kept, continued later, deleted after asking", async ({
  page,
}, info) => {
  // Projects share the profile: this run's chat by its own first message.
  const question = `Was ist der Akkusativ? (${info.project.name}, ${Date.now()})`;
  const row = () => page.getByRole("button", { name: new RegExp(literal(question)) });
  const composer = page.getByPlaceholder("Ask a question…");

  await page.goto("/");
  await navEntry(page).click();
  await expect(page).toHaveURL(/\/tutor$/);
  await page.getByRole("link", { name: "New chat" }).click();
  await expect(page).toHaveURL(/\/tutor\/new$/);
  await composer.fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(FAKE_TEXT)).toBeVisible();
  // Once the reply is in, the chat has an address of its own.
  await expect(page).toHaveURL(/\/tutor\/[0-9A-Z]{26}$/);
  const address = page.url();

  // Kept: after a reload the section lists it, with both messages, and it opens to its turns.
  await page.getByRole("button", { name: "All chats" }).click();
  await page.reload();
  await expect(row()).toContainText("2 messages");
  await row().click();
  await expect(page).toHaveURL(address);
  await expect(page.getByText(question)).toBeVisible();

  // Continued later: the next message goes to the same chat, kept with it.
  await composer.fill("Noch ein Beispiel, bitte.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Noch ein Beispiel, bitte.")).toBeVisible();
  await expect(page.getByText(FAKE_TEXT)).toHaveCount(2);
  await page.reload();
  await expect(page.getByText(FAKE_TEXT)).toHaveCount(2);
  await page.getByRole("button", { name: "All chats" }).click();
  await expect(row()).toContainText("4 messages");

  // Deleted after asking: gone from the list.
  await page
    .getByRole("listitem")
    .filter({ hasText: question })
    .getByRole("button", { name: "Delete chat" })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete chat" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(row()).toHaveCount(0);
});

test("a start offered in a new chat is its first message", async ({ page, request }) => {
  await page.goto("/tutor/new");
  // The courses begun teach German alone: shown, nothing to choose.
  await expect(page.getByTitle("Language to practise: German")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Language to practise" })).toHaveCount(0);
  await page.getByRole("button", { name: "I have a grammar question" }).click();
  await expect(page.getByText(/^I have a grammar question\. Ask me what it is/)).toBeVisible();
  await expect(page.getByText(FAKE_TEXT)).toBeVisible();
  await expect(page).toHaveURL(/\/tutor\/[0-9A-Z]{26}$/);
  // Not left behind for the other projects.
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const res = await request.delete(`/api/llm/tutor/chats/${id}`, {
    headers: { ...CLIENT_HEADERS },
  });
  expect(res.ok()).toBe(true);
});

test("the tutor's place off: no Tutor in the navigation, and the section says how to turn it on", async ({
  page,
  request,
}) => {
  await put(request, "/api/settings", { key: "llm.offIn", value: ["tutor"] });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Review" }).first()).toBeVisible();
  await expect(navEntry(page)).toHaveCount(0);
  await page.goto("/tutor");
  await expect(page.getByText(/The tutor is turned off/)).toBeVisible();
  await expect(page.getByRole("link", { name: "New chat" })).toHaveCount(0);
  await put(request, "/api/settings", { key: "llm.offIn", value: [] });
});
