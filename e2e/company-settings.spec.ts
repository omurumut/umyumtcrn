import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function assertDisposableDatabase(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Company settings E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Company settings E2E disposable localhost DB ile eşleşmiyor.");
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
const pool = new Pool({ connectionString: assertDisposableDatabase() });

const credentials = {
  standardA1: requiredEnv("E2E_STANDARD_USERNAME"),
  adminA: requiredEnv("E2E_ADMIN_USERNAME"),
  kontrolAdminA: requiredEnv("E2E_KONTROL_ADMIN_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type LoginResult = {
  token: string;
  user: {
    id: number;
    username: string;
    role: string;
    companyId: number;
    unitId: number | null;
  };
};

type FixtureIds = {
  companyA: number;
  companyB: number;
};

let ids: FixtureIds;

function authorization(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function login(request: APIRequestContext, username: string): Promise<LoginResult> {
  const response = await request.post("/api/auth/login", {
    data: { username, password: credentials.password },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as LoginResult;
}

async function loginUi(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
}

async function chooseSelectOption(page: Page, testId: string, name: string | RegExp): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name }).click();
}

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<{ company_a: number; company_b: number }>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS company_a,
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AS company_b
  `);
  const row = result.rows[0];
  if (!row || !Number.isSafeInteger(row.company_a) || !Number.isSafeInteger(row.company_b)) {
    throw new Error("Company settings fixture kimlikleri çözülemedi.");
  }
  return { companyA: row.company_a, companyB: row.company_b };
}

async function resetCompanySettings(): Promise<void> {
  await pool.query("DELETE FROM company_settings WHERE company_id IN ($1, $2)", [ids.companyA, ids.companyB]);
  await pool.query("DELETE FROM audit_events WHERE action IN ('company_settings.created', 'company_settings.updated')");
}

async function settingsRowCount(companyId: number): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM company_settings WHERE company_id=$1", [companyId]);
  return Number(result.rows[0]?.count ?? 0);
}

test.beforeAll(async () => {
  ids = await resolveFixtureIds();
});

test.beforeEach(async () => {
  await resetCompanySettings();
});

test.afterAll(async () => {
  await pool.end();
});

test("COMPANY-SETTINGS-SCHEMA migration tablo, FK ve unique constraint oluşturur", async () => {
  const table = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name='company_settings'");
  expect(table.rows[0]?.count).toBe("1");

  const columns = await pool.query<{ column_name: string; is_nullable: string }>(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name='company_settings'
  `);
  expect(columns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
    "company_id",
    "default_locale",
    "default_currency",
    "fiscal_year_start_month",
    "date_format",
    "decimal_separator",
    "energy_display_unit",
    "tep_display_mode",
    "co2_display_mode",
    "settings_version",
    "updated_by",
  ]));

  const constraints = await pool.query<{ conname: string; contype: string }>(`
    SELECT conname, contype
    FROM pg_constraint
    WHERE conrelid = 'company_settings'::regclass
  `);
  expect(constraints.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ contype: "f" }),
    expect.objectContaining({ contype: "p" }),
  ]));
  const uniqueIndexes = await pool.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename='company_settings'");
  expect(uniqueIndexes.rows.map((row) => row.indexname)).toContain("company_settings_company_id_unique");
  expect(await settingsRowCount(ids.companyA)).toBe(0);
});

test("COMPANY-SETTINGS-API GET tenant scope, default response ve lazy-create davranışını uygular", async ({ request }) => {
  expect((await request.get("/api/company-settings")).status()).toBe(401);

  const standard = await login(request, credentials.standardA1);
  expect((await request.get("/api/company-settings", { headers: authorization(standard.token) })).status()).toBe(403);

  const admin = await login(request, credentials.adminA);
  const adminHeaders = authorization(admin.token);
  const beforeCount = await settingsRowCount(ids.companyA);
  const adminResponse = await request.get("/api/company-settings", { headers: adminHeaders });
  expect(adminResponse.status()).toBe(200);
  const adminBody = await adminResponse.json();
  expect(adminBody).toMatchObject({
    settings: {
      companyId: ids.companyA,
      defaultLocale: "tr-TR",
      defaultCurrency: "TRY",
      fiscalYearStartMonth: 1,
      dateFormat: "DD.MM.YYYY",
      decimalSeparator: "comma",
      energyDisplayUnit: "auto",
      tepDisplayMode: "auto",
      co2DisplayMode: "tonne",
      settingsVersion: 0,
      createdAt: null,
      updatedAt: null,
    },
    permissions: { canEdit: true },
    isDefault: true,
  });
  expect(await settingsRowCount(ids.companyA)).toBe(beforeCount);
  expect((await request.get(`/api/company-settings?companyId=${ids.companyB}`, { headers: adminHeaders })).status()).toBe(400);

  const kontrol = await login(request, credentials.kontrolAdminA);
  const kontrolResponse = await request.get("/api/company-settings", { headers: authorization(kontrol.token) });
  expect(kontrolResponse.status()).toBe(200);
  expect(await kontrolResponse.json()).toMatchObject({ settings: { companyId: ids.companyA }, permissions: { canEdit: false }, isDefault: true });

  const superadmin = await login(request, credentials.superadmin);
  const superHeaders = authorization(superadmin.token);
  expect((await request.get("/api/company-settings", { headers: superHeaders })).status()).toBe(400);
  expect((await request.get("/api/company-settings?companyId=abc", { headers: superHeaders })).status()).toBe(400);
  expect((await request.get("/api/company-settings?companyId=99999999", { headers: superHeaders })).status()).toBe(404);

  const superResponse = await request.get(`/api/company-settings?companyId=${ids.companyB}`, { headers: superHeaders });
  expect(superResponse.status()).toBe(200);
  expect(await superResponse.json()).toMatchObject({ settings: { companyId: ids.companyB, settingsVersion: 0 }, permissions: { canEdit: true }, isDefault: true });
});

test("COMPANY-SETTINGS-API PATCH yetki, validation ve tenant sınırlarını uygular", async ({ request }) => {
  expect((await request.patch("/api/company-settings", { data: { expectedSettingsVersion: 0, defaultLocale: "tr-TR" } })).status()).toBe(401);

  const standard = await login(request, credentials.standardA1);
  expect((await request.patch("/api/company-settings", {
    headers: authorization(standard.token),
    data: { expectedSettingsVersion: 0, defaultLocale: "tr-TR" },
  })).status()).toBe(403);

  const kontrol = await login(request, credentials.kontrolAdminA);
  expect((await request.patch("/api/company-settings", {
    headers: authorization(kontrol.token),
    data: { expectedSettingsVersion: 0, defaultLocale: "tr-TR" },
  })).status()).toBe(403);

  const admin = await login(request, credentials.adminA);
  const headers = authorization(admin.token);
  const invalidBodies = [
    {},
    { expectedSettingsVersion: 0, unknown: true },
    { expectedSettingsVersion: 0, companyId: ids.companyB },
    { expectedSettingsVersion: 0, defaultLocale: "de-DE" },
    { expectedSettingsVersion: 0, defaultCurrency: "JPY" },
    { expectedSettingsVersion: 0, fiscalYearStartMonth: 0 },
    { expectedSettingsVersion: 0, fiscalYearStartMonth: 13 },
    { expectedSettingsVersion: 0, dateFormat: "MM/DD/YYYY" },
    { expectedSettingsVersion: 0, decimalSeparator: "space" },
    { expectedSettingsVersion: 0, energyDisplayUnit: "BTU" },
    { expectedSettingsVersion: 0, tepDisplayMode: "toe" },
    { expectedSettingsVersion: 0, co2DisplayMode: "pound" },
    { expectedSettingsVersion: 0, tepCoefficient: 0.99 },
  ];
  for (const data of invalidBodies) {
    const response = await request.patch("/api/company-settings", { headers, data });
    expect(response.status(), JSON.stringify(data)).toBe(400);
  }
  expect((await request.patch(`/api/company-settings?companyId=${ids.companyB}`, {
    headers,
    data: { expectedSettingsVersion: 0, defaultLocale: "en-US" },
  })).status()).toBe(400);
  expect(await settingsRowCount(ids.companyB)).toBe(0);
});

test("COMPANY-SETTINGS-API create/update concurrency, audit ve tenant izolasyonunu korur", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const headers = authorization(admin.token);

  const create = await request.patch("/api/company-settings", {
    headers,
    data: {
      expectedSettingsVersion: 0,
      defaultLocale: "en-US",
      defaultCurrency: "EUR",
      fiscalYearStartMonth: 4,
      dateFormat: "YYYY-MM-DD",
      decimalSeparator: "dot",
      energyDisplayUnit: "MWh",
      tepDisplayMode: "kgep",
      co2DisplayMode: "kg",
    },
  });
  expect(create.status()).toBe(200);
  const createBody = await create.json();
  expect(createBody).toMatchObject({
    settings: {
      companyId: ids.companyA,
      defaultLocale: "en-US",
      defaultCurrency: "EUR",
      fiscalYearStartMonth: 4,
      settingsVersion: 1,
    },
    isDefault: false,
  });
  expect(await settingsRowCount(ids.companyA)).toBe(1);
  expect(await settingsRowCount(ids.companyB)).toBe(0);

  const staleCreate = await request.patch("/api/company-settings", {
    headers,
    data: { expectedSettingsVersion: 0, defaultLocale: "tr-TR" },
  });
  expect(staleCreate.status()).toBe(409);

  const staleUpdate = await request.patch("/api/company-settings", {
    headers,
    data: { expectedSettingsVersion: 1, defaultCurrency: "USD" },
  });
  expect(staleUpdate.status()).toBe(200);
  const updateBody = await staleUpdate.json();
  expect(updateBody.settings.settingsVersion).toBe(2);

  const conflict = await request.patch("/api/company-settings", {
    headers,
    data: { expectedSettingsVersion: 1, defaultCurrency: "GBP" },
  });
  expect(conflict.status()).toBe(409);

  const persisted = await request.get("/api/company-settings", { headers });
  const persistedBody = await persisted.json();
  expect(persistedBody.settings.defaultCurrency).toBe("USD");
  expect(persistedBody.settings.settingsVersion).toBe(2);

  const audit = await pool.query<{ action: string; company_id: number; actor_user_id: number; changes_json: { changedFields?: string[] } }>(`
    SELECT action, company_id, actor_user_id, changes_json
    FROM audit_events
    WHERE action IN ('company_settings.created', 'company_settings.updated') AND company_id=$1
    ORDER BY id
  `, [ids.companyA]);
  expect(audit.rows.map((row) => row.action)).toEqual(["company_settings.created", "company_settings.updated"]);
  expect(audit.rows[0]?.actor_user_id).toBe(admin.user.id);
  expect(audit.rows[0]?.changes_json.changedFields).toEqual(expect.arrayContaining(["defaultLocale", "defaultCurrency"]));

  const failedAudit = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM audit_events
    WHERE action IN ('company_settings.created', 'company_settings.updated') AND company_id=$1
  `, [ids.companyB]);
  expect(failedAudit.rows[0]?.count).toBe("0");
});

test("COMPANY-SETTINGS-API paralel ilk create duplicate satır üretmez", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const headers = authorization(admin.token);
  const payload = { expectedSettingsVersion: 0, defaultLocale: "en-US" };

  const [first, second] = await Promise.all([
    request.patch("/api/company-settings", { headers, data: payload }),
    request.patch("/api/company-settings", { headers, data: payload }),
  ]);
  expect([first.status(), second.status()].sort()).toEqual([200, 409]);
  expect(await settingsRowCount(ids.companyA)).toBe(1);
});

test("COMPANY-SETTINGS-API superadmin seçili şirket ayarlarını yönetir", async ({ request }) => {
  const superadmin = await login(request, credentials.superadmin);
  const headers = authorization(superadmin.token);
  expect((await request.patch("/api/company-settings", {
    headers,
    data: { expectedSettingsVersion: 0, defaultLocale: "en-US" },
  })).status()).toBe(400);

  const response = await request.patch(`/api/company-settings?companyId=${ids.companyB}`, {
    headers,
    data: { expectedSettingsVersion: 0, defaultCurrency: "GBP" },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.settings.companyId).toBe(ids.companyB);
  expect(body.settings.defaultCurrency).toBe("GBP");
  expect(await settingsRowCount(ids.companyA)).toBe(0);
  expect(await settingsRowCount(ids.companyB)).toBe(1);
});

test("COMPANY-SETTINGS-UI admin düzenler, ön izleme güncellenir ve genel form dirty state'i korunur", async ({ page }) => {
  await loginUi(page, credentials.adminA);
  await page.goto("/firma-ayarlari");
  await expect(page.getByRole("heading", { name: "Firma Ayarları" })).toBeVisible();
  await page.getByTestId("company-legal-name-input").fill("[E2E] Dirty General");
  await expect(page.getByText("Kaydedilmemiş değişiklik var.")).toBeVisible();

  await page.getByTestId("company-localization-tab").click();
  await expect(page.getByTestId("company-settings-form")).toBeVisible();
  await expect(page.getByTestId("company-settings-version")).toContainText("0");
  await expect(page.getByTestId("settings-preview-date")).toHaveText("18.07.2026");

  await chooseSelectOption(page, "settings-default-locale-select", "en-US");
  await chooseSelectOption(page, "settings-default-currency-select", "USD");
  await chooseSelectOption(page, "settings-fiscal-year-start-month-select", "Nisan");
  await chooseSelectOption(page, "settings-date-format-select", "YYYY-MM-DD");
  await chooseSelectOption(page, "settings-decimal-separator-select", "dot");
  await chooseSelectOption(page, "settings-energy-display-unit-select", "GJ");
  await chooseSelectOption(page, "settings-tep-display-mode-select", "kgep");
  await chooseSelectOption(page, "settings-co2-display-mode-select", "kg");
  await expect(page.getByTestId("settings-preview-date")).toHaveText("2026-07-18");
  await expect(page.getByTestId("settings-preview-currency")).toContainText("$");
  await expect(page.getByTestId("settings-preview-energy")).toContainText("GJ");
  await expect(page.getByTestId("settings-preview-tep")).toContainText("kgep");
  await expect(page.getByTestId("settings-preview-co2")).toContainText("kgCO2");

  await page.getByTestId("company-settings-save-button").click();
  await expect(page.getByText("Firma tercihleri güncellendi.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("company-settings-version")).toContainText("1");

  await page.getByTestId("company-general-tab").click();
  await expect(page.getByText("Kaydedilmemiş değişiklik var.")).toBeVisible();
  await expect(page.getByTestId("company-legal-name-input")).toHaveValue("[E2E] Dirty General");
});

test("COMPANY-SETTINGS-UI kontrol_admin salt okunur, standard erişemez", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await expect(page.locator('a[href="/firma-ayarlari"]')).toHaveCount(0);
  await page.goto("/firma-ayarlari");
  await expect(page).toHaveURL(/\/$/);

  await loginUi(page, credentials.kontrolAdminA);
  await page.goto("/firma-ayarlari");
  await page.getByTestId("company-localization-tab").click();
  await expect(page.getByText("Salt okunur tercihler")).toBeVisible();
  await expect(page.getByTestId("settings-default-locale-select")).toHaveAttribute("data-disabled");
  await expect(page.getByTestId("company-settings-save-button")).toHaveCount(0);
});

test("COMPANY-SETTINGS-UI superadmin şirket seçmeden request atmaz ve şirket değişince form resetlenir", async ({ page }) => {
  let settingsRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/company-settings")) settingsRequests += 1;
  });

  await loginUi(page, credentials.superadmin);
  await page.goto("/firma-ayarlari");
  await expect(page.getByTestId("company-settings-select-company")).toBeVisible();
  expect(settingsRequests).toBe(0);

  await chooseSelectOption(page, "company-context-select", "[E2E] Tenant A");
  await page.getByTestId("company-localization-tab").click();
  await expect(page.getByTestId("company-settings-form")).toBeVisible();
  await chooseSelectOption(page, "settings-default-currency-select", "EUR");
  await expect(page.getByText("Kaydedilmemiş tercih var.")).toBeVisible();

  await chooseSelectOption(page, "company-context-select", "[E2E] Tenant B");
  await expect(page.getByTestId("company-settings-form")).toBeVisible();
  await expect(page.getByTestId("company-settings-version")).toContainText("0");
  await expect(page.getByText("Kaydedilmemiş tercih var.")).toHaveCount(0);
  expect(settingsRequests).toBeGreaterThanOrEqual(2);
});
