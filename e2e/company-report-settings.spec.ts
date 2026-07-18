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
    throw new Error("Company report settings E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Company report settings E2E disposable localhost DB ile eşleşmiyor.");
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

type LoginResult = { token: string; user: { id: number; role: string; companyId: number } };
type FixtureIds = { companyA: number; companyB: number };
let ids: FixtureIds;

function authorization(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function login(request: APIRequestContext, username: string): Promise<LoginResult> {
  const response = await request.post("/api/auth/login", { data: { username, password: credentials.password } });
  expect(response.status()).toBe(200);
  return (await response.json()) as LoginResult;
}

async function loginPage(page: Page, username: string) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
}

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<{ company_a: number; company_b: number }>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS company_a,
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AS company_b
  `);
  const row = result.rows[0];
  if (!row?.company_a || !row?.company_b) throw new Error("Company report settings fixture kimlikleri çözülemedi.");
  return { companyA: row.company_a, companyB: row.company_b };
}

async function resetReportSettings(): Promise<void> {
  await pool.query("DELETE FROM audit_events WHERE action LIKE 'company_report_%'");
  await pool.query("DELETE FROM company_report_section_settings WHERE company_id IN ($1, $2)", [ids.companyA, ids.companyB]);
  await pool.query("DELETE FROM company_report_type_settings WHERE company_id IN ($1, $2)", [ids.companyA, ids.companyB]);
  await pool.query("DELETE FROM company_report_profiles WHERE company_id IN ($1, $2)", [ids.companyA, ids.companyB]);
}

test.beforeAll(async () => {
  ids = await resolveFixtureIds();
});

test.beforeEach(async () => {
  await resetReportSettings();
});

test.afterAll(async () => {
  await pool.end();
});

test("COMPANY-REPORT-REGISTRY gerçek rapor türlerini ve schema tablolarını doğrular", async ({ request }) => {
  const tables = await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('company_report_profiles','company_report_type_settings','company_report_section_settings')
  `);
  expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
    "company_report_profiles",
    "company_report_section_settings",
    "company_report_type_settings",
  ]);

  const indexes = await pool.query<{ indexname: string }>(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename IN ('company_report_profiles','company_report_type_settings','company_report_section_settings')
  `);
  const indexSet = new Set(indexes.rows.map((row) => row.indexname));
  expect(indexSet.has("company_report_profiles_company_id_unique")).toBeTruthy();
  expect(indexSet.has("company_report_type_settings_company_report_type_unique")).toBeTruthy();
  expect(indexSet.has("company_report_section_settings_company_report_section_unique")).toBeTruthy();

  const admin = await login(request, credentials.adminA);
  const typesResponse = await request.get("/api/company-report-settings/types", { headers: authorization(admin.token) });
  expect(typesResponse.status()).toBe(200);
  const body = await typesResponse.json() as { reportTypes: Array<{ code: string; outputType: string }> };
  expect(body.reportTypes.map((item) => item.code).sort()).toEqual([
    "annual_energy_performance",
    "energy_performance_monitoring",
    "energy_targets_management",
  ]);
  expect(new Set(body.reportTypes.map((item) => item.code)).size).toBe(body.reportTypes.length);
  expect(body.reportTypes.every((item) => item.outputType === "pdf" || item.outputType === "html_data_url")).toBeTruthy();
});

test("COMPANY-REPORT-PROFILE rol, tenant, validation ve optimistic concurrency uygular", async ({ request }) => {
  expect((await request.get("/api/company-report-settings/profile")).status()).toBe(401);
  const standard = await login(request, credentials.standardA1);
  expect((await request.get("/api/company-report-settings/profile", { headers: authorization(standard.token) })).status()).toBe(403);

  const kontrol = await login(request, credentials.kontrolAdminA);
  expect((await request.get("/api/company-report-settings/profile", { headers: authorization(kontrol.token) })).status()).toBe(200);
  expect((await request.patch("/api/company-report-settings/profile", { headers: authorization(kontrol.token), data: { expectedProfileVersion: 0, defaultTitle: "x" } })).status()).toBe(403);

  const admin = await login(request, credentials.adminA);
  const getDefault = await request.get("/api/company-report-settings/profile", { headers: authorization(admin.token) });
  expect(getDefault.status()).toBe(200);
  expect((await getDefault.json() as { isDefault: boolean; profile: { profileVersion: number } }).isDefault).toBe(true);
  expect((await pool.query<{ count: number }>("SELECT count(*)::int count FROM company_report_profiles WHERE company_id=$1", [ids.companyA])).rows[0]?.count).toBe(0);

  expect((await request.patch("/api/company-report-settings/profile", { headers: authorization(admin.token), data: { expectedProfileVersion: 0, companyId: ids.companyB, defaultTitle: "x" } })).status()).toBe(400);
  expect((await request.patch("/api/company-report-settings/profile", { headers: authorization(admin.token), data: { expectedProfileVersion: 0, unknown: "x" } })).status()).toBe(400);
  expect((await request.patch("/api/company-report-settings/profile", { headers: authorization(admin.token), data: { expectedProfileVersion: 0, defaultLocale: "en-US" } })).status()).toBe(400);
  expect((await request.patch("/api/company-report-settings/profile", { headers: authorization(admin.token), data: { expectedProfileVersion: 0, confidentialityLevel: "secret" } })).status()).toBe(400);
  expect((await request.patch("/api/company-report-settings/profile", { headers: authorization(admin.token), data: { expectedProfileVersion: 0, coverStyle: "poster" } })).status()).toBe(400);
  expect((await request.patch("/api/company-report-settings/profile", { headers: authorization(admin.token), data: { expectedProfileVersion: 0, fileNamePattern: "../{company}" } })).status()).toBe(400);
  expect((await request.patch("/api/company-report-settings/profile", { headers: authorization(admin.token), data: { expectedProfileVersion: 0, fileNamePattern: "{evil}" } })).status()).toBe(400);

  const created = await request.patch("/api/company-report-settings/profile", {
    headers: authorization(admin.token),
    data: {
      expectedProfileVersion: 0,
      defaultTitle: "Gizli Başlık <script>",
      fileNamePattern: "{company}_{reportType}_{year}_{revision}",
      confidentialityLevel: "confidential",
    },
  });
  expect(created.status()).toBe(200);
  expect((await created.json() as { profile: { profileVersion: number; defaultTitle: string } }).profile.profileVersion).toBe(1);
  expect((await request.patch("/api/company-report-settings/profile", { headers: authorization(admin.token), data: { expectedProfileVersion: 0, defaultTitle: "stale" } })).status()).toBe(409);

  const superadmin = await login(request, credentials.superadmin);
  expect((await request.get("/api/company-report-settings/profile", { headers: authorization(superadmin.token) })).status()).toBe(400);
  expect((await request.get(`/api/company-report-settings/profile?companyId=${ids.companyB}`, { headers: authorization(superadmin.token) })).status()).toBe(200);
});

test("COMPANY-REPORT-TYPE required section koruması, transaction ve resolver fallback uygular", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const detail = await request.get("/api/company-report-settings/types/energy_targets_management", { headers: authorization(admin.token) });
  expect(detail.status()).toBe(200);
  const body = await detail.json() as { isDefault: boolean; settings: { typeSettingsVersion: number; sections: Array<{ code: string; isVisible: boolean; canHide: boolean; defaultOrder: number }> } };
  expect(body.isDefault).toBe(true);
  expect(body.settings.typeSettingsVersion).toBe(0);
  expect(body.settings.sections.find((section) => section.code === "cover")?.isVisible).toBe(true);

  expect((await request.get("/api/company-report-settings/types/not_real", { headers: authorization(admin.token) })).status()).toBe(404);

  const hideRequired = await request.patch("/api/company-report-settings/types/energy_targets_management", {
    headers: authorization(admin.token),
    data: {
      expectedTypeSettingsVersion: 0,
      sections: body.settings.sections.map((section) => ({ code: section.code, isVisible: section.code === "cover" ? false : true, displayOrder: section.defaultOrder, labelOverride: null })),
    },
  });
  expect(hideRequired.status()).toBe(400);

  const duplicate = await request.patch("/api/company-report-settings/types/energy_targets_management", {
    headers: authorization(admin.token),
    data: {
      expectedTypeSettingsVersion: 0,
      sections: body.settings.sections.map((section, index) => ({ code: index === 1 ? "cover" : section.code, isVisible: true, displayOrder: section.defaultOrder, labelOverride: null })),
    },
  });
  expect(duplicate.status()).toBe(400);
  expect((await pool.query<{ count: number }>("SELECT count(*)::int count FROM company_report_section_settings WHERE company_id=$1", [ids.companyA])).rows[0]?.count).toBe(0);

  const saved = await request.patch("/api/company-report-settings/types/energy_targets_management", {
    headers: authorization(admin.token),
    data: {
      expectedTypeSettingsVersion: 0,
      titleOverride: "Yönetim Hedef Raporu",
      sections: body.settings.sections.map((section) => ({
        code: section.code,
        isVisible: section.code === "vap_portfolio" ? false : true,
        displayOrder: section.defaultOrder,
        labelOverride: section.code === "executive_summary" ? "Üst Yönetim Özeti" : null,
      })),
    },
  });
  expect(saved.status()).toBe(200);
  const savedBody = await saved.json() as { settings: { typeSettingsVersion: number; title: string; sections: Array<{ code: string; isVisible: boolean; label: string }> } };
  expect(savedBody.settings.typeSettingsVersion).toBe(1);
  expect(savedBody.settings.title).toBe("Yönetim Hedef Raporu");
  expect(savedBody.settings.sections.find((section) => section.code === "vap_portfolio")?.isVisible).toBe(false);
  expect(savedBody.settings.sections.find((section) => section.code === "executive_summary")?.label).toBe("Üst Yönetim Özeti");
  expect((await request.patch("/api/company-report-settings/types/energy_targets_management", { headers: authorization(admin.token), data: { expectedTypeSettingsVersion: 0, sections: body.settings.sections.map((section) => ({ code: section.code, isVisible: true, displayOrder: section.defaultOrder, labelOverride: null })) } })).status()).toBe(409);

  const superadmin = await login(request, credentials.superadmin);
  const tenantB = await request.get(`/api/company-report-settings/types/energy_targets_management?companyId=${ids.companyB}`, { headers: authorization(superadmin.token) });
  expect((await tenantB.json() as { settings: { typeSettingsVersion: number; title: string } }).settings.typeSettingsVersion).toBe(0);
});

test("COMPANY-REPORT-AUDIT başarı eventleri özet metadata üretir ve validation audit üretmez", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  await request.patch("/api/company-report-settings/profile", {
    headers: authorization(admin.token),
    data: { expectedProfileVersion: 0, defaultTitle: "Tam metin audit içine yazılmamalı", preparedBy: "Kişi Adı" },
  });
  const detail = await request.get("/api/company-report-settings/types/annual_energy_performance", { headers: authorization(admin.token) });
  const sections = (await detail.json() as { settings: { sections: Array<{ code: string; defaultOrder: number }> } }).settings.sections;
  await request.patch("/api/company-report-settings/types/annual_energy_performance", {
    headers: authorization(admin.token),
    data: { expectedTypeSettingsVersion: 0, sections: sections.map((section) => ({ code: section.code, isVisible: true, displayOrder: section.defaultOrder, labelOverride: null })) },
  });
  await request.patch("/api/company-report-settings/profile", {
    headers: authorization(admin.token),
    data: { expectedProfileVersion: 0, defaultLocale: "en-US" },
  });

  const audit = await pool.query<{ action: string; metadata: string; changes: string }>(`
    SELECT action, coalesce(metadata_json::text,'') AS metadata, coalesce(changes_json::text,'') AS changes
    FROM audit_events
    WHERE action LIKE 'company_report_%'
    ORDER BY id
  `);
  expect(audit.rows.map((row) => row.action)).toEqual([
    "company_report_profile.created",
    "company_report_type_settings.created",
  ]);
  const payload = audit.rows.map((row) => `${row.metadata}\n${row.changes}`).join("\n");
  expect(payload).toContain("changedFields");
  expect(payload).toContain("changedSectionCodes");
  expect(payload).not.toContain("Tam metin audit içine yazılmamalı");
  expect(payload).not.toContain("Kişi Adı");
});

test("COMPANY-REPORT-UI admin düzenler, kontrol_admin salt okunur görür", async ({ page }) => {
  await loginPage(page, credentials.adminA);
  await page.goto("/firma-ayarlari");
  await page.getByTestId("company-reports-tab").click();
  await expect(page.getByTestId("company-report-profile-form")).toBeVisible();
  await page.getByTestId("report-default-title-input").fill("UI Rapor Başlığı");
  await page.getByTestId("company-report-profile-save-button").click();
  await expect(page.getByText("Rapor profili güncellendi.", { exact: true }).first()).toBeVisible();
  await page.getByText("Hedef, Eylem Planı ve VAP Yönetim Raporu").click();
  await expect(page.getByTestId("company-report-type-form")).toBeVisible();
  await expect(page.getByTestId("report-section-visible-cover")).toBeDisabled();
  await page.getByTestId("report-section-visible-vap_portfolio").click();
  await page.getByTestId("company-report-type-save-button").click();
  await expect(page.getByText("Rapor türü ayarları güncellendi.", { exact: true }).first()).toBeVisible();

  await loginPage(page, credentials.kontrolAdminA);
  await page.goto("/firma-ayarlari");
  await page.getByTestId("company-reports-tab").click();
  await expect(page.getByTestId("company-report-profile-form")).toBeVisible();
  await expect(page.getByTestId("report-default-title-input")).toBeDisabled();
  await expect(page.getByTestId("company-report-profile-save-button")).toHaveCount(0);
});
