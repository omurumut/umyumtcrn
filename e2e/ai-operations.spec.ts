import { expect, test, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime degeri zorunludur.`);
  return value;
}

const credentials = {
  admin: requiredEnv("E2E_ADMIN_USERNAME"),
  standard: requiredEnv("E2E_STANDARD_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

async function loginUi(page: Page, username: string) {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => localStorage.getItem("eys_token") !== null);
}

test("admin AI operations route summary ve maliyet uyarisi render eder", async ({ page }) => {
  await loginUi(page, credentials.admin);
  await page.goto("/admin/ai-operations");
  await expect(page.getByTestId("ai-operations-page")).toBeVisible();
  await expect(page.getByText("AI Operasyonlari", { exact: true })).toBeVisible();
  await expect(page.getByText("Tahmini API maliyeti", { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/GEMINI_API_KEY|api_key|provider_request_id/i);
});

test("standard user AI operations menusu ve route erisimi alamaz", async ({ page }) => {
  await loginUi(page, credentials.standard);
  await expect(page.getByText("AI Operasyonlari", { exact: true })).toHaveCount(0);
  await page.goto("/admin/ai-operations");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("ai-operations-page")).toHaveCount(0);
});

test("superadmin firma bazli AI kullanimini gorebilir", async ({ page }) => {
  await loginUi(page, credentials.superadmin);
  await page.goto("/admin/ai-operations");
  await expect(page.getByTestId("ai-operations-page")).toBeVisible();
  await expect(page.getByText("Firma bazli kullanim", { exact: true })).toBeVisible();
});
