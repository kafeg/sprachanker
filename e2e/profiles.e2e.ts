// A device signed in to no profile: who is studying, a new profile and its onboarding to Courses → Available.
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("a new profile: who is studying, then the onboarding step by step to Courses", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Who is studying?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E/ })).toBeVisible();
  await page.getByRole("button", { name: /New profile/ }).click();
  // Welcome, with where the courses come from.
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.getByText(/downloaded straight from their publishers/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("textbox", { name: "Name or nickname" }).fill("Mila");
  await page.getByRole("button", { name: "Teal" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  // Languages: own Russian, learn German (the fixture course teaches ru-de).
  await expect(page.getByRole("heading", { name: "Your languages" })).toBeVisible();
  await page
    .getByRole("group", { name: /Your language/ })
    .getByRole("button", { name: /Russian|Русский/ })
    .click();
  await expect(
    page.getByRole("group", { name: "Language to learn" }).getByRole("button", { name: /German/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Signing in" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "AI assistant" })).toBeVisible();
  await expect(page.getByRole("button", { name: /OpenRouter/ })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Where things are" })).toBeVisible();
  await page.getByRole("button", { name: "Choose a course" }).click();
  // Courses → Available, filtered by the pair chosen.
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByRole("link", { name: /Available/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
