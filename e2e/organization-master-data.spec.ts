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

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Organization E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/iso50001_test" ||
    url.port !== process.env.TEST_DB_PORT
  ) {
    throw new Error("Organization E2E bağlantısı disposable localhost DB ile eşleşmiyor.");
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
  standardB1: requiredEnv("E2E_STANDARD_B_USERNAME"),
  adminA: requiredEnv("E2E_ADMIN_USERNAME"),
  kontrolAdminA: requiredEnv("E2E_KONTROL_ADMIN_USERNAME"),
  nullUnit: requiredEnv("E2E_NULL_UNIT_USERNAME"),
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
  companyC: number;
  unitA1: number;
  unitA2: number;
  unitB1: number;
  subUnitA1: number;
  subUnitA2: number;
  subUnitB1: number;
  sourceA1: number;
  sourceA2: number;
  sourceB1: number;
  adminA: number;
  adminB: number;
  standardA1: number;
};

const cleanupTables = new Set([
  "companies",
  "users",
  "units",
  "sub_units",
  "energy_sources",
]);

let ids: FixtureIds;
let markerCounter = 0;

function marker(prefix: string): string {
  markerCounter += 1;
  return `E2E_ORG_${prefix}_${Date.now()}_${markerCounter}`;
}

function authorization(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function login(
  request: APIRequestContext,
  username: string,
): Promise<LoginResult> {
  const response = await request.post("/api/auth/login", {
    data: { username, password: credentials.password },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as LoginResult;
}

async function loginUi(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
}

async function cleanupById(table: string, id: number | null): Promise<void> {
  if (id === null) return;
  if (!cleanupTables.has(table)) throw new Error("Geçersiz cleanup tablosu.");
  await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

async function cleanupByMarker(table: string, column: string, value: string): Promise<void> {
  if (!cleanupTables.has(table) || !["name", "username", "subdomain"].includes(column)) {
    throw new Error("Geçersiz marker cleanup hedefi.");
  }
  await pool.query(`DELETE FROM ${table} WHERE ${column} = $1`, [value]);
}

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<Record<string, number>>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS company_a,
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AS company_b,
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-c-inactive') AS company_c,
      (SELECT id FROM units WHERE name = '[E2E] Unit A1') AS unit_a1,
      (SELECT id FROM units WHERE name = '[E2E] Unit A2') AS unit_a2,
      (SELECT id FROM units WHERE name = '[E2E] Unit B1') AS unit_b1,
      (SELECT id FROM sub_units WHERE name = '[E2E] Sub-unit A1') AS sub_unit_a1,
      (SELECT id FROM sub_units WHERE name = '[E2E] Sub-unit A2') AS sub_unit_a2,
      (SELECT id FROM sub_units WHERE name = '[E2E] Sub-unit B1') AS sub_unit_b1,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A1') AND name = '[E2E] Common Source') AS source_a1,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A2') AND name = '[E2E] Source A2') AS source_a2,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AND name = '[E2E] Common Source') AS source_b1,
      (SELECT id FROM users WHERE username = 'e2e_admin_a') AS admin_a,
      (SELECT id FROM users WHERE username = 'e2e_admin_b') AS admin_b,
      (SELECT id FROM users WHERE username = 'e2e_user_a1') AS standard_a1
  `);
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => !Number.isSafeInteger(value))) {
    throw new Error("Organization fixture kimlikleri çözülemedi.");
  }
  return {
    companyA: row.company_a,
    companyB: row.company_b,
    companyC: row.company_c,
    unitA1: row.unit_a1,
    unitA2: row.unit_a2,
    unitB1: row.unit_b1,
    subUnitA1: row.sub_unit_a1,
    subUnitA2: row.sub_unit_a2,
    subUnitB1: row.sub_unit_b1,
    sourceA1: row.source_a1,
    sourceA2: row.source_a2,
    sourceB1: row.source_b1,
    adminA: row.admin_a,
    adminB: row.admin_b,
    standardA1: row.standard_a1,
  };
}

test.beforeAll(async () => {
  ids = await resolveFixtureIds();
});

test.afterAll(async () => {
  await pool.end();
});

test("COMPANY-01 yalnız superadmin platform şirket listesini görebilir", async ({ request }) => {
  const superadmin = await login(request, credentials.superadmin);
  const companiesResponse = await request.get("/api/companies", {
    headers: authorization(superadmin.token),
  });
  expect(companiesResponse.status()).toBe(200);
  const companies = (await companiesResponse.json()) as Array<Record<string, unknown>>;
  expect(companies.map((company) => company.subdomain)).toEqual(expect.arrayContaining([
    "e2e-tenant-a",
    "e2e-tenant-b",
    "e2e-tenant-c-inactive",
  ]));
  expect(companies.every((company) => !("passwordHash" in company))).toBe(true);

  for (const username of [credentials.standardA1, credentials.adminA, credentials.kontrolAdminA]) {
    const session = await login(request, username);
    expect((await request.get("/api/companies", { headers: authorization(session.token) })).status()).toBe(403);
  }
});

test("COMPANY-02 superadmin company oluşturur, günceller ve boş kaydı siler", async ({ request }) => {
  const { token } = await login(request, credentials.superadmin);
  const subdomain = marker("company").toLowerCase().replaceAll("_", "-");
  let companyId: number | null = null;
  try {
    const createdResponse = await request.post("/api/companies", {
      headers: authorization(token),
      data: { name: marker("Company"), subdomain },
    });
    expect(createdResponse.status()).toBe(201);
    const created = (await createdResponse.json()) as { id: number; subdomain: string; isActive: boolean };
    companyId = created.id;
    expect(created).toMatchObject({ subdomain, isActive: true });

    const updatedResponse = await request.patch(`/api/companies/${companyId}`, {
      headers: authorization(token),
      data: { name: marker("CompanyUpdated") },
    });
    expect(updatedResponse.status()).toBe(200);
    const updated = (await updatedResponse.json()) as { id: number; name: string };
    expect(updated.id).toBe(companyId);

    const deleted = await request.delete(`/api/companies/${companyId}`, {
      headers: authorization(token),
    });
    expect(deleted.status()).toBe(204);
    companyId = null;
  } finally {
    await cleanupById("companies", companyId);
  }
});

test("COMPANY-03 duplicate subdomain reddedilir", async ({ request }) => {
  const { token } = await login(request, credentials.superadmin);
  const subdomain = marker("duplicate-company").toLowerCase().replaceAll("_", "-");
  let companyId: number | null = null;
  try {
    const first = await request.post("/api/companies", {
      headers: authorization(token),
      data: { name: marker("CompanyOne"), subdomain },
    });
    expect(first.status()).toBe(201);
    companyId = ((await first.json()) as { id: number }).id;
    const duplicate = await request.post("/api/companies", {
      headers: authorization(token),
      data: { name: marker("CompanyTwo"), subdomain },
    });
    expect(duplicate.status()).toBe(400);
  } finally {
    await cleanupById("companies", companyId);
  }
});

test("COMPANY-04 firma rolleri company mutation yapamaz", async ({ request }) => {
  for (const username of [credentials.adminA, credentials.kontrolAdminA, credentials.standardA1]) {
    const { token } = await login(request, username);
    const headers = authorization(token);
    expect((await request.post("/api/companies", { headers, data: { name: "blocked", subdomain: marker("blocked") } })).status()).toBe(403);
    expect((await request.patch(`/api/companies/${ids.companyA}`, { headers, data: { name: "blocked" } })).status()).toBe(403);
    expect((await request.delete(`/api/companies/${ids.companyB}`, { headers })).status()).toBe(403);
  }
});

test("COMPANY-05 bağımlı şirket silme 409 döndürür ve kayıtları korur", async ({ request }) => {
  const { token } = await login(request, credentials.superadmin);
  const before = await pool.query("SELECT id FROM companies WHERE id = $1", [ids.companyB]);
  expect(before.rowCount).toBe(1);
  const response = await request.delete(`/api/companies/${ids.companyB}`, {
    headers: authorization(token),
  });
  expect(response.status()).toBe(409);
  expect((await pool.query("SELECT id FROM companies WHERE id = $1", [ids.companyB])).rowCount).toBe(1);
  expect((await pool.query("SELECT id FROM users WHERE company_id = $1", [ids.companyB])).rowCount).toBeGreaterThan(0);
});

test("COMPANY-06 whitespace company alanları reddedilmelidir", async ({ request }) => {
  const { token } = await login(request, credentials.superadmin);
  let createdId: number | null = null;
  try {
    const response = await request.post("/api/companies", {
      headers: authorization(token),
      data: { name: "   ", subdomain: "   " },
    });
    if (response.status() === 201) createdId = ((await response.json()) as { id: number }).id;
    expect(response.status()).toBe(400);
  } finally {
    await cleanupById("companies", createdId);
  }
});

test("USER-MGMT-01 rol bazlı kullanıcı listeleri tenant scope taşır", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const kontrolAdmin = await login(request, credentials.kontrolAdminA);
  const superadmin = await login(request, credentials.superadmin);
  const standard = await login(request, credentials.standardA1);

  for (const token of [admin.token, kontrolAdmin.token]) {
    const response = await request.get(`/api/users?companyId=${ids.companyB}`, {
      headers: authorization(token),
    });
    expect(response.status()).toBe(200);
    const rows = (await response.json()) as Array<{ companyId: number; username: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.companyId === ids.companyA)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("e2e_user_b1");
    expect(JSON.stringify(rows)).not.toContain("e2e_inactive_company_user");
  }

  const filtered = await request.get(`/api/users?companyId=${ids.companyB}`, {
    headers: authorization(superadmin.token),
  });
  expect(((await filtered.json()) as Array<{ companyId: number }>).every((row) => row.companyId === ids.companyB)).toBe(true);
  expect((await request.get("/api/users", { headers: authorization(standard.token) })).status()).toBe(403);
});

test("USER-MGMT-02 admin body companyId manipülasyonuna rağmen Tenant A kullanıcısı oluşturur", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  const username = marker("admin_user").toLowerCase();
  let userId: number | null = null;
  try {
    const response = await request.post("/api/users", {
      headers: authorization(token),
      data: {
        username,
        password: credentials.password,
        name: marker("AdminUser"),
        role: "user",
        unitId: ids.unitA2,
        companyId: ids.companyB,
      },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number; unitId: number };
    userId = created.id;
    expect(created).toMatchObject({ companyId: ids.companyA, unitId: ids.unitA2 });
  } finally {
    await cleanupById("users", userId);
  }
});

test("USER-MGMT-02 kontrol_admin Tenant A kullanıcısı oluşturabilir", async ({ request }) => {
  const { token } = await login(request, credentials.kontrolAdminA);
  const username = marker("kadmin_user").toLowerCase();
  let userId: number | null = null;
  try {
    const response = await request.post("/api/users", {
      headers: authorization(token),
      data: {
        username,
        password: credentials.password,
        name: marker("KontrolUser"),
        role: "user",
        unitId: ids.unitA1,
      },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number; unitId: number };
    userId = created.id;
    expect(created).toMatchObject({ companyId: ids.companyA, unitId: ids.unitA1 });
  } finally {
    await cleanupById("users", userId);
  }
});

test("USER-MGMT-03 firma adminleri superadmin veya bilinmeyen rol oluşturamaz", async ({ request }) => {
  for (const username of [credentials.adminA, credentials.kontrolAdminA]) {
    const { token } = await login(request, username);
    for (const role of ["superadmin", "root"]) {
      const candidate = marker(`role_${role}`).toLowerCase();
      const response = await request.post("/api/users", {
        headers: authorization(token),
        data: { username: candidate, password: credentials.password, name: candidate, role },
      });
      expect(response.status()).toBe(400);
      expect((await pool.query("SELECT id FROM users WHERE username = $1", [candidate])).rowCount).toBe(0);
    }
  }
});

test("USER-MGMT-04 admin aynı tenant kullanıcıyı günceller, cross-tenant kullanıcıyı güncelleyemez", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  const username = marker("update_user").toLowerCase();
  let userId: number | null = null;
  try {
    const createdResponse = await request.post("/api/users", {
      headers: authorization(token),
      data: { username, password: credentials.password, name: "Before", role: "user", unitId: ids.unitA1 },
    });
    expect(createdResponse.status()).toBe(201);
    userId = ((await createdResponse.json()) as { id: number }).id;
    const updated = await request.patch(`/api/users/${userId}`, {
      headers: authorization(token),
      data: { name: "After", unitId: ids.unitA2, companyId: ids.companyB },
    });
    expect(updated.status()).toBe(200);
    expect(await updated.json()).toMatchObject({ id: userId, name: "After", unitId: ids.unitA2, companyId: ids.companyA });

    expect((await request.patch(`/api/users/${ids.adminB}`, {
      headers: authorization(token),
      data: { name: "Blocked" },
    })).status()).toBe(404);
  } finally {
    await cleanupById("users", userId);
  }
});

test("USER-MGMT-04 Tenant B unitine taşıma reddedilir", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  const response = await request.patch(`/api/users/${ids.standardA1}`, {
    headers: authorization(token),
    data: { unitId: ids.unitB1 },
  });
  expect(response.status()).toBe(400);
  const persisted = await pool.query<{ unit_id: number }>("SELECT unit_id FROM users WHERE id = $1", [ids.standardA1]);
  expect(persisted.rows[0]?.unit_id).toBe(ids.unitA1);
});

test("USER-MGMT-05 kullanıcı silme tenant, standard ve self-delete sınırlarını korur", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const standard = await login(request, credentials.standardA1);
  const username = marker("delete_user").toLowerCase();
  let userId: number | null = null;
  try {
    const created = await request.post("/api/users", {
      headers: authorization(admin.token),
      data: { username, password: credentials.password, name: username, role: "user", unitId: ids.unitA1 },
    });
    userId = ((await created.json()) as { id: number }).id;
    expect((await request.delete(`/api/users/${userId}`, { headers: authorization(standard.token) })).status()).toBe(403);
    expect((await request.delete(`/api/users/${ids.adminB}`, { headers: authorization(admin.token) })).status()).toBe(404);
    expect((await request.delete(`/api/users/${ids.adminA}`, { headers: authorization(admin.token) })).status()).toBe(400);
    expect((await request.delete(`/api/users/${userId}`, { headers: authorization(admin.token) })).status()).toBe(204);
    userId = null;
  } finally {
    await cleanupById("users", userId);
  }
});

test("USER-MGMT-06 username global unique davranır", async ({ request }) => {
  const superadmin = await login(request, credentials.superadmin);
  const username = marker("global_username").toLowerCase();
  let userId: number | null = null;
  try {
    const first = await request.post("/api/users", {
      headers: authorization(superadmin.token),
      data: { username, password: credentials.password, name: "Tenant A", role: "user", unitId: ids.unitA1, companyId: ids.companyA },
    });
    expect(first.status()).toBe(201);
    userId = ((await first.json()) as { id: number }).id;
    const duplicate = await request.post("/api/users", {
      headers: authorization(superadmin.token),
      data: { username, password: credentials.password, name: "Tenant B", role: "user", unitId: ids.unitB1, companyId: ids.companyB },
    });
    expect(duplicate.status()).toBe(400);
  } finally {
    await cleanupById("users", userId);
  }
});

test("USER-MGMT-07 invalid ve cross-tenant unit reddedilir, nullable firma rolleri korunur", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  for (const unitId of [99999999, ids.unitB1]) {
    const username = marker("invalid_unit").toLowerCase();
    const response = await request.post("/api/users", {
      headers: authorization(admin.token),
      data: { username, password: credentials.password, name: username, role: "user", unitId },
    });
    expect(response.status()).toBe(400);
    expect((await pool.query("SELECT id FROM users WHERE username = $1", [username])).rowCount).toBe(0);
  }

  const adminUsername = marker("nullable_admin").toLowerCase();
  let adminId: number | null = null;
  try {
    const response = await request.post("/api/users", {
      headers: authorization(admin.token),
      data: { username: adminUsername, password: credentials.password, name: adminUsername, role: "admin" },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; unitId: null };
    adminId = created.id;
    expect(created.unitId).toBeNull();
  } finally {
    await cleanupById("users", adminId);
  }
});

test("USER-MGMT-08 whitespace kullanıcı alanları reddedilmelidir", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let createdId: number | null = null;
  try {
    const response = await request.post("/api/users", {
      headers: authorization(token),
      data: { username: "   ", password: credentials.password, name: "   ", role: "user", unitId: ids.unitA1 },
    });
    if (response.status() === 201) createdId = ((await response.json()) as { id: number }).id;
    expect(response.status()).toBe(400);
  } finally {
    await cleanupById("users", createdId);
  }
});

test("UNIT-01 rol bazlı unit liste scopeu korunur", async ({ request }) => {
  const standard = await login(request, credentials.standardA1);
  const admin = await login(request, credentials.adminA);
  const kontrolAdmin = await login(request, credentials.kontrolAdminA);
  const superadmin = await login(request, credentials.superadmin);
  const standardRows = (await (await request.get("/api/units", { headers: authorization(standard.token) })).json()) as Array<{ id: number }>;
  expect(standardRows.map((row) => row.id)).toEqual([ids.unitA1]);
  for (const token of [admin.token, kontrolAdmin.token]) {
    const rows = (await (await request.get(`/api/units?companyId=${ids.companyB}`, { headers: authorization(token) })).json()) as Array<{ id: number }>;
    expect(rows.map((row) => row.id).sort()).toEqual([ids.unitA1, ids.unitA2].sort());
  }
  const filtered = (await (await request.get(`/api/units?companyId=${ids.companyB}`, { headers: authorization(superadmin.token) })).json()) as Array<{ id: number }>;
  expect(filtered.map((row) => row.id)).toEqual([ids.unitB1]);
});

test("UNIT-02 admin body companyId manipülasyonuna rağmen Tenant A unit oluşturur", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let unitId: number | null = null;
  try {
    const response = await request.post("/api/units", {
      headers: authorization(token),
      data: { name: marker("AdminUnit"), location: "Test", companyId: ids.companyB },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number };
    unitId = created.id;
    expect(created.companyId).toBe(ids.companyA);
  } finally {
    await cleanupById("units", unitId);
  }
});

test("UNIT-02 kontrol_admin Tenant A unit oluşturabilir", async ({ request }) => {
  const { token } = await login(request, credentials.kontrolAdminA);
  let unitId: number | null = null;
  try {
    const response = await request.post("/api/units", {
      headers: authorization(token),
      data: { name: marker("KontrolUnit"), location: "Test" },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number };
    unitId = created.id;
    expect(created.companyId).toBe(ids.companyA);
  } finally {
    await cleanupById("units", unitId);
  }
});

test("UNIT-02 superadmin seçilen company altında unit oluşturur", async ({ request }) => {
  const { token } = await login(request, credentials.superadmin);
  let unitId: number | null = null;
  try {
    const response = await request.post("/api/units", {
      headers: authorization(token),
      data: { name: marker("SuperUnit"), location: "Test", companyId: ids.companyB },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number };
    unitId = created.id;
    expect(created.companyId).toBe(ids.companyB);
  } finally {
    await cleanupById("units", unitId);
  }
});

test("UNIT-03 admin ve kontrol_admin update tenant scope taşır", async ({ request }) => {
  for (const username of [credentials.adminA, credentials.kontrolAdminA]) {
    const { token } = await login(request, username);
    const original = marker("UnitUpdate");
    let unitId: number | null = null;
    try {
      const created = await request.post("/api/units", {
        headers: authorization(token),
        data: { name: original, location: "Before" },
      });
      unitId = ((await created.json()) as { id: number }).id;
      const updated = await request.patch(`/api/units/${unitId}`, {
        headers: authorization(token),
        data: { location: "After", companyId: ids.companyB },
      });
      expect(updated.status()).toBe(200);
      expect(await updated.json()).toMatchObject({ id: unitId, location: "After", companyId: ids.companyA });
      expect((await request.patch(`/api/units/${ids.unitB1}`, {
        headers: authorization(token),
        data: { location: "Blocked" },
      })).status()).toBe(404);
    } finally {
      await cleanupById("units", unitId);
    }
  }
});

test("UNIT-03 superadmin unit company taşımasını reddeder", async ({ request }) => {
  const { token } = await login(request, credentials.superadmin);
  const response = await request.patch(`/api/units/${ids.unitA1}`, {
    headers: authorization(token),
    data: { companyId: ids.companyB },
  });
  expect(response.status()).toBe(409);
  expect((await pool.query<{ company_id: number }>("SELECT company_id FROM units WHERE id = $1", [ids.unitA1])).rows[0]?.company_id).toBe(ids.companyA);
});

test("UNIT-04 boş unit silinir, bağımlı fixture unit 409 ile korunur", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let unitId: number | null = null;
  try {
    const created = await request.post("/api/units", {
      headers: authorization(token),
      data: { name: marker("DeleteUnit"), location: "Test" },
    });
    unitId = ((await created.json()) as { id: number }).id;
    expect((await request.delete(`/api/units/${unitId}`, { headers: authorization(token) })).status()).toBe(204);
    unitId = null;
    expect((await request.delete(`/api/units/${ids.unitA1}`, { headers: authorization(token) })).status()).toBe(409);
    expect((await pool.query("SELECT id FROM units WHERE id = $1", [ids.unitA1])).rowCount).toBe(1);
    expect((await pool.query("SELECT id FROM sub_units WHERE unit_id = $1", [ids.unitA1])).rowCount).toBeGreaterThan(0);
  } finally {
    await cleanupById("units", unitId);
  }
});

test("UNIT-05 standard direct mutation yapamaz", async ({ request }) => {
  const { token } = await login(request, credentials.standardA1);
  const headers = authorization(token);
  const name = marker("BlockedUnit");
  expect((await request.post("/api/units", { headers, data: { name, location: "Test" } })).status()).toBe(403);
  expect((await request.patch(`/api/units/${ids.unitA1}`, { headers, data: { location: "Blocked" } })).status()).toBe(403);
  expect((await request.delete(`/api/units/${ids.unitA1}`, { headers })).status()).toBe(403);
  expect((await pool.query("SELECT id FROM units WHERE name = $1", [name])).rowCount).toBe(0);
});

test("UNIT-06 null-unit standard güvenli boş sonuç ve mutation 403 alır", async ({ request }) => {
  const { token } = await login(request, credentials.nullUnit);
  const headers = authorization(token);
  expect(await (await request.get("/api/units", { headers })).json()).toEqual([]);
  expect((await request.get(`/api/units/${ids.unitA1}`, { headers })).status()).toBe(403);
  expect((await request.post("/api/units", { headers, data: { name: marker("NullUnit"), location: "Test" } })).status()).toBe(403);
});

test("UNIT-07 duplicate unit adı mevcut sözleşmede company içinde kabul edilir", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  const name = marker("DuplicateUnit");
  const createdIds: number[] = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await request.post("/api/units", {
        headers: authorization(token),
        data: { name, location: `Test ${index}` },
      });
      expect(response.status()).toBe(201);
      createdIds.push(((await response.json()) as { id: number }).id);
    }
    expect((await pool.query("SELECT id FROM units WHERE company_id = $1 AND name = $2", [ids.companyA, name])).rowCount).toBe(2);
  } finally {
    for (const id of createdIds) await cleanupById("units", id);
  }
});

test("UNIT-08 whitespace unit alanları reddedilmelidir", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let unitId: number | null = null;
  try {
    const response = await request.post("/api/units", {
      headers: authorization(token),
      data: { name: "   ", location: "   " },
    });
    if (response.status() === 201) unitId = ((await response.json()) as { id: number }).id;
    expect(response.status()).toBe(400);
  } finally {
    await cleanupById("units", unitId);
  }
});

test("SUBUNIT-01 rol bazlı liste scopeu korunur", async ({ request }) => {
  const standard = await login(request, credentials.standardA1);
  const admin = await login(request, credentials.adminA);
  const kontrolAdmin = await login(request, credentials.kontrolAdminA);
  const superadmin = await login(request, credentials.superadmin);

  const standardRows = (await (await request.get(`/api/sub-units?unitId=${ids.unitB1}`, { headers: authorization(standard.token) })).json()) as Array<{ id: number; companyId: number; unitId: number }>;
  expect(standardRows.some((row) => row.id === ids.subUnitA1)).toBe(true);
  expect(standardRows.every((row) => row.companyId === ids.companyA && row.unitId === ids.unitA1)).toBe(true);
  for (const token of [admin.token, kontrolAdmin.token]) {
    const rows = (await (await request.get("/api/sub-units", { headers: authorization(token) })).json()) as Array<{ id: number; companyId: number; unitId: number }>;
    expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([ids.subUnitA1, ids.subUnitA2]));
    expect(rows.every((row) => row.companyId === ids.companyA && [ids.unitA1, ids.unitA2].includes(row.unitId))).toBe(true);
    expect((await request.get(`/api/sub-units?unitId=${ids.unitB1}`, { headers: authorization(token) })).status()).toBe(403);
  }
  const filtered = (await (await request.get(`/api/sub-units?companyId=${ids.companyB}&unitId=${ids.unitB1}`, { headers: authorization(superadmin.token) })).json()) as Array<{ id: number; companyId: number; unitId: number }>;
  expect(filtered.some((row) => row.id === ids.subUnitB1)).toBe(true);
  expect(filtered.every((row) => row.companyId === ids.companyB && row.unitId === ids.unitB1)).toBe(true);
});

test("SUBUNIT-02 standard cross-unit body değerini kullanamaz ve kayıt session unitte oluşur", async ({ request }) => {
  const { token } = await login(request, credentials.standardA1);
  const name = marker("StandardSubUnit");
  let subUnitId: number | null = null;
  try {
    const response = await request.post("/api/sub-units", {
      headers: authorization(token),
      data: { unitId: ids.unitB1, name },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number; unitId: number };
    subUnitId = created.id;
    expect(created).toMatchObject({ companyId: ids.companyA, unitId: ids.unitA1 });
  } finally {
    await cleanupById("sub_units", subUnitId);
  }
});

test("SUBUNIT-02 admin Tenant A unitlerinde oluşturur, Tenant B parentı reddeder", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  const createdIds: number[] = [];
  try {
    for (const unitId of [ids.unitA1, ids.unitA2]) {
      const response = await request.post("/api/sub-units", {
        headers: authorization(token),
        data: { unitId, name: marker("AdminSubUnit") },
      });
      expect(response.status()).toBe(201);
      createdIds.push(((await response.json()) as { id: number }).id);
    }
    expect((await request.post("/api/sub-units", {
      headers: authorization(token),
      data: { unitId: ids.unitB1, name: marker("BlockedSubUnit") },
    })).status()).toBe(403);
  } finally {
    for (const id of createdIds) await cleanupById("sub_units", id);
  }
});

test("SUBUNIT-02 kontrol_admin Tenant A parentında oluşturabilir", async ({ request }) => {
  const { token } = await login(request, credentials.kontrolAdminA);
  let subUnitId: number | null = null;
  try {
    const response = await request.post("/api/sub-units", {
      headers: authorization(token),
      data: { unitId: ids.unitA2, name: marker("KontrolSubUnit") },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number };
    subUnitId = created.id;
    expect(created.companyId).toBe(ids.companyA);
  } finally {
    await cleanupById("sub_units", subUnitId);
  }
});

test("SUBUNIT-02 superadmin parent unit şirketini effective company olarak kullanır", async ({ request }) => {
  const { token } = await login(request, credentials.superadmin);
  let subUnitId: number | null = null;
  try {
    const response = await request.post("/api/sub-units", {
      headers: authorization(token),
      data: { unitId: ids.unitB1, companyId: ids.companyA, name: marker("SuperSubUnit") },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number; unitId: number };
    subUnitId = created.id;
    expect(created).toMatchObject({ companyId: ids.companyB, unitId: ids.unitB1 });
  } finally {
    await cleanupById("sub_units", subUnitId);
  }
});

test("SUBUNIT-03 update parent/company manipülasyonunu uygulamaz", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let subUnitId: number | null = null;
  try {
    const created = await request.post("/api/sub-units", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, name: marker("UpdateSubUnit") },
    });
    subUnitId = ((await created.json()) as { id: number }).id;
    const response = await request.patch(`/api/sub-units/${subUnitId}`, {
      headers: authorization(token),
      data: { name: "Updated Sub Unit", unitId: ids.unitB1, companyId: ids.companyB },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ id: subUnitId, name: "Updated Sub Unit", unitId: ids.unitA1, companyId: ids.companyA });
    expect((await request.patch(`/api/sub-units/${ids.subUnitB1}`, {
      headers: authorization(token),
      data: { name: "Blocked" },
    })).status()).toBe(404);
  } finally {
    await cleanupById("sub_units", subUnitId);
  }
});

test("SUBUNIT-04 boş test sub-unit silinir ve cross-tenant delete korunur", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let subUnitId: number | null = null;
  try {
    const created = await request.post("/api/sub-units", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, name: marker("DeleteSubUnit") },
    });
    subUnitId = ((await created.json()) as { id: number }).id;
    expect((await request.delete(`/api/sub-units/${ids.subUnitB1}`, { headers: authorization(token) })).status()).toBe(404);
    expect((await request.delete(`/api/sub-units/${subUnitId}`, { headers: authorization(token) })).status()).toBe(204);
    subUnitId = null;
    expect((await pool.query("SELECT id FROM sub_units WHERE id = $1", [ids.subUnitB1])).rowCount).toBe(1);
  } finally {
    await cleanupById("sub_units", subUnitId);
  }
});

test("SUBUNIT-05 duplicate ad aynı ve farklı tenant/unit kapsamında mevcut sözleşmede kabul edilir", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const superadmin = await login(request, credentials.superadmin);
  const name = marker("DuplicateSubUnit");
  const createdIds: number[] = [];
  try {
    for (const [token, unitId] of [
      [admin.token, ids.unitA1],
      [admin.token, ids.unitA1],
      [admin.token, ids.unitA2],
      [superadmin.token, ids.unitB1],
    ] as const) {
      const response = await request.post("/api/sub-units", {
        headers: authorization(token),
        data: { unitId, name },
      });
      expect(response.status()).toBe(201);
      createdIds.push(((await response.json()) as { id: number }).id);
    }
    expect(createdIds).toHaveLength(4);
  } finally {
    for (const id of createdIds) await cleanupById("sub_units", id);
  }
});

test("SUBUNIT-06 missing ve invalid ID validation güvenlidir", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  const headers = authorization(token);
  expect((await request.post("/api/sub-units", { headers, data: {} })).status()).toBe(400);
  expect((await request.get("/api/sub-units?unitId=123abc", { headers })).status()).toBe(400);
  expect((await request.patch("/api/sub-units/123abc", { headers, data: {} })).status()).toBe(400);
  expect((await request.delete("/api/sub-units/0", { headers })).status()).toBe(400);
});

test("SUBUNIT-07 whitespace ad reddedilmelidir", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let subUnitId: number | null = null;
  try {
    const response = await request.post("/api/sub-units", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, name: "   " },
    });
    if (response.status() === 201) subUnitId = ((await response.json()) as { id: number }).id;
    expect(response.status()).toBe(400);
  } finally {
    await cleanupById("sub_units", subUnitId);
  }
});

test("SOURCE-01 rol bazlı enerji kaynağı liste scopeu korunur", async ({ request }) => {
  const standard = await login(request, credentials.standardA1);
  const admin = await login(request, credentials.adminA);
  const kontrolAdmin = await login(request, credentials.kontrolAdminA);
  const superadmin = await login(request, credentials.superadmin);
  const standardRows = (await (await request.get(`/api/energy-sources?unitId=${ids.unitB1}`, { headers: authorization(standard.token) })).json()) as Array<{ id: number; companyId: number; unitId: number }>;
  expect(standardRows.some((row) => row.id === ids.sourceA1)).toBe(true);
  expect(standardRows.every((row) => row.companyId === ids.companyA && row.unitId === ids.unitA1)).toBe(true);
  for (const token of [admin.token, kontrolAdmin.token]) {
    const rows = (await (await request.get("/api/energy-sources", { headers: authorization(token) })).json()) as Array<{ id: number; companyId: number; unitId: number }>;
    expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([ids.sourceA1, ids.sourceA2]));
    expect(rows.every((row) => row.companyId === ids.companyA && [ids.unitA1, ids.unitA2].includes(row.unitId))).toBe(true);
    expect((await request.get(`/api/energy-sources?unitId=${ids.unitB1}`, { headers: authorization(token) })).status()).toBe(403);
  }
  const filtered = (await (await request.get(`/api/energy-sources?companyId=${ids.companyB}&unitId=${ids.unitB1}`, { headers: authorization(superadmin.token) })).json()) as Array<{ id: number; companyId: number; unitId: number }>;
  expect(filtered.some((row) => row.id === ids.sourceB1)).toBe(true);
  expect(filtered.every((row) => row.companyId === ids.companyB && row.unitId === ids.unitB1)).toBe(true);
});

test("SOURCE-02 standard cross-unit body değerini kullanamaz ve source session unitte oluşur", async ({ request }) => {
  const { token } = await login(request, credentials.standardA1);
  let sourceId: number | null = null;
  try {
    const response = await request.post("/api/energy-sources", {
      headers: authorization(token),
      data: { unitId: ids.unitB1, type: "elektrik", name: marker("StandardSource"), unit: "kWh" },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number; unitId: number };
    sourceId = created.id;
    expect(created).toMatchObject({ companyId: ids.companyA, unitId: ids.unitA1 });
  } finally {
    await cleanupById("energy_sources", sourceId);
  }
});

test("SOURCE-02 admin Tenant A kaynağı oluşturur, Tenant B parentı reddeder", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let sourceId: number | null = null;
  try {
    const response = await request.post("/api/energy-sources", {
      headers: authorization(token),
      data: { unitId: ids.unitA2, type: "dogalgaz", name: marker("AdminSource"), unit: "m3", companyId: ids.companyB },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number; unitId: number };
    sourceId = created.id;
    expect(created).toMatchObject({ companyId: ids.companyA, unitId: ids.unitA2 });
    expect((await request.post("/api/energy-sources", {
      headers: authorization(token),
      data: { unitId: ids.unitB1, type: "elektrik", name: marker("BlockedSource") },
    })).status()).toBe(403);
  } finally {
    await cleanupById("energy_sources", sourceId);
  }
});

test("SOURCE-02 kontrol_admin Tenant A kaynağı oluşturabilir", async ({ request }) => {
  const { token } = await login(request, credentials.kontrolAdminA);
  let sourceId: number | null = null;
  try {
    const response = await request.post("/api/energy-sources", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, type: "elektrik", name: marker("KontrolSource"), unit: "kWh" },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number };
    sourceId = created.id;
    expect(created.companyId).toBe(ids.companyA);
  } finally {
    await cleanupById("energy_sources", sourceId);
  }
});

test("SOURCE-02 superadmin parent unit şirketini effective company olarak kullanır", async ({ request }) => {
  const { token } = await login(request, credentials.superadmin);
  let sourceId: number | null = null;
  try {
    const response = await request.post("/api/energy-sources", {
      headers: authorization(token),
      data: { unitId: ids.unitB1, companyId: ids.companyA, type: "elektrik", name: marker("SuperSource"), unit: "kWh" },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; companyId: number; unitId: number };
    sourceId = created.id;
    expect(created).toMatchObject({ companyId: ids.companyB, unitId: ids.unitB1 });
  } finally {
    await cleanupById("energy_sources", sourceId);
  }
});

test("SOURCE-03 update parent/company manipülasyonunu uygulamaz", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let sourceId: number | null = null;
  try {
    const created = await request.post("/api/energy-sources", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, type: "elektrik", name: marker("UpdateSource"), unit: "kWh" },
    });
    sourceId = ((await created.json()) as { id: number }).id;
    const response = await request.patch(`/api/energy-sources/${sourceId}`, {
      headers: authorization(token),
      data: { name: "Updated Source", unitId: ids.unitB1, companyId: ids.companyB },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ id: sourceId, name: "Updated Source", unitId: ids.unitA1, companyId: ids.companyA });
    expect((await request.patch(`/api/energy-sources/${ids.sourceB1}`, {
      headers: authorization(token),
      data: { name: "Blocked" },
    })).status()).toBe(404);
  } finally {
    await cleanupById("energy_sources", sourceId);
  }
});

test("SOURCE-04 bağımsız source silinir ve cross-tenant delete korunur", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let sourceId: number | null = null;
  try {
    const created = await request.post("/api/energy-sources", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, type: "elektrik", name: marker("DeleteSource"), unit: "kWh" },
    });
    sourceId = ((await created.json()) as { id: number }).id;
    expect((await request.delete(`/api/energy-sources/${ids.sourceB1}`, { headers: authorization(token) })).status()).toBe(404);
    expect((await request.delete(`/api/energy-sources/${sourceId}`, { headers: authorization(token) })).status()).toBe(204);
    sourceId = null;
    expect((await pool.query("SELECT id FROM energy_sources WHERE id = $1", [ids.sourceB1])).rowCount).toBe(1);
  } finally {
    await cleanupById("energy_sources", sourceId);
  }
});

test("SOURCE-05 duplicate ad farklı tenant ve unitlerde mevcut sözleşmede kabul edilir", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const superadmin = await login(request, credentials.superadmin);
  const name = marker("DuplicateSource");
  const createdIds: number[] = [];
  try {
    for (const [token, unitId] of [
      [admin.token, ids.unitA1],
      [admin.token, ids.unitA1],
      [admin.token, ids.unitA2],
      [superadmin.token, ids.unitB1],
    ] as const) {
      const response = await request.post("/api/energy-sources", {
        headers: authorization(token),
        data: { unitId, type: "elektrik", name, unit: "kWh" },
      });
      expect(response.status()).toBe(201);
      createdIds.push(((await response.json()) as { id: number }).id);
    }
    expect(createdIds).toHaveLength(4);
  } finally {
    for (const id of createdIds) await cleanupById("energy_sources", id);
  }
});

test("SOURCE-05 missing ve strict ID validation güvenlidir", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  const headers = authorization(token);
  expect((await request.post("/api/energy-sources", { headers, data: {} })).status()).toBe(400);
  expect((await request.get("/api/energy-sources?unitId=123abc", { headers })).status()).toBe(400);
  expect((await request.patch("/api/energy-sources/1.5", { headers, data: {} })).status()).toBe(400);
  expect((await request.delete("/api/energy-sources/-1", { headers })).status()).toBe(400);
});

test("SOURCE-05 whitespace ad reddedilmelidir", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let sourceId: number | null = null;
  try {
    const response = await request.post("/api/energy-sources", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, type: "elektrik", name: "   ", unit: "kWh" },
    });
    if (response.status() === 201) sourceId = ((await response.json()) as { id: number }).id;
    expect(response.status()).toBe(400);
  } finally {
    await cleanupById("energy_sources", sourceId);
  }
});

test("SOURCE-05 bilinmeyen enerji source type reddedilmelidir", async ({ request }) => {
  const { token } = await login(request, credentials.adminA);
  let sourceId: number | null = null;
  try {
    const response = await request.post("/api/energy-sources", {
      headers: authorization(token),
      data: { unitId: ids.unitA1, type: "not-a-source-type", name: marker("InvalidType"), unit: "kWh" },
    });
    if (response.status() === 201) sourceId = ((await response.json()) as { id: number }).id;
    expect(response.status()).toBe(400);
  } finally {
    await cleanupById("energy_sources", sourceId);
  }
});

test("PARENT-01 bütün cross-tenant parent kombinasyonları DB bütünlüğünü korur", async ({ request }) => {
  const admin = await login(request, credentials.adminA);
  const headers = authorization(admin.token);
  const userMarker = marker("ParentUser").toLowerCase();
  const subMarker = marker("ParentSub");
  const sourceMarker = marker("ParentSource");
  expect((await request.post("/api/users", {
    headers,
    data: { username: userMarker, password: credentials.password, name: userMarker, role: "user", unitId: ids.unitB1 },
  })).status()).toBe(400);
  expect((await request.post("/api/sub-units", {
    headers,
    data: { unitId: ids.unitB1, name: subMarker },
  })).status()).toBe(403);
  expect((await request.post("/api/energy-sources", {
    headers,
    data: { unitId: ids.unitB1, type: "elektrik", name: sourceMarker },
  })).status()).toBe(403);
  expect((await pool.query("SELECT id FROM users WHERE username = $1", [userMarker])).rowCount).toBe(0);
  expect((await pool.query("SELECT id FROM sub_units WHERE name = $1", [subMarker])).rowCount).toBe(0);
  expect((await pool.query("SELECT id FROM energy_sources WHERE name = $1", [sourceMarker])).rowCount).toBe(0);
});

test("UI-ORG-01 superadmin şirket ekranı ve create actionını görür", async ({ page }) => {
  await loginUi(page, credentials.superadmin);
  await page.goto("/firmalar");
  await expect(page.getByRole("heading", { name: "Firma Yönetimi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeni Firma" })).toBeVisible();
  await expect(page.getByText("[E2E] Tenant A", { exact: true })).toBeVisible();
  await expect(page.getByText("[E2E] Tenant B", { exact: true })).toBeVisible();
});

test("UI-ORG-02 admin Birimler/Kullanıcılar ve create actionlarını görür", async ({ page }) => {
  await loginUi(page, credentials.adminA);
  await expect(page.locator('a[href="/firmalar"]')).toHaveCount(0);
  await page.goto("/birimler");
  await expect(page.getByRole("tab", { name: "Birimler", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeni Birim" })).toBeVisible();
  await page.getByRole("tab", { name: "Kullanıcılar" }).click();
  await expect(page.getByRole("button", { name: "Kullanıcı Ekle" })).toBeVisible();
});

test("UI-ORG-03 kontrol_admin admin organization görünürlüğünü korur", async ({ page }) => {
  await loginUi(page, credentials.kontrolAdminA);
  await expect(page.locator('a[href="/firmalar"]')).toHaveCount(0);
  await page.goto("/birimler");
  await expect(page.getByRole("tab", { name: "Birimler", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeni Birim" })).toBeVisible();
  await page.getByRole("tab", { name: "Kullanıcılar" }).click();
  await expect(page.getByRole("button", { name: "Kullanıcı Ekle" })).toBeVisible();
});

test("UI-ORG-04 standard yalnız kendi organization sekmelerini görür", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await expect(page.locator('a[href="/firmalar"]')).toHaveCount(0);
  await page.goto("/birimler");
  await expect(page.getByRole("tab", { name: "Kullanıcılar" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Birimler", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Alt Birimler / Lokasyonlar" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Enerji Kaynakları" })).toBeVisible();
});

test("UI-ORG-05 kontrol_admin alt birim oluştururken birim seçebilir", async ({ page }) => {
  await loginUi(page, credentials.kontrolAdminA);
  await page.goto("/birimler");
  await page.getByRole("tab", { name: "Alt Birimler / Lokasyonlar" }).click();
  await page.getByRole("button", { name: "Alt Birim Ekle" }).click();
  await expect(page.getByText("Birim seçin", { exact: true })).toBeVisible();
});

test("UI-ORG-06 kontrol_admin enerji kaynağı oluştururken birim seçebilir", async ({ page }) => {
  await loginUi(page, credentials.kontrolAdminA);
  await page.goto("/birimler");
  await page.getByRole("tab", { name: "Enerji Kaynakları" }).click();
  await page.getByRole("button", { name: "Kaynak Ekle" }).first().click();
  await expect(page.getByText("Birim seçin", { exact: true })).toBeVisible();
});
