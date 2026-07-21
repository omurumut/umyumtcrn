import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime degeri zorunludur.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Equipment lifecycle UI E2E yalniz disposable test DB uzerinde calisir.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Equipment lifecycle UI E2E disposable localhost DB ile eslesmiyor.");
  }
  return rawUrl;
}

type QueryResult<Row> = { rows: Row[]; rowCount: number | null };
type TestPool = {
  query<Row>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};

const scriptsRequire = createRequire(resolve(process.cwd(), "scripts/package.json"));
const { Pool } = scriptsRequire("pg") as { Pool: new (options: { connectionString: string }) => TestPool };
const pool = new Pool({ connectionString: disposableDatabaseUrl() });

const credentials = {
  admin: requiredEnv("E2E_ADMIN_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type FixtureIds = { companyA: number; unitA1: number; unitA1Name: string };
let ids: FixtureIds;

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<FixtureIds>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS "companyA",
      (SELECT id FROM units WHERE name = '[E2E] Unit A1') AS "unitA1",
      (SELECT name FROM units WHERE name = '[E2E] Unit A1') AS "unitA1Name"
  `);
  const row = result.rows[0];
  if (!row?.companyA || !row.unitA1 || !row.unitA1Name) throw new Error("Equipment lifecycle UI fixture kimlikleri cozulemedi.");
  return row;
}

async function cleanup() {
  const rows = await pool.query<{ id: number }>("SELECT id FROM equipment WHERE equipment_code LIKE 'F3D5-UI-%'");
  const idsToDelete = rows.rows.map((row) => row.id);
  if (idsToDelete.length === 0) return;
  await pool.query("DELETE FROM equipment_meter_links WHERE equipment_id = ANY($1::int[])", [idsToDelete]);
  await pool.query("DELETE FROM equipment_energy_source_links WHERE equipment_id = ANY($1::int[])", [idsToDelete]);
  await pool.query("DELETE FROM audit_events WHERE entity_type='equipment' AND entity_id = ANY($1::text[])", [idsToDelete.map(String)]);
  await pool.query("DELETE FROM equipment WHERE id = ANY($1::int[])", [idsToDelete]);
}

async function loginUi(page: Page, username: string) {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => localStorage.getItem("eys_token") !== null);
}

async function loginApi(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", { data: { username: credentials.admin, password: credentials.password } });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}

function authorization(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function chooseSelect(page: Page, testId: string, optionName: string | RegExp) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionName }).click();
}

test.beforeAll(async () => {
  ids = await resolveFixtureIds();
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
  await pool.end();
});

test.describe.serial("equipment lifecycle and audit UI", () => {
  test("lifecycle warning, archive reason ve history gorunur", async ({ page }) => {
    const code = `F3D5-UI-LIFE-${Date.now()}`;
    await loginUi(page, credentials.admin);
    await page.goto("/equipment");
    await page.getByTestId("equipment-create-button").click();
    await page.locator("#equipment-code").fill(code);
    await page.locator("#equipment-name").fill("Faz 3D.5 UI lifecycle");
    await chooseSelect(page, "equipment-form-unit", ids.unitA1Name);
    await page.locator("#equipment-purchase-date").fill("2025-01-01");
    await page.locator("#equipment-commissioning-date").fill("2024-12-31");
    await expect(page.getByTestId("equipment-lifecycle-warnings")).toContainText("Devreye alma");
    await page.getByRole("button", { name: "Oluştur" }).click();

    await expect(page.getByTestId("equipment-row").filter({ hasText: code })).toBeVisible();
    await expect(page.getByTestId("equipment-audit-history")).toBeVisible();
    await expect(page.getByTestId("equipment-audit-event").first()).toContainText("Oluşturuldu");

    await page.getByRole("button", { name: `${code} arşivle` }).click();
    await expect(page.getByRole("button", { name: "Arşivle" })).toBeDisabled();
    await page.locator("#equipment-archive-reason").fill("UI lifecycle archive");
    await page.getByRole("button", { name: "Arşivle" }).click();
    await page.getByLabel("Arşivlileri dahil et").click();
    await expect(page.getByTestId("equipment-row").filter({ hasText: code })).toBeVisible();
    await page.getByRole("button", { name: `${code} detay` }).click();
    await expect(page.getByText("Salt okunur")).toBeVisible();
    await expect(page.getByTestId("equipment-audit-history")).toContainText("Arşivlendi");
  });

  test("aktif child bulunan parent archive hatasi dialogda gorunur", async ({ page, request }) => {
    const token = await loginApi(request);
    const suffix = Date.now();
    const parentRes = await request.post("/api/equipment", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, equipmentCode: `F3D5-UI-PARENT-${suffix}`, name: "UI parent", category: "pump" },
    });
    expect(parentRes.status()).toBe(201);
    const parent = await parentRes.json();
    const childRes = await request.post("/api/equipment", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, equipmentCode: `F3D5-UI-CHILD-${suffix}`, name: "UI child", category: "pump", parentEquipmentId: parent.equipment.id },
    });
    expect(childRes.status()).toBe(201);

    await loginUi(page, credentials.admin);
    await page.goto("/equipment");
    await page.locator("#equipment-search").fill(`F3D5-UI-PARENT-${suffix}`);
    await expect(page.getByTestId("equipment-row").filter({ hasText: `F3D5-UI-PARENT-${suffix}` })).toBeVisible();
    await page.getByRole("button", { name: `F3D5-UI-PARENT-${suffix} arşivle` }).click();
    await page.locator("#equipment-archive-reason").fill("UI parent archive");
    await page.getByRole("button", { name: "Arşivle" }).click();
    await expect(page.getByLabel("Ekipman arşivlensin mi?").getByText(/aktif alt ekipman/i)).toBeVisible();
  });
});
