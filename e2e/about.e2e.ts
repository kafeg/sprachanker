// Settings → General → About: the third-party components and their licences, as the program carries
// them (scripts/notices: written into the web build by build:bin, served with the app).
import { expect, test } from "@playwright/test";

test("Settings → About opens the third-party components and their licences", async ({ page }) => {
  await page.goto("/settings#about");
  const about = page.locator("#about");
  await about.getByRole("button", { name: "Third-party components and licences" }).click();
  const sheet = page.getByRole("dialog", { name: "Third-party components and licences" });
  const notices = sheet.locator("pre");
  await expect(notices).toContainText("whisper.cpp v");
  await expect(notices).toContainText("Source code for the GPL and LGPL components");
  await expect(notices).toContainText("eSpeak NG");
  await expect(notices).toContainText("react 19");
  // Long lines wrap: nothing scrolls sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
