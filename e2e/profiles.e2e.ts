// A device signed in to no profile: who is studying in the language chosen there, a new profile (named
// in the onboarding's first step), its onboarding to Courses → Downloaded, cancelled or deleted again.
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("a new profile: who is studying, then the onboarding step by step to Courses", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Who is studying?" })).toBeVisible();
  // The interface language first: chosen here, kept on this device over a reload.
  await page.getByRole("combobox", { name: "Interface language" }).click();
  await page.getByRole("option", { name: "Русский" }).click();
  await expect(page.getByRole("heading", { name: "Кто занимается?" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Кто занимается?" })).toBeVisible();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(page.getByRole("button", { name: /E2E/ })).toBeVisible();
  // New profile opens the onboarding; Cancel returns while the profile is not made yet.
  await page.getByRole("button", { name: /New profile/ }).click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Who is studying?" })).toBeVisible();
  await page.getByRole("button", { name: /New profile/ }).click();
  // Welcome: where the courses come from, experimental sources off; the name and colour.
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.getByText(/downloaded straight from their publishers/)).toBeVisible();
  await expect(page.getByText(/Settings → General → Experimental/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Interface language" })).toHaveCount(0);
  const name = page.getByRole("textbox", { name: "Name or nickname" });
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await name.fill(" ");
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await name.fill("Mila");
  await page.getByRole("button", { name: "Teal" }).click();
  // Next makes the profile and signs in; the onboarding goes on at the assistant, not from the start.
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "AI assistant" })).toBeVisible();
  await expect(page.getByRole("button", { name: /OpenRouter/ })).toBeVisible();
  const session = (await (await page.request.get("/api/session")).json()) as {
    profile: { name: string; colour: string; onboarded: boolean };
  };
  expect(session.profile).toMatchObject({ name: "Mila", colour: "teal", onboarded: false });
  // Back to the name: the profile's own, changed in place; Cancel there would delete it.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(name).toHaveValue("Mila");
  await expect(page.getByRole("button", { name: "Teal" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "AI assistant" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  // Speaking: as Settings → Speech — the microphone test, the recogniser, reading aloud.
  await expect(page.getByRole("heading", { name: "Speaking" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record yourself" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recognition", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Read aloud", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Where things are" })).toBeVisible();
  await page.getByRole("button", { name: "Choose a course" }).click();
  // Courses → Downloaded (there are courses here), no filter stored: the interface language's.
  await expect(page).toHaveURL(/\/downloaded$/);
  await expect(page.getByRole("link", { name: /Downloaded/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const settings = async () =>
    (await (await page.request.get("/api/settings")).json()) as Record<string, unknown>;
  const set = await settings();
  expect([set["catalog.pair"], set["mine.pair"]]).toEqual([undefined, undefined]);
  // The profile keeps the interface language on screen.
  await expect.poll(async () => (await settings()).uiLanguage).toBe("en");

  // Deleted again from Settings, after asking: back to who is studying, where it is no more.
  await page.goto("/settings#profile");
  await page.getByRole("button", { name: "Delete profile…" }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("Delete the profile “Mila”?");
  await ask.getByRole("button", { name: "Delete for good" }).click();
  await expect(page.getByRole("heading", { name: "Who is studying?" })).toBeVisible();
});

test.describe("with a German browser", () => {
  test.use({ locale: "de-DE" });
  test("a device signed in to nothing shows the browser's language", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wer lernt?");
  });
});

test("a profile made in the onboarding is cancelled from its first step: deleted, back to who is studying", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New profile/ }).click();
  await page.getByRole("textbox", { name: "Name or nickname" }).fill("Gone");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "AI assistant" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Who is studying?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Gone/ })).toHaveCount(0);
});
