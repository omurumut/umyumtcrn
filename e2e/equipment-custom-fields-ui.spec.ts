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
    throw new Error("Equipment custom fields UI E2E yalniz disposable test DB uzerinde calisir.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Equipment custom fields UI E2E disposable localhost DB ile eslesmiyor.");
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
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type FixtureIds = {
  companyA: number;
  unitA1Name: string;
};

let ids: FixtureIds;

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<FixtureIds>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS "companyA",
      (SELECT name FROM units WHERE name = '[E2E] Unit A1') AS "unitA1Name"
  `);
  const row = result.rows[0];
  if (!row?.companyA || !row.unitA1Name) throw new Error("Equipment custom fields UI fixture kimlikleri cozulemedi.");
  return row;
}

async function cleanup() {
  const equipmentRows = await pool.query<{ id: number }>("SELECT id FROM equipment WHERE equipment_code LIKE 'F3D4-UI-%'");
  const equipmentIds = equipmentRows.rows.map((row) => row.id);
  if (equipmentIds.length > 0) {
    await pool.query("DELETE FROM equipment_meter_links WHERE equipment_id = ANY($1::int[])", [equipmentIds]);
    await pool.query("DELETE FROM equipment_energy_source_links WHERE equipment_id = ANY($1::int[])", [equipmentIds]);
    await pool.query("DELETE FROM equipment WHERE id = ANY($1::int[])", [equipmentIds]);
  }
  await pool.query("DELETE FROM equipment_field_definitions WHERE code LIKE 'ui_cf_%'");
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
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
  await pool.end();
});

test.describe.serial("equipment custom fields UI", () => {
  test("admin ayarlarda alan tanimlar ve ekipman formunda deger kaydeder", async ({ page }) => {
    const suffix = Date.now().toString().slice(-8);
    const code = `ui_cf_note_${suffix}`;
    const label = "UI Equipment Note";
    const value = "Custom value from UI";
    const equipmentCode = `F3D4-UI-${suffix}`;

    await loginUi(page, credentials.admin);
    await page.goto("/firma-ayarlari");
    await page.getByTestId("company-equipment-fields-tab").click();
    await expect(page.getByTestId("equipment-fields-settings")).toBeVisible();

    await page.getByTestId("equipment-field-create").click();
    await page.locator("#equipment-field-label").fill(label);
    await page.locator("#equipment-field-code").fill(code);
    await page.locator("#equipment-field-description").fill("Visible on equipment form");
    await page.locator("#equipment-field-order").fill("3");
    await page.getByRole("button", { name: "Kaydet" }).click();

    await expect(page.getByText(code)).toBeVisible();
    await expect(page.getByText(label)).toBeVisible();

    await page.goto("/equipment");
    await page.getByTestId("equipment-create-button").click();
    await page.locator("#equipment-code").fill(equipmentCode);
    await page.locator("#equipment-name").fill("Faz 3D.4 UI ekipman");
    await chooseSelect(page, "equipment-form-unit", ids.unitA1Name);
    await expect(page.locator(`#equipment-custom-${code}`)).toBeVisible();
    await page.locator(`#equipment-custom-${code}`).fill(value);
    await page.getByRole("button", { name: /Olu/ }).click();

    const createdRow = page.getByTestId("equipment-row").filter({ hasText: equipmentCode });
    await expect(createdRow).toBeVisible();
    await page.getByRole("button", { name: `${equipmentCode} detay` }).click();
    await expect(page.getByText(label)).toBeVisible();
    await expect(page.getByText(value)).toBeVisible();
  });

  test("superadmin firma baglami olmadan equipment field requesti uretmez", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/equipment-field-definitions")) requests.push(request.url());
    });

    await loginUi(page, credentials.superadmin);
    await page.goto("/equipment");
    await expect(page.getByTestId("equipment-context-required")).toBeVisible();
    expect(requests).toHaveLength(0);
  });
});
