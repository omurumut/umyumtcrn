import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function assertDisposableDatabase(): string {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.TEST_DB_DISPOSABLE !== "true"
  ) {
    throw new Error("E2E DB mutation yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/iso50001_test" ||
    url.port !== process.env.TEST_DB_PORT
  ) {
    throw new Error("E2E DB mutation disposable localhost DB ile eşleşmiyor.");
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

const users = {
  standardA1: requiredEnv("E2E_STANDARD_USERNAME"),
  standardB1: requiredEnv("E2E_STANDARD_B_USERNAME"),
  adminA: requiredEnv("E2E_ADMIN_USERNAME"),
  kontrolAdminA: requiredEnv("E2E_KONTROL_ADMIN_USERNAME"),
  nullUnit: requiredEnv("E2E_NULL_UNIT_USERNAME"),
  inactive: requiredEnv("E2E_INACTIVE_USERNAME"),
  inactiveCompany: requiredEnv("E2E_INACTIVE_COMPANY_USERNAME"),
  session: requiredEnv("E2E_SESSION_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
} as const;
const password = requiredEnv("E2E_TEST_PASSWORD");

type LoginUser = {
  id: number;
  username: string;
  name: string;
  role: string;
  unitId: number | null;
  companyId: number;
};

type LoginResult = { token: string; user: LoginUser };
type FixtureIds = {
  companyA: number;
  companyB: number;
  unitA1: number;
  unitA2: number;
  unitB1: number;
  subUnitA2: number;
  subUnitB1: number;
  adminA: number;
  adminB: number;
};

let ids: FixtureIds;

function authorization(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function loginApi(
  request: APIRequestContext,
  username: string,
): Promise<LoginResult> {
  const response = await request.post("/api/auth/login", {
    data: { username, password },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as LoginResult;
}

async function loginUi(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
}

async function fixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<{
    company_a: number;
    company_b: number;
    unit_a1: number;
    unit_a2: number;
    unit_b1: number;
    sub_unit_a2: number;
    sub_unit_b1: number;
    admin_a: number;
    admin_b: number;
  }>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS company_a,
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AS company_b,
      (SELECT id FROM units WHERE name = '[E2E] Unit A1') AS unit_a1,
      (SELECT id FROM units WHERE name = '[E2E] Unit A2') AS unit_a2,
      (SELECT id FROM units WHERE name = '[E2E] Unit B1') AS unit_b1,
      (SELECT id FROM sub_units WHERE name = '[E2E] Sub-unit A2') AS sub_unit_a2,
      (SELECT id FROM sub_units WHERE name = '[E2E] Sub-unit B1') AS sub_unit_b1,
      (SELECT id FROM users WHERE username = 'e2e_admin_a') AS admin_a,
      (SELECT id FROM users WHERE username = 'e2e_admin_b') AS admin_b
  `);
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => !Number.isSafeInteger(value))) {
    throw new Error("E2E fixture kimlikleri çözülemedi.");
  }
  return {
    companyA: row.company_a,
    companyB: row.company_b,
    unitA1: row.unit_a1,
    unitA2: row.unit_a2,
    unitB1: row.unit_b1,
    subUnitA2: row.sub_unit_a2,
    subUnitB1: row.sub_unit_b1,
    adminA: row.admin_a,
    adminB: row.admin_b,
  };
}

test.beforeAll(async () => {
  ids = await fixtureIds();
});

test.afterAll(async () => {
  await pool.end();
});

test("AUTH-01 dört rol login response sözleşmesini korur", async ({ request }) => {
  const cases = [
    [users.standardA1, "user", ids.unitA1, ids.companyA],
    [users.adminA, "admin", null, ids.companyA],
    [users.kontrolAdminA, "kontrol_admin", null, ids.companyA],
    [users.superadmin, "superadmin", null, ids.companyA],
  ] as const;

  for (const [username, role, unitId, companyId] of cases) {
    const result = await loginApi(request, username);
    expect(result.token.length).toBeGreaterThan(20);
    expect(result.user).toMatchObject({ username, role, unitId, companyId });
    expect(result.user).not.toHaveProperty("password");
    expect(result.user).not.toHaveProperty("passwordHash");
  }
});

test("AUTH-02 yanlış parola token üretmez", async ({ request }) => {
  const response = await request.post("/api/auth/login", {
    data: { username: users.standardA1, password: `${password}-wrong` },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).not.toHaveProperty("token");
});

test("AUTH-03 pasif kullanıcı ve pasif şirket kullanıcısı reddedilir", async ({ request }) => {
  for (const username of [users.inactive, users.inactiveCompany]) {
    const response = await request.post("/api/auth/login", {
      data: { username, password },
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "Kullanıcı adı veya şifre hatalı" });
  }
});

test("AUTH-04 var olmayan kullanıcı aynı güvenli hata mesajını alır", async ({ request }) => {
  const missing = await request.post("/api/auth/login", {
    data: { username: "e2e_missing_user", password },
  });
  const inactive = await request.post("/api/auth/login", {
    data: { username: users.inactive, password },
  });
  expect(missing.status()).toBe(401);
  expect(inactive.status()).toBe(401);
  expect(await missing.json()).toEqual(await inactive.json());
});

test("AUTH-05-08 logout, bearer ve session devamlılığı güvenlidir", async ({ request }) => {
  const login = await loginApi(request, users.standardA1);
  expect((await request.get("/api/auth/me", { headers: authorization(login.token) })).status()).toBe(200);

  const invalid = await request.get("/api/auth/me", {
    headers: authorization("not-a-valid-session-token"),
  });
  expect(invalid.status()).toBe(401);
  expect((await request.get("/api/auth/me")).status()).toBe(401);

  const logout = await request.post("/api/auth/logout", {
    headers: authorization(login.token),
  });
  expect(logout.status()).toBe(204);
  expect((await request.get("/api/auth/me", { headers: authorization(login.token) })).status()).toBe(401);
});

test("SESSION-01 pasifleştirilen kullanıcının eski tokenı kalıcı olarak iptal edilir", async ({ request }) => {
  const login = await loginApi(request, users.standardA1);
  try {
    await pool.query("UPDATE users SET active = false WHERE username = $1", [users.standardA1]);
    expect((await request.get("/api/auth/me", { headers: authorization(login.token) })).status()).toBe(401);
    expect((await request.get("/api/auth/me", { headers: authorization(login.token) })).status()).toBe(401);
  } finally {
    await pool.query("UPDATE users SET active = true WHERE username = $1", [users.standardA1]);
  }
});

test("SESSION-02 silinen kullanıcının eski tokenı reddedilir", async ({ request }) => {
  const login = await loginApi(request, users.session);
  const snapshot = await pool.query<{
    id: number;
    company_id: number;
    username: string;
    password_hash: string;
    name: string;
    role: string;
    unit_id: number | null;
    active: boolean;
    is_demo: boolean;
    created_at: Date;
  }>("SELECT * FROM users WHERE username = $1", [users.session]);
  const user = snapshot.rows[0];
  if (!user) throw new Error("Session fixture kullanıcısı bulunamadı.");
  let deleted = false;
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [user.id]);
    deleted = true;
    expect((await request.get("/api/auth/me", { headers: authorization(login.token) })).status()).toBe(401);
  } finally {
    if (deleted) {
      await pool.query(
        `INSERT INTO users
          (id, company_id, username, password_hash, name, role, unit_id, active, is_demo, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [user.id, user.company_id, user.username, user.password_hash, user.name, user.role, user.unit_id, user.active, user.is_demo, user.created_at],
      );
    }
  }
});

test("SESSION-03 rol değişikliği aynı tokena yansır", async ({ request }) => {
  const login = await loginApi(request, users.session);
  try {
    await pool.query("UPDATE users SET role = 'admin' WHERE username = $1", [users.session]);
    const me = await request.get("/api/auth/me", { headers: authorization(login.token) });
    expect(me.status()).toBe(200);
    expect((await me.json()).role).toBe("admin");
    expect((await request.get("/api/users", { headers: authorization(login.token) })).status()).toBe(200);
    expect((await request.get("/api/companies", { headers: authorization(login.token) })).status()).toBe(403);
  } finally {
    await pool.query("UPDATE users SET role = 'user' WHERE username = $1", [users.session]);
  }
});

test("SESSION-04 unit değişikliği aynı tokenın scopeunu yeniler", async ({ request }) => {
  const login = await loginApi(request, users.standardA1);
  try {
    await pool.query("UPDATE users SET unit_id = $1 WHERE username = $2", [ids.unitA2, users.standardA1]);
    const me = await request.get("/api/auth/me", { headers: authorization(login.token) });
    expect(me.status()).toBe(200);
    expect((await me.json()).unitId).toBe(ids.unitA2);
    const units = await request.get("/api/units", { headers: authorization(login.token) });
    expect((await units.json()).map((unit: LoginUser) => unit.id)).toEqual([ids.unitA2]);
    expect((await request.get(`/api/units/${ids.unitA1}`, { headers: authorization(login.token) })).status()).toBe(404);
  } finally {
    await pool.query("UPDATE users SET unit_id = $1 WHERE username = $2", [ids.unitA1, users.standardA1]);
  }
});

test("SESSION-05 pasifleştirilen şirket mevcut tokenı iptal eder", async ({ request }) => {
  const login = await loginApi(request, "e2e_admin_b");
  try {
    await pool.query("UPDATE companies SET is_active = false WHERE id = $1", [ids.companyB]);
    expect((await request.get("/api/auth/me", { headers: authorization(login.token) })).status()).toBe(401);
    expect((await request.get("/api/auth/me", { headers: authorization(login.token) })).status()).toBe(401);
  } finally {
    await pool.query("UPDATE companies SET is_active = true WHERE id = $1", [ids.companyB]);
  }
});

test("USER-01-03 standard kullanıcı yalnız kendi unitini görür", async ({ request }) => {
  const { token } = await loginApi(request, users.standardA1);
  const headers = authorization(token);
  const list = await request.get(`/api/units?companyId=${ids.companyB}`, { headers });
  expect(list.status()).toBe(200);
  const body = (await list.json()) as Array<{ id: number; name: string }>;
  expect(body.map((unit) => unit.id)).toEqual([ids.unitA1]);
  expect(JSON.stringify(body)).not.toContain("Unit A2");
  expect(JSON.stringify(body)).not.toContain("Unit B1");
  expect((await request.get(`/api/units/${ids.unitA2}`, { headers })).status()).toBe(404);
  expect((await request.get(`/api/units/${ids.unitB1}`, { headers })).status()).toBe(404);
});

test("USER-04-06 standard yönetim API mutationlarına erişemez", async ({ request }) => {
  const { token } = await loginApi(request, users.standardA1);
  const headers = authorization(token);
  expect((await request.get("/api/companies", { headers })).status()).toBe(403);
  expect((await request.post("/api/users", { headers, data: {} })).status()).toBe(403);
  expect((await request.patch(`/api/users/${ids.adminA}`, { headers, data: {} })).status()).toBe(403);
  expect((await request.delete(`/api/users/${ids.adminA}`, { headers })).status()).toBe(403);
  expect((await request.post("/api/units", { headers, data: {} })).status()).toBe(403);
  expect((await request.patch(`/api/units/${ids.unitA1}`, { headers, data: {} })).status()).toBe(403);
  expect((await request.delete(`/api/units/${ids.unitA1}`, { headers })).status()).toBe(403);
});

test("USER-07 standard başka unit veya tenant sub-unit kaydını okuyamaz", async ({ request }) => {
  const { token } = await loginApi(request, users.standardA1);
  const headers = authorization(token);
  expect((await request.get(`/api/sub-units/${ids.subUnitA2}`, { headers })).status()).toBe(404);
  expect((await request.get(`/api/sub-units/${ids.subUnitB1}`, { headers })).status()).toBe(404);
});

test("NULL-01-04 null-unit standard güvenli boş sonuç ve mutation 403 alır", async ({ request }) => {
  const login = await loginApi(request, users.nullUnit);
  expect(login.user.unitId).toBeNull();
  const headers = authorization(login.token);
  const units = await request.get("/api/units", { headers });
  const subUnits = await request.get("/api/sub-units", { headers });
  expect(units.status()).toBe(200);
  expect(await units.json()).toEqual([]);
  expect(subUnits.status()).toBe(200);
  expect(await subUnits.json()).toEqual([]);
  expect((await request.get("/api/companies", { headers })).status()).toBe(403);
  const mutation = await request.post("/api/sub-units", {
    headers,
    data: { unitId: ids.unitA1, name: "[E2E] must-not-exist" },
  });
  expect(mutation.status()).toBe(403);
  const created = await pool.query("SELECT id FROM sub_units WHERE name = $1", ["[E2E] must-not-exist"]);
  expect(created.rowCount).toBe(0);
});

test("ADMIN-01-05 admin tenant A kapsamını aşamaz", async ({ request }) => {
  const { token } = await loginApi(request, users.adminA);
  const headers = authorization(token);
  const unitsResponse = await request.get(`/api/units?companyId=${ids.companyB}`, { headers });
  const units = (await unitsResponse.json()) as Array<{ id: number; companyId: number }>;
  expect(units.map((unit) => unit.id).sort()).toEqual([ids.unitA1, ids.unitA2].sort());
  expect(units.every((unit) => unit.companyId === ids.companyA)).toBe(true);
  const userResponse = await request.get(`/api/users?companyId=${ids.companyB}`, { headers });
  const tenantUsers = (await userResponse.json()) as Array<{ companyId: number }>;
  expect(tenantUsers.length).toBeGreaterThan(0);
  expect(tenantUsers.every((user) => user.companyId === ids.companyA)).toBe(true);
  expect((await request.patch(`/api/users/${ids.adminB}`, { headers, data: { name: "blocked" } })).status()).toBe(404);
  expect((await request.delete(`/api/users/${ids.adminB}`, { headers })).status()).toBe(404);
  expect((await request.get("/api/companies", { headers })).status()).toBe(403);
});

test("ADMIN-05 body companyId admin session tenantını değiştirmez", async ({ request }) => {
  const { token } = await loginApi(request, users.adminA);
  const marker = `[E2E] Admin scoped ${Date.now()}`;
  let createdId: number | null = null;
  try {
    const response = await request.post("/api/units", {
      headers: authorization(token),
      data: { name: marker, location: "Test", companyId: ids.companyB },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number };
    createdId = created.id;
    expect(created.companyId).toBe(ids.companyA);
  } finally {
    if (createdId !== null) await pool.query("DELETE FROM units WHERE id = $1", [createdId]);
  }
});

test("KADMIN-01-02 kontrol_admin backendde admin company scopeunu taşır", async ({ request }) => {
  const { token } = await loginApi(request, users.kontrolAdminA);
  const headers = authorization(token);
  const units = (await (await request.get("/api/units", { headers })).json()) as Array<{ id: number }>;
  expect(units.map((unit) => unit.id).sort()).toEqual([ids.unitA1, ids.unitA2].sort());
  const tenantUsers = (await (await request.get("/api/users", { headers })).json()) as Array<{ companyId: number }>;
  expect(tenantUsers.length).toBeGreaterThan(0);
  expect(tenantUsers.every((user) => user.companyId === ids.companyA)).toBe(true);
  expect((await request.patch(`/api/users/${ids.adminB}`, { headers, data: { name: "blocked" } })).status()).toBe(404);
  expect((await request.get("/api/companies", { headers })).status()).toBe(403);
});

test("SUPER-02-04 superadmin platform ve company filtre kapsamını görür", async ({ request }) => {
  const { token } = await loginApi(request, users.superadmin);
  const headers = authorization(token);
  const companies = (await (await request.get("/api/companies", { headers })).json()) as Array<{ subdomain: string }>;
  expect(companies.map((company) => company.subdomain)).toEqual(expect.arrayContaining([
    "e2e-tenant-a",
    "e2e-tenant-b",
    "e2e-tenant-c-inactive",
  ]));
  const allUnits = (await (await request.get("/api/units", { headers })).json()) as Array<{ id: number }>;
  expect(allUnits.map((unit) => unit.id)).toEqual(expect.arrayContaining([ids.unitA1, ids.unitA2, ids.unitB1]));
  const tenantBUnits = (await (await request.get(`/api/units?companyId=${ids.companyB}`, { headers })).json()) as Array<{ companyId: number }>;
  expect(tenantBUnits.length).toBeGreaterThan(0);
  expect(tenantBUnits.every((unit) => unit.companyId === ids.companyB)).toBe(true);
  const tenantAUsers = (await (await request.get(`/api/users?companyId=${ids.companyA}`, { headers })).json()) as Array<{ companyId: number }>;
  expect(tenantAUsers.length).toBeGreaterThan(0);
  expect(tenantAUsers.every((user) => user.companyId === ids.companyA)).toBe(true);
});

test("SUPER-05 unit şirketler arasında taşınamaz", async ({ request }) => {
  const { token } = await loginApi(request, users.superadmin);
  const response = await request.patch(`/api/units/${ids.unitB1}`, {
    headers: authorization(token),
    data: { companyId: ids.companyA },
  });
  expect(response.status()).toBe(409);
  const persisted = await pool.query<{ company_id: number }>("SELECT company_id FROM units WHERE id = $1", [ids.unitB1]);
  expect(persisted.rows[0]?.company_id).toBe(ids.companyB);
});

test("TENANT-01 A ve B tokenlarında fixture marker izolasyonu korunur", async ({ request }) => {
  const adminA = await loginApi(request, users.adminA);
  const adminB = await loginApi(request, "e2e_admin_b");
  const aHeaders = authorization(adminA.token);
  const bHeaders = authorization(adminB.token);
  for (const route of ["/api/units", "/api/sub-units", "/api/users", "/api/auth/me"]) {
    const aBody = JSON.stringify(await (await request.get(route, { headers: aHeaders })).json());
    const bBody = JSON.stringify(await (await request.get(route, { headers: bHeaders })).json());
    expect(aBody).not.toContain("Unit B1");
    expect(aBody).not.toContain("Sub-unit B1");
    expect(aBody).not.toContain("e2e_user_b1");
    expect(bBody).not.toContain("Unit A1");
    expect(bBody).not.toContain("Unit A2");
    expect(bBody).not.toContain("Sub-unit A1");
    expect(bBody).not.toContain("e2e_user_a1");
  }
});

test("UI-MATRIX standard route ve menü sınırlarını korur", async ({ page }) => {
  await loginUi(page, users.standardA1);
  await expect(page.locator('a[href="/birimler"]')).toBeVisible();
  await expect(page.locator('a[href="/ozet"]')).toHaveCount(0);
  await expect(page.locator('a[href="/firmalar"]')).toHaveCount(0);
  await expect(page.locator('a[href="/bekleyen-isler"]')).toBeVisible();
  await page.goto("/firmalar");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/birimler");
  await expect(page.getByRole("tab", { name: "Kullanıcılar" })).toHaveCount(0);
});

test("UI-MATRIX admin firma yönetimi menülerini görür", async ({ page }) => {
  await loginUi(page, users.adminA);
  await expect(page.locator('a[href="/birimler"]')).toBeVisible();
  await expect(page.locator('a[href="/ozet"]')).toBeVisible();
  await expect(page.locator('a[href="/firmalar"]')).toHaveCount(0);
  await expect(page.locator('a[href="/bekleyen-isler"]')).toBeVisible();
  await page.goto("/birimler");
  await expect(page.getByRole("tab", { name: "Kullanıcılar" })).toBeVisible();
});

test("UI-MATRIX kontrol_admin admin menü ve kullanıcı yönetimi görünürlüğünü taşır", async ({ page }) => {
  await loginUi(page, users.kontrolAdminA);
  await expect(page.locator('a[href="/birimler"]')).toBeVisible();
  await expect(page.locator('a[href="/ozet"]')).toBeVisible();
  await expect(page.locator('a[href="/firmalar"]')).toHaveCount(0);
  await expect(page.locator('a[href="/bekleyen-isler"]')).toBeVisible();
  await page.goto("/birimler");
  await expect(page.getByRole("tab", { name: "Kullanıcılar" })).toBeVisible();
});

test("KADMIN-04 kontrol_admin temel yönetim sayfalarını açabilir", async ({ page }) => {
  await loginUi(page, users.kontrolAdminA);
  for (const [route, heading] of [
    ["/hedefler", "Enerji Amaçları, Hedefleri ve Eylem Planları"],
    ["/oek", "Önemli Enerji Kullanımları (ÖEK)"],
    ["/enerji-kullanim-gruplari", "Enerji Kullanım Grupları"],
  ] as const) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("UI-MATRIX superadmin platform menülerini görür", async ({ page }) => {
  await loginUi(page, users.superadmin);
  await expect(page.locator('a[href="/birimler"]')).toBeVisible();
  await expect(page.locator('a[href="/ozet"]')).toBeVisible();
  await expect(page.locator('a[href="/firmalar"]')).toBeVisible();
  await expect(page.locator('a[href="/bekleyen-isler"]')).toHaveCount(0);
  await page.goto("/birimler");
  await expect(page.getByRole("tab", { name: "Kullanıcılar" })).toBeVisible();
});
