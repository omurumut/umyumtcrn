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
    throw new Error("Company profile E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Company profile E2E disposable localhost DB ile eşleşmiyor.");
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

const companyProfileKeys = [
  "address",
  "createdAt",
  "email",
  "id",
  "industry",
  "isActive",
  "legalName",
  "name",
  "phone",
  "profileVersion",
  "reportIntroduction",
  "shortName",
  "subdomain",
  "taxNumber",
  "taxOffice",
  "updatedAt",
  "website",
].sort();

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
    throw new Error("Company profile fixture kimlikleri çözülemedi.");
  }
  return { companyA: row.company_a, companyB: row.company_b };
}

async function resetCompanyProfiles(): Promise<void> {
  await pool.query(`
    UPDATE companies
    SET legal_name = NULL,
        short_name = NULL,
        address = NULL,
        phone = NULL,
        email = NULL,
        website = NULL,
        tax_office = NULL,
        tax_number = NULL,
        industry = NULL,
        report_introduction = NULL,
        updated_at = now(),
        profile_version = 1
    WHERE subdomain IN ('e2e-tenant-a', 'e2e-tenant-b')
  `);
  await pool.query("DELETE FROM audit_events WHERE action = 'company_profile.updated'");
}

test.beforeAll(async () => {
  ids = await resolveFixtureIds();
});

test.beforeEach(async () => {
  await resetCompanyProfiles();
});

test.afterAll(async () => {
  await pool.end();
});

test("COMPANY-PROFILE-API unauthenticated ve standard kullanıcı verisiz reddedilir", async ({ request }) => {
  expect((await request.get("/api/company-profile")).status()).toBe(401);

  const standard = await login(request, credentials.standardA1);
  const response = await request.get("/api/company-profile", { headers: authorization(standard.token) });
  expect(response.status()).toBe(403);
  expect(JSON.stringify(await response.json())).not.toContain("[E2E] Tenant");
});

test("COMPANY-PROFILE-API admin ve kontrol_admin yalnız kendi firmasını okuyabilir", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const adminProfile = await request.get("/api/company-profile", { headers: authorization(admin.token) });
  expect(adminProfile.status()).toBe(200);
  const adminBody = await adminProfile.json();
  expect(adminBody.company).toMatchObject({
    id: ids.companyA,
    name: "[E2E] Tenant A",
    subdomain: "e2e-tenant-a",
    legalName: null,
    shortName: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    taxOffice: null,
    taxNumber: null,
    industry: null,
    reportIntroduction: null,
    isActive: true,
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
    profileVersion: 1,
  });
  expect(adminBody.permissions).toEqual({ canEditGeneral: true });
  expect(adminBody.company).not.toHaveProperty("passwordHash");
  expect(adminBody.company).not.toHaveProperty("deletedAt");
  expect(Object.keys(adminBody.company).sort()).toEqual(companyProfileKeys);

  const adminCrossTenant = await request.get(`/api/company-profile?companyId=${ids.companyB}`, {
    headers: authorization(admin.token),
  });
  expect(adminCrossTenant.status()).toBe(400);
  expect(JSON.stringify(await adminCrossTenant.json())).not.toContain("[E2E] Tenant B");

  const kontrol = await login(request, credentials.kontrolAdminA);
  const kontrolProfile = await request.get("/api/company-profile", { headers: authorization(kontrol.token) });
  expect(kontrolProfile.status()).toBe(200);
  const kontrolBody = await kontrolProfile.json();
  expect(kontrolBody.company.id).toBe(ids.companyA);
  expect(kontrolBody.permissions).toEqual({ canEditGeneral: false });
});

test("COMPANY-PROFILE-API superadmin açık companyId ile profil okur", async ({ request }) => {
  const superadmin = await login(request, credentials.superadmin);
  const headers = authorization(superadmin.token);

  expect((await request.get("/api/company-profile", { headers })).status()).toBe(400);
  expect((await request.get("/api/company-profile?companyId=abc", { headers })).status()).toBe(400);
  expect((await request.get("/api/company-profile?companyId=0", { headers })).status()).toBe(400);
  expect((await request.get("/api/company-profile?companyId=99999999", { headers })).status()).toBe(404);

  const response = await request.get(`/api/company-profile?companyId=${ids.companyB}`, { headers });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.company).toMatchObject({
    id: ids.companyB,
    name: "[E2E] Tenant B",
    subdomain: "e2e-tenant-b",
    isActive: true,
  });
  expect(body.permissions).toEqual({ canEditGeneral: true });
  expect(body.company.legalName).toBeNull();
  expect(body.company.profileVersion).toBe(1);
  expect(Object.keys(body.company).sort()).toEqual(companyProfileKeys);
});

test("COMPANY-PROFILE-API PATCH yetki, validasyon ve tenant kapsamını uygular", async ({ request }) => {
  const standard = await login(request, credentials.standardA1);
  expect((await request.patch("/api/company-profile", {
    headers: authorization(standard.token),
    data: { expectedProfileVersion: 1, legalName: "Reddedilecek" },
  })).status()).toBe(403);

  const kontrol = await login(request, credentials.kontrolAdminA);
  expect((await request.patch("/api/company-profile", {
    headers: authorization(kontrol.token),
    data: { expectedProfileVersion: 1, legalName: "Reddedilecek" },
  })).status()).toBe(403);

  const admin = await login(request, credentials.adminA);
  const headers = authorization(admin.token);
  expect((await request.patch(`/api/company-profile?companyId=${ids.companyB}`, {
    headers,
    data: { expectedProfileVersion: 1, legalName: "Tenant B" },
  })).status()).toBe(400);
  expect((await request.patch("/api/company-profile", {
    headers,
    data: { expectedProfileVersion: 1, companyId: ids.companyB, legalName: "Tenant B" },
  })).status()).toBe(400);
  expect((await request.patch("/api/company-profile", {
    headers,
    data: { expectedProfileVersion: 1, email: "gecersiz" },
  })).status()).toBe(400);
  expect((await request.patch("/api/company-profile", {
    headers,
    data: { expectedProfileVersion: 1, website: "ftp://example.test" },
  })).status()).toBe(400);

  const tenantB = await pool.query<{ legal_name: string | null }>("SELECT legal_name FROM companies WHERE id=$1", [ids.companyB]);
  expect(tenantB.rows[0]?.legal_name).toBeNull();
});

test("COMPANY-PROFILE-API PATCH günceller, audit yazar ve çakışmayı 409 döner", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const headers = authorization(admin.token);
  const current = await request.get("/api/company-profile", { headers });
  const currentBody = await current.json();

  const response = await request.patch("/api/company-profile", {
    headers,
    data: {
      expectedProfileVersion: currentBody.company.profileVersion,
      legalName: "  [E2E] Tenant A Legal  ",
      shortName: "A Legal",
      address: "E2E Adres",
      phone: "+90 212 000 00 00",
      email: "profil-a@example.test",
      website: "https://tenant-a.example.test",
      taxOffice: "E2E Vergi",
      taxNumber: "1234567890",
      industry: "Üretim",
      reportIntroduction: "ISO 50001 rapor giriş metni.",
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.company).toMatchObject({
    id: ids.companyA,
    legalName: "[E2E] Tenant A Legal",
    shortName: "A Legal",
    email: "profil-a@example.test",
    website: "https://tenant-a.example.test",
    profileVersion: currentBody.company.profileVersion + 1,
  });

  const conflict = await request.patch("/api/company-profile", {
    headers,
    data: { expectedProfileVersion: currentBody.company.profileVersion, legalName: "Stale" },
  });
  expect(conflict.status()).toBe(409);

  const audit = await pool.query<{ changes_json: { changedFields?: string[] }; payload: string }>(`
    SELECT changes_json, changes_json::text AS payload
    FROM audit_events
    WHERE action='company_profile.updated' AND company_id=$1
    ORDER BY id DESC
    LIMIT 1
  `, [ids.companyA]);
  expect(audit.rowCount).toBe(1);
  expect(audit.rows[0]?.changes_json.changedFields).toEqual(expect.arrayContaining(["legalName", "email", "website"]));
  expect(audit.rows[0]?.payload).not.toContain("profil-a@example.test");
  expect(audit.rows[0]?.payload).not.toContain("1234567890");
});

test("COMPANY-PROFILE-API superadmin PATCH açık companyId ile seçili firmayı günceller", async ({ request }) => {
  const superadmin = await login(request, credentials.superadmin);
  const headers = authorization(superadmin.token);

  expect((await request.patch("/api/company-profile", {
    headers,
    data: { expectedProfileVersion: 1, legalName: "Eksik companyId" },
  })).status()).toBe(400);

  const response = await request.patch(`/api/company-profile?companyId=${ids.companyB}`, {
    headers,
    data: { expectedProfileVersion: 1, legalName: "[E2E] Tenant B Legal" },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.company.id).toBe(ids.companyB);
  expect(body.company.legalName).toBe("[E2E] Tenant B Legal");
  expect(body.company.profileVersion).toBe(2);
});

test("COMPANY-PROFILE-API mevcut /api/companies superadmin CRUD sözleşmesi korunur", async ({ request }) => {
  const { token } = await login(request, credentials.superadmin);
  const response = await request.get("/api/companies", { headers: authorization(token) });
  expect(response.status()).toBe(200);
  const companies = (await response.json()) as Array<{ subdomain: string }>;
  expect(companies.map((company) => company.subdomain)).toEqual(expect.arrayContaining(["e2e-tenant-a", "e2e-tenant-b"]));
});

test("COMPANY-PROFILE-UI role guard ve menü görünürlüğü doğrudur", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await expect(page.locator('a[href="/firma-ayarlari"]')).toHaveCount(0);
  await page.goto("/firma-ayarlari");
  await expect(page).toHaveURL(/\/$/);

  await loginUi(page, credentials.adminA);
  await expect(page.locator('a[href="/firma-ayarlari"]')).toBeVisible();
  await page.goto("/firma-ayarlari");
  await expect(page.getByRole("heading", { name: "Firma Ayarları" })).toBeVisible();
  await expect(page.getByTestId("company-profile-card")).toContainText("[E2E] Tenant A");
  await expect(page.getByTestId("company-legal-name-input")).toBeEnabled();

  await loginUi(page, credentials.kontrolAdminA);
  await expect(page.locator('a[href="/firma-ayarlari"]')).toBeVisible();
  await page.goto("/firma-ayarlari");
  await expect(page.getByTestId("company-profile-card")).toContainText("Salt okunur");
  await expect(page.getByTestId("company-legal-name-input")).toBeDisabled();
  await expect(page.getByTestId("company-save-button")).toHaveCount(0);
});

test("COMPANY-PROFILE-UI admin profil alanlarını kaydeder ve legalName boşken fallback gösterir", async ({ page }) => {
  await loginUi(page, credentials.adminA);
  await page.goto("/firma-ayarlari");
  await expect(page.getByTestId("company-legal-name-fallback")).toContainText("[E2E] Tenant A");

  await page.getByTestId("company-legal-name-input").fill("[E2E] Tenant A UI Legal");
  await page.getByTestId("company-email-input").fill("ui-profile-a@example.test");
  await page.getByTestId("company-website-input").fill("https://ui-tenant-a.example.test");
  await page.getByTestId("company-report-introduction-input").fill("UI rapor giriş metni.");
  await page.getByTestId("company-save-button").click();

  await expect(page.getByText("Firma bilgileri güncellendi", { exact: true })).toBeVisible();
  await expect(page.getByTestId("company-display-name")).toContainText("[E2E] Tenant A UI Legal");
  await expect(page.getByTestId("company-profile-version")).toHaveText("2");
});

test("COMPANY-PROFILE-UI superadmin şirket seçmeden profil çağrısı yapmaz ve companyId bazlı veri yükler", async ({ page }) => {
  let profileRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/company-profile")) profileRequests += 1;
  });

  await loginUi(page, credentials.superadmin);
  await page.goto("/firma-ayarlari");
  await expect(page.getByTestId("company-settings-select-company")).toBeVisible();
  expect(profileRequests).toBe(0);

  await chooseSelectOption(page, "company-context-select", "[E2E] Tenant B");
  await expect(page.getByTestId("company-profile-card")).toContainText("[E2E] Tenant B");
  await expect(page.getByTestId("company-profile-card")).toContainText("e2e-tenant-b");

  await chooseSelectOption(page, "company-context-select", "[E2E] Tenant A");
  await expect(page.getByTestId("company-profile-card")).toContainText("[E2E] Tenant A");
  await expect(page.getByTestId("company-profile-card")).toContainText("e2e-tenant-a");
  expect(profileRequests).toBeGreaterThanOrEqual(2);
});
