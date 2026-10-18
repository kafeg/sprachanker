// Settings → General → About: the third-party components and their licences, as the program carries
// them (scripts/notices: written into the web build by build:bin, served with the app); a newer
// release, as the fake says one is out (the server's update check asks it: SPRACHANKER_RELEASES).
import { expect, test } from "@playwright/test";
import { FAKE_RELEASE } from "./fake-llm.ts";

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

test("a newer release: a dot on Settings, About says how this program takes it", async ({
  page,
}) => {
  await page.goto("/");
  const out = `SprachAnker ${FAKE_RELEASE} is out.`;
  await expect(page.getByRole("img", { name: out }).filter({ visible: true })).toBeVisible();
  await page.goto("/settings#about");
  const about = page.locator("#about");
  await expect(about.getByText(out)).toBeVisible();
  // The program the installer put there: its command again (a new archive on Windows).
  await expect(
    about.getByText(
      process.platform === "win32" ? /new archive for Windows/ : /install\.sh \| bash/,
    ),
  ).toBeVisible();
  await expect(about.getByRole("link", { name: /What is new/ })).toHaveAttribute(
    "href",
    new RegExp(`/releases/tag/v${FAKE_RELEASE}$`),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
