// A device signed in to no profile: who is studying in the language chosen there, a new profile (named
// first), its onboarding to Courses → Available, and deleting it again.
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("a new profile: who is studying, then the onboarding step by step to Courses", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Who is studying?" })).toBeVisible();
  // The interface language first: chosen here, kept on this device over a reload.
  await page.getByRole("button", { name: "Русский" }).click();
  await expect(page.getByRole("heading", { name: "Кто занимается?" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Кто занимается?" })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: /E2E/ })).toBeVisible();
  // A new profile is named before it is made.
  await page.getByRole("button", { name: /New profile/ }).click();
  const create = page.getByRole("button", { name: "Create" });
  await expect(create).toBeDisabled();
  await page.getByRole("textbox", { name: "Name or nickname" }).fill("Mila");
  await create.click();
  // Welcome, with where the courses come from.
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.getByText(/downloaded straight from their publishers/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  // The name stays required.
  const name = page.getByRole("textbox", { name: "Name or nickname" });
  await expect(name).toHaveValue("Mila");
  await name.fill(" ");
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await name.fill("Mila");
  await page.getByRole("button", { name: "Teal" }).click();
  // No signing-in step (profiles are chosen, not unlocked), no languages: the assistant next.
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "AI assistant" })).toBeVisible();
  await expect(page.getByRole("button", { name: /OpenRouter/ })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  // Speaking: the microphone test and the recogniser, as in Settings → Speech.
  await expect(page.getByRole("heading", { name: "Speaking" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record yourself" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Where things are" })).toBeVisible();
  await page.getByRole("button", { name: "Choose a course" }).click();
  // Courses → Available, every course: no filter set.
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByRole("link", { name: /Available/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const settings = (await (await page.request.get("/api/settings")).json()) as Record<
    string,
    unknown
  >;
  expect([settings["catalog.pair"], settings["mine.pair"]]).toEqual([undefined, undefined]);
  // The profile keeps the interface language: a reload stays in it.
  expect(settings.uiLanguage).toBe("en");

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
