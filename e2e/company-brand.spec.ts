import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import sharp from "sharp";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function assertDisposableDatabase(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Company brand E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Company brand E2E disposable localhost DB ile eşleşmiyor.");
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

const gifLogo = Buffer.from("R0lGODlhAQABAAAAACw=", "base64");
const htmlAsPng = Buffer.from("<html><body>not image</body></html>", "utf8");

type LoginResult = {
  token: string;
  user: { id: number; role: string; companyId: number };
};

type FixtureIds = { companyA: number; companyB: number };
let ids: FixtureIds;
let pngLogo: Buffer;

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

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<{ company_a: number; company_b: number }>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS company_a,
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AS company_b
  `);
  const row = result.rows[0];
  if (!row?.company_a || !row?.company_b) throw new Error("Company brand fixture kimlikleri çözülemedi.");
  return { companyA: row.company_a, companyB: row.company_b };
}

async function resetBrandData(): Promise<void> {
  await pool.query("DELETE FROM audit_events WHERE action LIKE 'company_logo.%' OR action LIKE 'company_brand_settings.%'");
  await pool.query("DELETE FROM company_assets WHERE company_id IN ($1, $2)", [ids.companyA, ids.companyB]);
  await pool.query("DELETE FROM company_brand_settings WHERE company_id IN ($1, $2)", [ids.companyA, ids.companyB]);
}

async function uploadLogo(request: APIRequestContext, token: string, buffer = pngLogo, mimeType = "image/png", name = "logo.png", path = "/api/company-brand/logo") {
  return request.post(path, {
    headers: authorization(token),
    multipart: {
      logo: { name, mimeType, buffer },
    },
  });
}

test.beforeAll(async () => {
  ids = await resolveFixtureIds();
  pngLogo = await sharp({
    create: {
      width: 120,
      height: 60,
      channels: 4,
      background: { r: 20, g: 120, b: 180, alpha: 1 },
    },
  }).png().toBuffer();
});

test.beforeEach(async () => {
  await resetBrandData();
});

test.afterAll(async () => {
  await pool.end();
});

test("COMPANY-BRAND-SCHEMA tabloları, constraintleri ve aktif logo unique indexini oluşturur", async () => {
  const tables = await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('company_assets', 'company_brand_settings')
  `);
  expect(tables.rows.map((row) => row.table_name).sort()).toEqual(["company_assets", "company_brand_settings"]);

  const indexes = await pool.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename IN ('company_assets', 'company_brand_settings')");
  expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
    "company_assets_storage_key_unique",
    "company_assets_one_active_logo_per_company_unique",
    "company_brand_settings_company_id_unique",
  ]));

  const defaults = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM company_brand_settings");
  expect(Number(defaults.rows[0]?.count ?? 0)).toBe(0);
});

test("COMPANY-BRAND-API GET/PATCH rol, tenant ve optimistic concurrency kurallarını uygular", async ({ request }) => {
  expect((await request.get("/api/company-brand")).status()).toBe(401);

  const standard = await login(request, credentials.standardA1);
  expect((await request.get("/api/company-brand", { headers: authorization(standard.token) })).status()).toBe(403);

  const admin = await login(request, credentials.adminA);
  const adminHeaders = authorization(admin.token);
  const getDefault = await request.get("/api/company-brand", { headers: adminHeaders });
  expect(getDefault.status()).toBe(200);
  expect(await getDefault.json()).toMatchObject({
    brand: {
      companyId: ids.companyA,
      showLogoInReports: true,
      logoAltText: "Firma logosu",
      logoPosition: "left",
      logoSize: "medium",
      brandSettingsVersion: 0,
      hasLogo: false,
    },
    permissions: { canEdit: true, canManageLogo: true },
    isDefault: true,
  });
  expect((await request.get(`/api/company-brand?companyId=${ids.companyB}`, { headers: adminHeaders })).status()).toBe(400);

  const invalidBodies = [
    {},
    { expectedBrandSettingsVersion: 0, unknown: true },
    { expectedBrandSettingsVersion: 0, companyId: ids.companyB },
    { expectedBrandSettingsVersion: 0, logoAltText: "x".repeat(251) },
    { expectedBrandSettingsVersion: 0, logoPosition: "top" },
    { expectedBrandSettingsVersion: 0, logoSize: "huge" },
  ];
  for (const data of invalidBodies) {
    const response = await request.patch("/api/company-brand", { headers: adminHeaders, data });
    expect(response.status(), JSON.stringify(data)).toBe(400);
  }

  const created = await request.patch("/api/company-brand", {
    headers: adminHeaders,
    data: { expectedBrandSettingsVersion: 0, logoAltText: "  E2E logo  ", logoPosition: "right", logoSize: "large", showLogoInReports: false },
  });
  expect(created.status()).toBe(200);
  expect(await created.json()).toMatchObject({ brand: { logoAltText: "E2E logo", logoPosition: "right", logoSize: "large", showLogoInReports: false, brandSettingsVersion: 1 } });

  expect((await request.patch("/api/company-brand", {
    headers: adminHeaders,
    data: { expectedBrandSettingsVersion: 0, logoPosition: "left" },
  })).status()).toBe(409);

  const superadmin = await login(request, credentials.superadmin);
  const superHeaders = authorization(superadmin.token);
  expect((await request.get("/api/company-brand", { headers: superHeaders })).status()).toBe(400);
  expect((await request.get("/api/company-brand?companyId=99999999", { headers: superHeaders })).status()).toBe(404);
  expect((await request.patch(`/api/company-brand?companyId=${ids.companyB}`, {
    headers: superHeaders,
    data: { expectedBrandSettingsVersion: 0, logoSize: "small" },
  })).status()).toBe(200);
});

test("COMPANY-BRAND-LOGO upload güvenliği, private GET ve tenant izolasyonunu uygular", async ({ request }) => {
  expect((await request.post("/api/company-brand/logo", {
    multipart: { logo: { name: "logo.png", mimeType: "image/png", buffer: pngLogo } },
  })).status()).toBe(401);

  const standard = await login(request, credentials.standardA1);
  expect((await uploadLogo(request, standard.token)).status()).toBe(403);

  const kontrol = await login(request, credentials.kontrolAdminA);
  expect((await uploadLogo(request, kontrol.token)).status()).toBe(403);

  const admin = await login(request, credentials.adminA);
  expect((await uploadLogo(request, admin.token, gifLogo, "image/gif", "logo.gif")).status()).toBe(400);
  expect((await uploadLogo(request, admin.token, htmlAsPng, "image/png", "logo.png")).status()).toBe(400);
  expect((await uploadLogo(request, admin.token, Buffer.alloc(0), "image/png", "empty.png")).status()).toBe(400);
  expect((await uploadLogo(request, admin.token, pngLogo, "image/png", "../logo.png")).status()).toBe(201);

  const getLogo = await request.get("/api/company-brand/logo", { headers: authorization(admin.token) });
  expect(getLogo.status()).toBe(200);
  expect(getLogo.headers()["x-content-type-options"]).toBe("nosniff");
  expect(getLogo.headers()["content-type"]).toContain("image/png");
  expect((await getLogo.body()).length).toBeGreaterThan(0);

  const responseBody = await (await request.get("/api/company-brand", { headers: authorization(admin.token) })).json();
  expect(JSON.stringify(responseBody)).not.toContain("storageKey");
  expect(JSON.stringify(responseBody)).not.toContain("companies/");

  const rows = await pool.query<{ original_file_name: string; status: string; storage_key: string }>("SELECT original_file_name, status, storage_key FROM company_assets WHERE company_id=$1", [ids.companyA]);
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0]?.original_file_name).toBe("logo.png");
  expect(rows.rows[0]?.storage_key).not.toContain(`companies/${ids.companyA}/`);
  expect(rows.rows[0]?.storage_key).not.toContain("logo.png");

  const superadmin = await login(request, credentials.superadmin);
  expect((await request.get(`/api/company-brand/logo?companyId=${ids.companyB}`, { headers: authorization(superadmin.token) })).status()).toBe(404);
});

test("COMPANY-BRAND-LOGO replace/delete tek aktif logo, status ve audit üretir", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const headers = authorization(admin.token);
  expect((await uploadLogo(request, admin.token)).status()).toBe(201);
  expect((await uploadLogo(request, admin.token, pngLogo, "image/png", "second.jpg")).status()).toBe(201);

  const statuses = await pool.query<{ status: string; count: string }>(`
    SELECT status, count(*)::text AS count
    FROM company_assets
    WHERE company_id=$1
    GROUP BY status
  `, [ids.companyA]);
  expect(Object.fromEntries(statuses.rows.map((row) => [row.status, Number(row.count)]))).toMatchObject({ active: 1, replaced: 1 });

  expect((await request.delete("/api/company-brand/logo", { headers })).status()).toBe(204);
  expect((await request.get("/api/company-brand/logo", { headers })).status()).toBe(404);
  const afterDelete = await pool.query<{ status: string; count: string }>(`
    SELECT status, count(*)::text AS count
    FROM company_assets
    WHERE company_id=$1
    GROUP BY status
  `, [ids.companyA]);
  expect(Object.fromEntries(afterDelete.rows.map((row) => [row.status, Number(row.count)]))).toMatchObject({ deleted: 1, replaced: 1 });

  const audit = await pool.query<{ action: string; metadata_json: { digestPrefix?: string; storageKey?: string } }>(`
    SELECT action, metadata_json
    FROM audit_events
    WHERE company_id=$1 AND action LIKE 'company_logo.%'
    ORDER BY id
  `, [ids.companyA]);
  expect(audit.rows.map((row) => row.action)).toEqual(["company_logo.uploaded", "company_logo.replaced", "company_logo.deleted"]);
  expect(JSON.stringify(audit.rows)).not.toContain("storageKey");
  expect(audit.rows[0]?.metadata_json.digestPrefix).toHaveLength(12);
});

test("COMPANY-BRAND-UI admin sekmeyi görür, brand ayarı kaydeder ve kontrol_admin salt okunur görür", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#username").fill(credentials.adminA);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
  await page.goto("/firma-ayarlari");
  await page.getByTestId("company-brand-tab").click();
  await expect(page.getByTestId("company-brand-form")).toBeVisible();
  await page.getByTestId("brand-logo-alt-text-input").fill("E2E UI logo");
  await page.getByTestId("brand-logo-position-select").click();
  await page.getByRole("option", { name: "center" }).click();
  await page.getByTestId("company-brand-save-button").click();
  await expect(page.getByText("Kurumsal kimlik ayarları güncellendi.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("company-brand-version")).toContainText("1");

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#username").fill(credentials.kontrolAdminA);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
  await page.goto("/firma-ayarlari");
  await page.getByTestId("company-brand-tab").click();
  await expect(page.getByText("Salt okunur kurumsal kimlik")).toBeVisible();
  await expect(page.getByTestId("company-brand-save-button")).toHaveCount(0);
  await expect(page.getByTestId("company-logo-upload-button")).toHaveCount(0);
});
