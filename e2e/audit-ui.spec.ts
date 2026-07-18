import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Audit UI E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Audit UI E2E bağlantısı disposable localhost DB ile eşleşmiyor.");
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
  standardA1: requiredEnv("E2E_STANDARD_USERNAME"),
  adminA: requiredEnv("E2E_ADMIN_USERNAME"),
  kontrolAdminA: requiredEnv("E2E_KONTROL_ADMIN_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type FixtureIds = {
  companyA: number;
  companyB: number;
  unitA1: number;
  unitA2: number;
  unitB1: number;
  adminA: number;
  kontrolAdminA: number;
  superadmin: number;
  companyAName: string;
  companyBName: string;
  unitA1Name: string;
};

type LoginResult = {
  token: string;
  user: { id: number; role: string; companyId: number; unitId: number | null };
};

let ids: FixtureIds;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function loginApi(request: APIRequestContext, username: string): Promise<LoginResult> {
  const response = await request.post("/api/auth/login", {
    data: { username, password: credentials.password },
  });
  expect(response.status()).toBe(200);
  return await response.json() as LoginResult;
}

async function loginUi(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
}

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<{
    company_a: number;
    company_b: number;
    unit_a1: number;
    unit_a2: number;
    unit_b1: number;
    admin_a: number;
    kontrol_admin_a: number;
    superadmin: number;
    company_a_name: string;
    company_b_name: string;
    unit_a1_name: string;
  }>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS company_a,
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AS company_b,
      (SELECT id FROM units WHERE name = '[E2E] Unit A1') AS unit_a1,
      (SELECT id FROM units WHERE name = '[E2E] Unit A2') AS unit_a2,
      (SELECT id FROM units WHERE name = '[E2E] Unit B1') AS unit_b1,
      (SELECT id FROM users WHERE username = 'e2e_admin_a') AS admin_a,
      (SELECT id FROM users WHERE username = 'e2e_kontrol_admin_a') AS kontrol_admin_a,
      (SELECT id FROM users WHERE username = 'e2e_superadmin') AS superadmin,
      (SELECT name FROM companies WHERE subdomain = 'e2e-tenant-a') AS company_a_name,
      (SELECT name FROM companies WHERE subdomain = 'e2e-tenant-b') AS company_b_name,
      (SELECT name FROM units WHERE name = '[E2E] Unit A1') AS unit_a1_name
  `);
  const row = result.rows[0];
  if (!row || [row.company_a, row.company_b, row.unit_a1, row.unit_a2, row.unit_b1, row.admin_a, row.kontrol_admin_a, row.superadmin].some((value) => !Number.isSafeInteger(value))) {
    throw new Error("Audit UI fixture kimlikleri çözülemedi.");
  }
  return {
    companyA: row.company_a,
    companyB: row.company_b,
    unitA1: row.unit_a1,
    unitA2: row.unit_a2,
    unitB1: row.unit_b1,
    adminA: row.admin_a,
    kontrolAdminA: row.kontrol_admin_a,
    superadmin: row.superadmin,
    companyAName: row.company_a_name,
    companyBName: row.company_b_name,
    unitA1Name: row.unit_a1_name,
  };
}

async function insertAuditFixtures() {
  await pool.query("DELETE FROM audit_events WHERE request_id LIKE 'f3b8-%'");
  const rows = [
    ["f3b8-company-a1", ids.adminA, "admin", ids.companyA, ids.unitA1, "target.update", "target", "f3b8-target-a1", "success", { name: { before: "Eski hedef", after: "Yeni hedef" } }, { marker: "Tenant A Audit Marker", secretToken: "must-redact" }],
    ["f3b8-company-a2", ids.kontrolAdminA, "kontrol_admin", ids.companyA, ids.unitA2, "user.update", "user", "f3b8-user-a2", "denied", { role: { before: "user", after: "superadmin" } }, { marker: "Unit A2 Audit Marker" }],
    ["f3b8-company-b1", ids.adminA, "admin", ids.companyB, ids.unitB1, "target.update", "target", "f3b8-target-b1", "success", { name: { before: "Tenant B old", after: "Tenant B new" } }, { marker: "Tenant B Audit Marker" }],
    ["f3b8-platform", ids.superadmin, "superadmin", null, null, "superadmin.bootstrap", "system", "platform", "success", { enabled: { before: false, after: true } }, { marker: "Platform Audit Marker" }],
    ["f3b8-xss", ids.adminA, "admin", ids.companyA, ids.unitA1, "vap.update", "vap", "f3b8-xss", "success", { title: { before: "safe", after: "<img src=x onerror=\"window.__auditXss=1\">" } }, { note: "<script>window.__auditXss=1</script>", password: "must-redact" }],
  ] as const;

  for (const [requestId, actorUserId, actorRole, companyId, unitId, action, entityType, entityId, outcome, changes, metadata] of rows) {
    await pool.query(
      `INSERT INTO audit_events
        (occurred_at, request_id, actor_user_id, actor_role, company_id, unit_id, action, entity_type, entity_id, outcome, changes_json, metadata_json)
       VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
      [requestId, actorUserId, actorRole, companyId, unitId, action, entityType, entityId, outcome, JSON.stringify(changes), JSON.stringify(metadata)],
    );
  }

  await pool.query(
    `INSERT INTO audit_events
      (occurred_at, request_id, actor_user_id, actor_role, company_id, unit_id, action, entity_type, entity_id, outcome, changes_json, metadata_json)
     SELECT NOW() - (gs || ' seconds')::interval,
       'f3b8-bulk-' || gs, $1, 'admin', $2, $3, 'vap.update', 'vap', 'bulk-' || gs, 'success',
       '{"status":{"before":"planned","after":"done"}}'::jsonb,
       '{"marker":"Bulk Audit Marker"}'::jsonb
     FROM generate_series(1, 1000) gs`,
    [ids.adminA, ids.companyA, ids.unitA1],
  );
}

async function chooseSelectOption(page: Page, testId: string, name: string | RegExp) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name }).click();
}

async function expectAuditRow(page: Page, text: string) {
  await expect(page.getByTestId("audit-row").filter({ hasText: text })).toHaveCount(1);
}

async function expectNoAuditRow(page: Page, text: string) {
  await expect(page.getByTestId("audit-row").filter({ hasText: text })).toHaveCount(0);
}

async function openAuditAs(page: Page, username: string) {
  await loginUi(page, username);
  await page.goto("/audit");
}

test.beforeAll(async () => {
  ids = await resolveFixtureIds();
  await insertAuditFixtures();
});

test.afterAll(async () => {
  await pool.query("DELETE FROM audit_events WHERE request_id LIKE 'f3b8-%'");
  await pool.end();
});

test.describe.serial("audit management UI", () => {
  test("AUDIT-UI-01 standard menüde İşlem Geçmişi görmez", async ({ page }) => {
    await loginUi(page, credentials.standardA1);
    await expect(page.locator('a[href="/audit"]')).toHaveCount(0);
  });

  test("AUDIT-UI-02 standard doğrudan /audit rotasından uzaklaştırılır", async ({ page }) => {
    await loginUi(page, credentials.standardA1);
    await page.goto("/audit");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("audit-page")).toHaveCount(0);
  });

  test("AUDIT-UI-03 admin menüden audit ekranını açabilir", async ({ page }) => {
    await loginUi(page, credentials.adminA);
    await expect(page.locator('a[href="/audit"]')).toBeVisible();
    await page.locator('a[href="/audit"]').click();
    await expect(page.getByTestId("audit-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "İşlem Geçmişi" })).toBeVisible();
  });

  test("AUDIT-UI-04 kontrol_admin admin ile aynı audit menüsünü görür", async ({ page }) => {
    await loginUi(page, credentials.kontrolAdminA);
    await expect(page.locator('a[href="/audit"]')).toBeVisible();
    await page.goto("/audit");
    await expect(page.getByTestId("audit-page")).toBeVisible();
  });

  test("AUDIT-UI-05 superadmin menüyü görür ama context seçmeden liste yüklemez", async ({ page }) => {
    await openAuditAs(page, credentials.superadmin);
    await expect(page.locator('a[href="/audit"]')).toBeVisible();
    await expect(page.getByTestId("audit-context-required")).toBeVisible();
    await expect(page.getByTestId("audit-table")).toHaveCount(0);
  });

  test("AUDIT-UI-06 admin listesi yalnız kendi tenant markerını gösterir", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await expect(page.getByTestId("audit-table")).toBeVisible();
    await chooseSelectOption(page, "audit-action-filter", "Hedef güncelleme");
    await page.getByTestId("audit-request-filter").fill("f3b8-company-a1");
    await expectAuditRow(page, "f3b8-company-a1");
    await expectNoAuditRow(page, "f3b8-company-b1");
  });

  test("AUDIT-UI-07 kontrol_admin şirket kapsamındaki kayıtları okuyabilir", async ({ page }) => {
    await openAuditAs(page, credentials.kontrolAdminA);
    await page.getByTestId("audit-request-filter").fill("f3b8-company-a2");
    await expectAuditRow(page, "f3b8-company-a2");
    await expect(page.getByText("Unit A2 Audit Marker")).toHaveCount(0);
  });

  test("AUDIT-UI-08 superadmin company context ile Tenant A kayıtlarını görür", async ({ page }) => {
    await openAuditAs(page, credentials.superadmin);
    await chooseSelectOption(page, "audit-scope-select", "Firma audit kayıtları");
    await chooseSelectOption(page, "audit-company-select", ids.companyAName);
    await page.getByTestId("audit-request-filter").fill("f3b8-company-a1");
    await expectAuditRow(page, "f3b8-company-a1");
  });

  test("AUDIT-UI-09 superadmin company context Tenant B'yi ayırır", async ({ page }) => {
    await openAuditAs(page, credentials.superadmin);
    await chooseSelectOption(page, "audit-scope-select", "Firma audit kayıtları");
    await chooseSelectOption(page, "audit-company-select", ids.companyBName);
    await page.getByTestId("audit-request-filter").fill("f3b8-company-b1");
    await expectAuditRow(page, "f3b8-company-b1");
    await expectNoAuditRow(page, "f3b8-company-a1");
  });

  test("AUDIT-UI-10 superadmin platform scope platform kayıtlarını gösterir", async ({ page }) => {
    await openAuditAs(page, credentials.superadmin);
    await chooseSelectOption(page, "audit-scope-select", "Platform audit kayıtları");
    await page.getByTestId("audit-request-filter").fill("f3b8-platform");
    await expectAuditRow(page, "f3b8-platform");
  });

  test("AUDIT-UI-11 action filtresi sonuçları daraltır", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await chooseSelectOption(page, "audit-action-filter", "VAP güncelleme");
    await page.getByTestId("audit-request-filter").fill("f3b8-xss");
    await expectAuditRow(page, "f3b8-xss");
    await expectNoAuditRow(page, "f3b8-company-a1");
  });

  test("AUDIT-UI-12 outcome filtresi reddedilen kayıtları bulur", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await chooseSelectOption(page, "audit-outcome-filter", "Reddedildi");
    await page.getByTestId("audit-request-filter").fill("f3b8-company-a2");
    await expectAuditRow(page, "f3b8-company-a2");
    await expect(page.getByTestId("audit-row").filter({ hasText: "f3b8-company-a2" })).toContainText("Reddedildi");
  });

  test("AUDIT-UI-13 entity type ve entity id filtreleri birlikte çalışır", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await page.getByTestId("audit-entity-type-filter").fill("target");
    await page.getByTestId("audit-entity-id-filter").fill("f3b8-target-a1");
    await expectAuditRow(page, "f3b8-target-a1");
  });

  test("AUDIT-UI-14 actor ve unit filtreleri tenant içinde çalışır", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await page.getByTestId("audit-actor-filter").fill(String(ids.adminA));
    await chooseSelectOption(page, "audit-unit-filter", ids.unitA1Name);
    await page.getByTestId("audit-request-filter").fill("f3b8-company-a1");
    await expectAuditRow(page, "f3b8-company-a1");
  });

  test("AUDIT-UI-15 geçersiz tarih aralığı kullanıcıya güvenli hata gösterir", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await page.getByTestId("audit-date-from").fill("2026-02-01");
    await page.getByTestId("audit-date-to").fill("2026-01-01");
    await expect(page.getByTestId("audit-validation-error")).toContainText("Başlangıç tarihi");
  });

  test("AUDIT-UI-16 geçersiz aktör id sorgu göndermeden reddedilir", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await page.getByTestId("audit-actor-filter").fill("123abc");
    await expect(page.getByTestId("audit-validation-error")).toContainText("Aktör ID");
  });

  test("AUDIT-UI-17 detay dialog değişiklik ve metadata alanlarını güvenli gösterir", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await page.getByTestId("audit-request-filter").fill("f3b8-company-a1");
    await page.getByTestId("audit-detail-button").first().click();
    await expect(page.getByTestId("audit-detail-dialog")).toBeVisible();
    await expect(page.getByTestId("audit-detail-changes-table")).toContainText("name");
    await expect(page.getByTestId("audit-detail-metadata")).toContainText("Tenant A Audit Marker");
    await expect(page.getByTestId("audit-detail-metadata")).toContainText("[redacted]");
    await expect(page.getByTestId("audit-detail-metadata")).not.toContainText("must-redact");
  });

  test("AUDIT-UI-18 request ID kopyalama kullanıcı geri bildirimi üretir", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openAuditAs(page, credentials.adminA);
    await page.getByTestId("audit-request-filter").fill("f3b8-company-a1");
    await page.getByTestId("audit-detail-button").first().click();
    await page.getByTestId("audit-copy-request").click();
    await expect(page.getByTestId("audit-copy-state")).toContainText(/Kopyalandı|desteklenmiyor/);
  });

  test("AUDIT-UI-19 XSS payload plain text olarak kalır", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await page.getByTestId("audit-request-filter").fill("f3b8-xss");
    await page.getByTestId("audit-detail-button").first().click();
    await expect(page.getByTestId("audit-detail-changes-table")).toContainText("<img src=x");
    await expect(page.getByTestId("audit-detail-metadata")).toContainText("<script>");
    const xssValue = await page.evaluate(() => (window as any).__auditXss);
    expect(xssValue).toBeUndefined();
  });

  test("AUDIT-UI-20 sayfalama 1000 kayıt için server-side sınırı korur", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await chooseSelectOption(page, "audit-action-filter", "VAP güncelleme");
    await expect(page.getByTestId("audit-pagination-summary")).toContainText(/toplam 1\.00|toplam 100/);
    await expect(page.getByTestId("audit-row")).toHaveCount(50);
    await page.getByTestId("audit-next-page").click();
    await expect(page.getByTestId("audit-pagination-summary")).toContainText("Sayfa 2");
    await expect(page.getByTestId("audit-row")).toHaveCount(50);
  });

  test("AUDIT-UI-21 page size değişikliği tablo satır sayısını sınırlar", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await chooseSelectOption(page, "audit-action-filter", "VAP güncelleme");
    await chooseSelectOption(page, "audit-page-size", "25");
    await expect(page.getByTestId("audit-row")).toHaveCount(25);
  });

  test("AUDIT-UI-22 filtreleri temizle varsayılan listeye döner", async ({ page }) => {
    await openAuditAs(page, credentials.adminA);
    await page.getByTestId("audit-request-filter").fill("f3b8-company-a1");
    await expectAuditRow(page, "f3b8-company-a1");
    await page.getByTestId("audit-clear-filters").click();
    await expect(page.getByTestId("audit-request-filter")).toHaveValue("");
    await expect(page.getByTestId("audit-table")).toBeVisible();
  });
});
