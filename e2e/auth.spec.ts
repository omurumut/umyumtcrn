import { expect, test, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

const credentials = {
  admin: requiredEnv("E2E_ADMIN_USERNAME"),
  kontrolAdmin: requiredEnv("E2E_KONTROL_ADMIN_USERNAME"),
  standard: requiredEnv("E2E_STANDARD_USERNAME"),
  standardB: requiredEnv("E2E_STANDARD_B_USERNAME"),
  nullUnit: requiredEnv("E2E_NULL_UNIT_USERNAME"),
  inactive: requiredEnv("E2E_INACTIVE_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
};

async function openLogin(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#username")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
}

async function login(
  page: Page,
  username: string,
  password = credentials.password,
): Promise<void> {
  await openLogin(page);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
}

async function expectApplication(page: Page): Promise<void> {
  await expect(
    page.getByText("Enerji Yönetimi", { exact: true }).first(),
  ).toBeVisible();
}

test("admin login ve logout", async ({ page }) => {
  await login(page, credentials.admin);
  await expectApplication(page);
  await expect(page.locator('a[href="/ozet"]')).toBeVisible();
  await page.getByRole("button", { name: /E2E Admin A/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await expect(page.locator("#username")).toBeVisible();
});

test("kontrol_admin temel uygulamaya erişir", async ({ page }) => {
  await login(page, credentials.kontrolAdmin);
  await expectApplication(page);
  await expect(page.locator('a[href="/ozet"]')).toBeVisible();
});

test("standard kullanıcı temel role uygun menüyü görür", async ({ page }) => {
  await login(page, credentials.standard);
  await expectApplication(page);
  await expect(page.locator('a[href="/firmalar"]')).toHaveCount(0);
  await expect(page.locator('a[href="/ozet"]')).toHaveCount(0);
});

test("superadmin şirket yönetimi menüsünü görür", async ({ page }) => {
  await login(page, credentials.superadmin);
  await expectApplication(page);
  await expect(page.locator('a[href="/firmalar"]')).toBeVisible();
});

test("yanlış parola login işlemini reddeder", async ({ page }) => {
  await login(page, credentials.standard, `${credentials.password}-wrong`);
  await expect(page.locator("form p.text-destructive")).toBeVisible();
  await expect(page.getByText("Enerji Yönetimi", { exact: true })).toHaveCount(
    0,
  );
});

test("pasif kullanıcı doğru parola ile login olamaz", async ({ page }) => {
  await login(page, credentials.inactive);
  await expect(page.locator("form p.text-destructive")).toBeVisible();
  await expect(page.getByText("Enerji Yönetimi", { exact: true })).toHaveCount(
    0,
  );
});

test("Tenant B standard kullanıcı login olabilir", async ({ page }) => {
  await login(page, credentials.standardB);
  await expectApplication(page);
});

test("unitId null standard kullanıcı mevcut login davranışını korur", async ({
  page,
}) => {
  await login(page, credentials.nullUnit);
  await expectApplication(page);
});

test("oturumsuz korumalı route login ekranını gösterir", async ({ page }) => {
  await page.goto("/birimler");
  await expect(page.locator("#username")).toBeVisible();
  await expect(page.getByText("Enerji Yönetimi", { exact: true })).toHaveCount(
    0,
  );
});

test("reload sonrasında localStorage oturumu sürer", async ({ page }) => {
  await login(page, credentials.admin);
  await expectApplication(page);
  await page.reload();
  await expectApplication(page);
  await expect(page.locator('a[href="/ozet"]')).toBeVisible();
});
