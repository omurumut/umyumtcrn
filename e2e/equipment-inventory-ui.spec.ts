import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime degeri zorunludur.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Equipment UI E2E yalniz disposable test DB uzerinde calisir.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test") {
    throw new Error("Equipment UI E2E baglantisi disposable localhost DB ile eslesmiyor.");
  }
  return rawUrl;
}

type QueryResult<Row> = { rows: Row[]; rowCount: number | null };
type TestPool = {
  query<Row>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};

const scriptsRequire = createRequire(resolve(process.cwd(), "scripts/package.json"));
const { Pool } = scriptsRequire("pg") as {
  Pool: new (options: { connectionString: string }) => TestPool;
};
const pool = new Pool({ connectionString: disposableDatabaseUrl() });

const credentials = {
  admin: requiredEnv("E2E_ADMIN_USERNAME"),
  standard: requiredEnv("E2E_STANDARD_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type FixtureIds = {
  companyA: number;
  unitA1: number;
  unitA1Name: string;
};

let ids: FixtureIds;

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<FixtureIds>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS "companyA",
      (SELECT id FROM units WHERE name = '[E2E] Unit A1') AS "unitA1",
      (SELECT name FROM units WHERE name = '[E2E] Unit A1') AS "unitA1Name"
  `);
  const row = result.rows[0];
  if (!row?.companyA || !row.unitA1 || !row.unitA1Name) throw new Error("Equipment UI fixture kimlikleri cozulemedi.");
  return row;
}

async function cleanupEquipment() {
  const rows = await pool.query<{ id: number }>("SELECT id FROM equipment WHERE equipment_code LIKE 'F3D2-%'");
  const idsToDelete = rows.rows.map((row) => row.id);
  if (idsToDelete.length === 0) return;
  await pool.query("DELETE FROM equipment_meter_links WHERE equipment_id = ANY($1::int[])", [idsToDelete]);
  await pool.query("DELETE FROM equipment_energy_source_links WHERE equipment_id = ANY($1::int[])", [idsToDelete]);
  await pool.query("DELETE FROM equipment WHERE id = ANY($1::int[])", [idsToDelete]);
}

async function loginUi(page: Page, username: string) {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => localStorage.getItem("eys_token") !== null);
}

async function chooseSelect(page: Page, testId: string, optionName: string | RegExp) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionName }).click();
}

test.beforeAll(async () => {
  ids = await resolveFixtureIds();
  await cleanupEquipment();
});

test.afterAll(async () => {
  await cleanupEquipment();
  await pool.end();
});

test.describe.serial("equipment inventory UI", () => {
  test("admin ekipman olusturur, listeler, duzenler ve arsivler", async ({ page }) => {
    const code = `F3D2-ADMIN-${Date.now()}`;
    await loginUi(page, credentials.admin);
    await page.goto("/equipment");
    await expect(page.getByTestId("equipment-page")).toBeVisible();
    await expect(page.locator('a[href="/equipment"]')).toBeVisible();

    await page.getByTestId("equipment-create-button").click();
    await page.locator("#equipment-code").fill(code);
    await page.locator("#equipment-name").fill("Faz 3D.2 UI Pompa");
    await chooseSelect(page, "equipment-form-unit", ids.unitA1Name);
    await page.locator("#equipment-installed-power").fill("0");
    await page.getByRole("button", { name: "Oluştur" }).click();

    const createdRow = page.getByTestId("equipment-row").filter({ hasText: code });
    await expect(createdRow).toBeVisible();
    await expect(createdRow.getByText("Faz 3D.2 UI Pompa")).toBeVisible();
    await expect(page.getByText("0 kW").first()).toBeVisible();

    await page.getByRole("button", { name: `${code} detay` }).click();
    await page.getByRole("button", { name: "Düzenle", exact: true }).click();
    await page.locator("#equipment-name").fill("Faz 3D.2 UI Pompa Güncel");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByTestId("equipment-row").filter({ hasText: "Güncel" })).toBeVisible();

    await page.getByRole("button", { name: `${code} arşivle` }).click();
    await page.getByRole("button", { name: "Arşivle" }).click();
    await expect(page.getByTestId("equipment-row").filter({ hasText: code })).toHaveCount(0);
    await page.getByLabel("Arşivlileri dahil et").click();
    await expect(page.getByTestId("equipment-row").filter({ hasText: code })).toBeVisible();
  });

  test("standard kullanici kendi unitinde olusturur ve arsiv aksiyonu gormez", async ({ page }) => {
    const code = `F3D2-STD-${Date.now()}`;
    await loginUi(page, credentials.standard);
    await page.goto("/equipment");
    await page.getByTestId("equipment-create-button").click();
    await expect(page.getByTestId("equipment-form-unit")).toHaveCount(0);
    await page.locator("#equipment-code").fill(code);
    await page.locator("#equipment-name").fill("Standard ekipman");
    await page.getByRole("button", { name: "Oluştur" }).click();
    await expect(page.getByTestId("equipment-row").filter({ hasText: code })).toBeVisible();
    await expect(page.getByRole("button", { name: `${code} arşivle` })).toHaveCount(0);
  });

  test("superadmin company context olmadan ekipman requesti uretmez", async ({ page }) => {
    const equipmentRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/equipment")) equipmentRequests.push(request.url());
    });
    await loginUi(page, credentials.superadmin);
    await page.goto("/equipment");
    await expect(page.getByTestId("equipment-context-required")).toBeVisible();
    expect(equipmentRequests).toHaveLength(0);
  });

  test("mobil viewport temel kullanim smoke", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginUi(page, credentials.admin);
    await page.goto("/equipment");
    await expect(page.getByTestId("equipment-page")).toBeVisible();
    await expect(page.getByTestId("equipment-create-button")).toBeVisible();
  });
});
