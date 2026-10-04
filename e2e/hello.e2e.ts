import { expect, test } from "@playwright/test";

const HELLO = { en: "Hello!", ru: "Привет!", de: "Hallo!" };

test("hello page switches between English, Russian and German", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("server-status")).toHaveAttribute("data-status", "ok");
  for (const [lang, heading] of Object.entries(HELLO)) {
    await page.locator(`nav button[lang="${lang}"]`).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
  }
});

test.describe("with a German browser", () => {
  test.use({ locale: "de-DE" });

  test("starts in German", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HELLO.de);
  });
});

test("client routes load the app", async ({ page }) => {
  await page.goto("/course/a1");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HELLO.en);
});
