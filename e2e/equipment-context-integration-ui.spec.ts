import { expect, test, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime degeri zorunludur.`);
  return value;
}

const credentials = {
  admin: requiredEnv("E2E_ADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

async function loginUi(page: Page, username: string) {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => localStorage.getItem("eys_token") !== null);
}

test("equipment context dashboard ve energy review kartlarinda gorunur", async ({ page }) => {
  await loginUi(page, credentials.admin);
  await page.goto("/");
  await expect(page.getByTestId("dashboard-equipment-context")).toBeVisible();

  await page.goto("/enerji-gozden-gecirme");
  await expect(page.getByTestId("energy-review-equipment-context")).toBeVisible();
});

test("AI onerileri equipment readiness metadata kartini gosterir", async ({ page }) => {
  await loginUi(page, credentials.admin);
  await page.goto("/oneriler");
  await page.getByRole("button").filter({ hasText: /onerileri|önerileri|yenile/i }).click();
  await expect(page.getByTestId("ai-equipment-readiness")).toBeVisible();
});
