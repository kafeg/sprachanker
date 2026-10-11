// Settings → General → Other devices: the addresses the app is reached at, each with its QR code; the
// server here listens on 127.0.0.1 only, so this computer and how to open it to the network. On a
// desktop the side panel's "On a phone" opens the same block beside.
import { expect, test } from "@playwright/test";

test("Settings → General → Other devices: this computer's address and its QR code", async ({
  page,
}) => {
  await page.goto("/settings#other-devices");
  const section = page.locator("#other-devices");
  await expect(section.getByRole("heading", { name: "Other devices" })).toBeVisible();
  const port = new URL(page.url()).port;
  const address = section.getByText(`http://localhost:${port}`, { exact: true });
  await expect(address).toBeVisible();
  await expect(address).toHaveAttribute("dir", "ltr");
  await expect(section.getByText(/listens only on this computer/)).toBeVisible();
  await expect(section.getByText(`sprachanker serve --host 0.0.0.0 --port ${port}`)).toBeVisible();
  await section.getByRole("button", { name: "QR code" }).click();
  const qr = section.getByRole("img", { name: `QR code for http://localhost:${port}` });
  await expect(qr).toBeVisible();
  // Square, and wide enough for a camera; nothing scrolled sideways on a phone.
  const box = await qr.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(150);
  expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the side panel's “On a phone” opens the addresses beside (desktop; a phone has them in Settings)", async ({
  page,
}) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "On a phone" });
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await expect(button).toBeHidden();
    return;
  }
  await button.click();
  const sheet = page.getByRole("dialog", { name: "Other devices" });
  const port = new URL(page.url()).port;
  await expect(sheet.getByText(`http://localhost:${port}`, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});
