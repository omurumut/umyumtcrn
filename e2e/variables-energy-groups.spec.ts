import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type APIResponse, type Download, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Variables/EUG E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Variables/EUG E2E bağlantısı disposable localhost DB ile eşleşmiyor.");
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
  standardA2: "e2e_user_a2",
  standardB1: requiredEnv("E2E_STANDARD_B_USERNAME"),
  adminA: requiredEnv("E2E_ADMIN_USERNAME"),
  kontrolAdminA: requiredEnv("E2E_KONTROL_ADMIN_USERNAME"),
  nullUnit: requiredEnv("E2E_NULL_UNIT_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type LoginResult = {
  token: string;
  user: { id: number; role: string; companyId: number; unitId: number | null };
};

type Variable = {
  id: number;
  companyId: number;
  name: string;
  category: string;
  variableType: string;
  sourceType: string;
  scopeType: string;
  isSystemVariable: boolean;
};

type VariableValue = {
  id: number;
  companyId: number;
  variableId: number;
  unitId: number | null;
  periodStart: string;
  periodEnd: string;
  value: number;
  variableName?: string;
};

type EnergyUseGroup = {
  id: number;
  companyId: number;
  unitId: number | null;
  subUnitId: number | null;
  energySourceId: number | null;
  name: string;
  groupType: string;
  meterCount?: number;
};

type FixtureIds = {
  companyA: number;
  companyB: number;
  unitA1: number;
  unitA2: number;
  unitB1: number;
  campusA1: number;
  campusA2: number;
  campusB1: number;
  electricityA1: number;
  gasA1: number;
  electricityA2: number;
  electricityB1: number;
  productionVariableA: number;
  operatingHours: number;
  operatingHoursB: number;
  importVariableA: number;
  dependencyVariableA: number;
  lightingA1: number;
  heatingA1: number;
  groupA2: number;
  lightingB1: number;
};

let ids: FixtureIds;
let markerCounter = 0;

function marker(prefix: string): string {
  markerCounter += 1;
  return `[E2E] F3A4 ${prefix} ${Date.now()} ${markerCounter}`;
}

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
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
}

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<Record<string, number>>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS company_a,
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AS company_b,
      (SELECT id FROM units WHERE name = '[E2E] Unit A1') AS unit_a1,
      (SELECT id FROM units WHERE name = '[E2E] Unit A2') AS unit_a2,
      (SELECT id FROM units WHERE name = '[E2E] Unit B1') AS unit_b1,
      (SELECT id FROM sub_units WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Campus A1' AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A1')) AS campus_a1,
      (SELECT id FROM sub_units WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Campus A2') AS campus_a2,
      (SELECT id FROM sub_units WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AND name = '[E2E] Campus A1') AS campus_b1,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Electricity A1' AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A1')) AS electricity_a1,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Natural Gas A1') AS gas_a1,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Electricity A2') AS electricity_a2,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AND name = '[E2E] Electricity A1') AS electricity_b1,
      (SELECT id FROM variables WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Production Quantity') AS production_variable_a,
      (SELECT id FROM variables WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Operating Hours') AS operating_hours,
      (SELECT id FROM variables WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AND name = '[E2E] Operating Hours') AS operating_hours_b,
      (SELECT id FROM variables WHERE name = '[E2E] Import Variable') AS import_variable_a,
      (SELECT id FROM variables WHERE name = '[E2E] Dependency Variable') AS dependency_variable_a,
      (SELECT id FROM energy_use_groups WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Lighting') AS lighting_a1,
      (SELECT id FROM energy_use_groups WHERE name = '[E2E] Heating') AS heating_a1,
      (SELECT id FROM energy_use_groups WHERE name = '[E2E] Production A2') AS group_a2,
      (SELECT id FROM energy_use_groups WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AND name = '[E2E] Lighting') AS lighting_b1
  `);
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => !Number.isSafeInteger(value))) {
    throw new Error("Faz 3A.4 fixture kimlikleri çözülemedi.");
  }
  return {
    companyA: row.company_a, companyB: row.company_b,
    unitA1: row.unit_a1, unitA2: row.unit_a2, unitB1: row.unit_b1,
    campusA1: row.campus_a1, campusA2: row.campus_a2, campusB1: row.campus_b1,
    electricityA1: row.electricity_a1, gasA1: row.gas_a1,
    electricityA2: row.electricity_a2, electricityB1: row.electricity_b1,
    productionVariableA: row.production_variable_a, operatingHours: row.operating_hours,
    operatingHoursB: row.operating_hours_b, importVariableA: row.import_variable_a,
    dependencyVariableA: row.dependency_variable_a,
    lightingA1: row.lighting_a1, heatingA1: row.heating_a1,
    groupA2: row.group_a2, lightingB1: row.lighting_b1,
  };
}

function variableBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: marker("variable"), category: "operational", unitLabel: "adet",
    variableType: "numeric", sourceType: "operation_manual", scopeType: "company",
    ...overrides,
  };
}

function valueBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    variableId: ids.operatingHours, unitId: ids.unitA1,
    periodStart: "2091-01-01", periodEnd: "2091-01-31", periodType: "monthly", value: 12.5,
    ...overrides,
  };
}

function groupBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: marker("group"), unitId: ids.unitA1, subUnitId: ids.campusA1,
    energySourceId: ids.electricityA1, groupType: "lighting", isActive: true,
    ...overrides,
  };
}

async function createVariable(request: APIRequestContext, token: string, overrides: Record<string, unknown> = {}): Promise<{ response: APIResponse; record: Variable | null }> {
  const response = await request.post("/api/variables", { headers: authorization(token), data: variableBody(overrides) });
  return { response, record: response.status() === 201 ? await response.json() as Variable : null };
}

async function createValue(request: APIRequestContext, token: string, overrides: Record<string, unknown> = {}): Promise<{ response: APIResponse; record: VariableValue | null }> {
  const response = await request.post("/api/variable-values", { headers: authorization(token), data: valueBody(overrides) });
  return { response, record: response.status() === 201 ? await response.json() as VariableValue : null };
}

async function createGroup(request: APIRequestContext, token: string, overrides: Record<string, unknown> = {}): Promise<{ response: APIResponse; record: EnergyUseGroup | null }> {
  const response = await request.post("/api/energy-use-groups", { headers: authorization(token), data: groupBody(overrides) });
  return { response, record: response.status() === 201 ? await response.json() as EnergyUseGroup : null };
}

async function cleanupVariable(id: number | null): Promise<void> {
  if (id === null) return;
  await pool.query("DELETE FROM variable_values WHERE variable_id = $1", [id]);
  await pool.query("DELETE FROM variables WHERE id = $1", [id]);
}

async function cleanupValue(id: number | null): Promise<void> {
  if (id !== null) await pool.query("DELETE FROM variable_values WHERE id = $1", [id]);
}

async function cleanupGroup(id: number | null): Promise<void> {
  if (id !== null) await pool.query("DELETE FROM energy_use_groups WHERE id = $1", [id]);
}

async function countByName(table: "variables" | "energy_use_groups", name: string): Promise<number> {
  const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE name = $1`, [name]);
  return Number(result.rows[0]?.count ?? 0);
}

async function downloadBuffer(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test.beforeAll(async () => { ids = await resolveFixtureIds(); });
test.afterAll(async () => { await pool.end(); });

test("VAR-01 standard A1 ortak company/unit kataloğunu görür, yalnız A1 value scope'unu alır", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const headers = authorization(session.token);
  const definitions = await (await request.get("/api/variables", { headers })).json() as Variable[];
  expect.soft(definitions.some((row) => row.id === ids.productionVariableA)).toBe(true);
  expect.soft(definitions.some((row) => row.id === ids.operatingHours)).toBe(true);
  expect.soft(definitions.some((row) => row.id === ids.operatingHoursB)).toBe(false);
  const rows = await (await request.get("/api/variable-values", { headers })).json() as VariableValue[];
  expect(rows.some((row) => row.variableId === ids.productionVariableA)).toBe(true);
  expect(rows.some((row) => row.variableId === ids.operatingHours && row.unitId === ids.unitA1)).toBe(true);
  expect(rows.some((row) => row.variableId === ids.operatingHours && row.unitId === ids.unitA2)).toBe(false);
  expect(rows.some((row) => row.variableId === ids.operatingHoursB)).toBe(false);
});

test("VAR-02 standard A2 ortak company/unit kataloğunu görür, yalnız A2 value scope'unu alır", async ({ request }) => {
  const session = await login(request, credentials.standardA2);
  const headers = authorization(session.token);
  const definitions = await (await request.get("/api/variables", { headers })).json() as Variable[];
  expect.soft(definitions.some((row) => row.id === ids.productionVariableA)).toBe(true);
  expect.soft(definitions.some((row) => row.id === ids.operatingHours)).toBe(true);
  expect.soft(definitions.some((row) => row.id === ids.operatingHoursB)).toBe(false);
  const rows = await (await request.get("/api/variable-values", { headers })).json() as VariableValue[];
  expect(rows.some((row) => row.variableId === ids.productionVariableA)).toBe(true);
  expect(rows.some((row) => row.variableId === ids.operatingHours && row.unitId === ids.unitA2)).toBe(true);
  expect(rows.some((row) => row.variableId === ids.operatingHours && row.unitId === ids.unitA1)).toBe(false);
  expect(rows.some((row) => row.variableId === ids.operatingHoursB)).toBe(false);
});

test("VAR-03 null-unit standard variable value listesinde company-wide veri görmez ve mutation 403 alır", async ({ request }) => {
  const session = await login(request, credentials.nullUnit);
  const headers = authorization(session.token);
  expect.soft(await (await request.get("/api/variable-values", { headers })).json()).toEqual([]);
  expect((await request.post("/api/variable-values", { headers, data: valueBody({ variableId: ids.productionVariableA, unitId: null }) })).status()).toBe(403);
});

for (const [label, username] of [["admin", credentials.adminA], ["kontrol_admin", credentials.kontrolAdminA]] as const) {
  test(`VAR-04 ${label} Tenant A değişken tanımlarını görür ve companyId manipülasyonu tenantı aşmaz`, async ({ request }) => {
    const session = await login(request, username);
    const rows = await (await request.get(`/api/variables?companyId=${ids.companyB}`, { headers: authorization(session.token) })).json() as Variable[];
    expect(rows.some((row) => row.id === ids.productionVariableA)).toBe(true);
    expect(rows.some((row) => row.companyId === ids.companyB)).toBe(false);
  });
}

test("VAR-05 superadmin platform ve company filtreli variable listesi kullanır", async ({ request }) => {
  const session = await login(request, credentials.superadmin);
  const headers = authorization(session.token);
  const platform = await (await request.get("/api/variables", { headers })).json() as Variable[];
  const tenantB = await (await request.get(`/api/variables?companyId=${ids.companyB}`, { headers })).json() as Variable[];
  expect(platform.some((row) => row.companyId === ids.companyA)).toBe(true);
  expect(platform.some((row) => row.companyId === ids.companyB)).toBe(true);
  expect(tenantB.length).toBeGreaterThan(0);
  expect(tenantB.every((row) => row.companyId === ids.companyB)).toBe(true);
});

for (const value of ["123abc", "0", "1.5", "9007199254740992"]) {
  test(`VAR-ID companyId=${value} strict 400`, async ({ request }) => {
    const session = await login(request, credentials.superadmin);
    expect((await request.get(`/api/variables?companyId=${encodeURIComponent(value)}`, { headers: authorization(session.token) })).status()).toBe(400);
  });
}

test("VAR-06 standard variable definition oluşturamaz", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  expect((await createVariable(request, session.token)).response.status()).toBe(403);
});

for (const [label, username] of [["admin", credentials.adminA], ["kontrol_admin", credentials.kontrolAdminA]] as const) {
  test(`VAR-06 ${label} company-scope variable oluşturur ve body companyId tenantı değiştirmez`, async ({ request }) => {
    const session = await login(request, username);
    const created = await createVariable(request, session.token, { companyId: ids.companyB });
    try {
      expect(created.response.status()).toBe(201);
      expect(created.record?.companyId).toBe(ids.companyA);
      expect(created.record?.scopeType).toBe("company");
    } finally { await cleanupVariable(created.record?.id ?? null); }
  });
}

test("VAR-06 superadmin seçilen company altında variable oluşturur", async ({ request }) => {
  const session = await login(request, credentials.superadmin);
  const created = await createVariable(request, session.token, { companyId: ids.companyB });
  try {
    expect(created.response.status()).toBe(201);
    expect(created.record?.companyId).toBe(ids.companyB);
  } finally { await cleanupVariable(created.record?.id ?? null); }
});

test("VAR-08 admin kendi tenant variable adını ve scope'unu günceller", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createVariable(request, session.token);
  try {
    const updatedName = marker("updated variable");
    const response = await request.put(`/api/variables/${created.record!.id}`, { headers: authorization(session.token), data: { name: updatedName, scopeType: "unit" } });
    expect(response.status()).toBe(200);
    expect((await response.json() as Variable)).toMatchObject({ name: updatedName, scopeType: "unit", companyId: ids.companyA });
  } finally { await cleanupVariable(created.record?.id ?? null); }
});

test("VAR-08 admin başka tenant variable tanımını güncelleyemez", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  expect((await request.put(`/api/variables/${ids.operatingHoursB}`, { headers: authorization(session.token), data: { name: marker("blocked") } })).status()).toBe(404);
});

test("VAR-09 değeri olmayan variable silinir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createVariable(request, session.token);
  const id = created.record!.id;
  expect((await request.delete(`/api/variables/${id}`, { headers: authorization(session.token) })).status()).toBe(204);
  expect((await pool.query("SELECT id FROM variables WHERE id = $1", [id])).rowCount).toBe(0);
});

test("VAR-09 value dependency bulunan variable 409 ile korunur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  expect((await request.delete(`/api/variables/${ids.dependencyVariableA}`, { headers: authorization(session.token) })).status()).toBe(409);
  expect((await pool.query("SELECT id FROM variables WHERE id = $1", [ids.dependencyVariableA])).rowCount).toBe(1);
});

test("VAR-10 aynı company scope ve aynı name mevcut sözleşmede duplicate oluşturur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const name = marker("duplicate variable");
  const first = await createVariable(request, session.token, { name });
  const second = await createVariable(request, session.token, { name });
  try {
    expect(first.response.status()).toBe(201);
    expect(second.response.status()).toBe(201);
    expect(await countByName("variables", name)).toBe(2);
  } finally {
    await cleanupVariable(first.record?.id ?? null);
    await cleanupVariable(second.record?.id ?? null);
  }
});

test("VAR-VAL eksik name DB kaydı oluşturmadan 400 döner", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  expect((await createVariable(request, session.token, { name: "" })).response.status()).toBe(400);
});

test("VAR-VAL whitespace-only ve aşırı uzun name reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const before = await countByName("variables", "   ");
  const whitespace = await createVariable(request, session.token, { name: "   " });
  const longName = `E2E_${"x".repeat(1000)}`;
  const tooLong = await createVariable(request, session.token, { name: longName });
  try {
    expect.soft(whitespace.response.status()).toBe(400);
    expect.soft(tooLong.response.status()).toBe(400);
  }
  finally {
    const rows = await pool.query<{ id: number }>("SELECT id FROM variables WHERE name = '   '");
    for (const row of rows.rows.slice(before)) await cleanupVariable(row.id);
    await cleanupVariable(tooLong.record?.id ?? null);
  }
});

test("VAR-VAL bilinmeyen variableType reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createVariable(request, session.token, { variableType: "unknown-type" });
  try { expect(created.response.status()).toBe(400); }
  finally { await cleanupVariable(created.record?.id ?? null); }
});

test("VAR-VAL bilinmeyen scopeType reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createVariable(request, session.token, { scopeType: "unknown-scope" });
  try { expect(created.response.status()).toBe(400); }
  finally { await cleanupVariable(created.record?.id ?? null); }
});

test("VAR-VAL update geçersiz name/type/scope değerlerini reddeder ve kaydı korur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createVariable(request, session.token);
  try {
    const headers = authorization(session.token);
    expect((await request.put(`/api/variables/${created.record!.id}`, { headers, data: { name: "   " } })).status()).toBe(400);
    expect((await request.put(`/api/variables/${created.record!.id}`, { headers, data: { name: `E2E_${"x".repeat(1000)}` } })).status()).toBe(400);
    expect((await request.put(`/api/variables/${created.record!.id}`, { headers, data: { variableType: "unknown-type" } })).status()).toBe(400);
    expect((await request.put(`/api/variables/${created.record!.id}`, { headers, data: { scopeType: "unknown-scope" } })).status()).toBe(400);
    const stored = await pool.query<{ name: string; variable_type: string; scope_type: string }>("SELECT name, variable_type, scope_type FROM variables WHERE id = $1", [created.record!.id]);
    expect(stored.rows[0]).toEqual({ name: created.record!.name, variable_type: "numeric", scope_type: "company" });
  } finally { await cleanupVariable(created.record?.id ?? null); }
});

test("VALUE-01 standard query unitId manipülasyonuna rağmen kendi scope'unda kalır", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const rows = await (await request.get(`/api/variable-values?unitId=${ids.unitA2}`, { headers: authorization(session.token) })).json() as VariableValue[];
  expect(rows.some((row) => row.variableId === ids.operatingHours && row.unitId === ids.unitA1)).toBe(true);
  expect(rows.some((row) => row.variableId === ids.operatingHours && row.unitId === ids.unitA2)).toBe(false);
});

for (const [label, username] of [["admin", credentials.adminA], ["kontrol_admin", credentials.kontrolAdminA]] as const) {
  test(`VALUE-02 ${label} Tenant A values ve unit filtresini kullanır`, async ({ request }) => {
    const session = await login(request, username);
    const rows = await (await request.get(`/api/variable-values?unitId=${ids.unitA1}`, { headers: authorization(session.token) })).json() as VariableValue[];
    expect(rows.some((row) => row.variableId === ids.operatingHours && row.unitId === ids.unitA1)).toBe(true);
    expect(rows.every((row) => row.companyId === ids.companyA)).toBe(true);
    expect(rows.some((row) => row.companyId === ids.companyB)).toBe(false);
  });
}

test("VALUE-03 superadmin company filtresi Tenant A/B values ayırır", async ({ request }) => {
  const session = await login(request, credentials.superadmin);
  const headers = authorization(session.token);
  const tenantA = await (await request.get(`/api/variable-values?companyId=${ids.companyA}`, { headers })).json() as VariableValue[];
  const tenantB = await (await request.get(`/api/variable-values?companyId=${ids.companyB}`, { headers })).json() as VariableValue[];
  expect(tenantA.length).toBeGreaterThan(0);
  expect(tenantA.every((row) => row.companyId === ids.companyA)).toBe(true);
  expect(tenantB.length).toBeGreaterThan(0);
  expect(tenantB.every((row) => row.companyId === ids.companyB)).toBe(true);
});

test("VALUE-05 admin company-scope variable value oluşturur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createValue(request, session.token, { variableId: ids.productionVariableA, unitId: null });
  try {
    expect(created.response.status()).toBe(201);
    expect(created.record).toMatchObject({ companyId: ids.companyA, unitId: null, value: 12.5 });
  } finally { await cleanupValue(created.record?.id ?? null); }
});

test("VALUE-05 standard kendi unit variable value kaydını oluşturur", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const created = await createValue(request, session.token, { periodStart: "2091-02-01", periodEnd: "2091-02-28", value: 0 });
  try {
    expect(created.response.status()).toBe(201);
    expect(created.record).toMatchObject({ companyId: ids.companyA, unitId: ids.unitA1, value: 0 });
  } finally { await cleanupValue(created.record?.id ?? null); }
});

test("VALUE-05 standard company-scope variable yazamaz", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  expect((await createValue(request, session.token, { variableId: ids.productionVariableA, unitId: null })).response.status()).toBe(403);
});

test("VALUE-05 standard başka unit value oluşturamaz", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  expect((await createValue(request, session.token, { variableId: ids.operatingHours, unitId: ids.unitA2 })).response.status()).toBe(403);
});

test("VALUE-06 duplicate variable/kapsam/dönem 409 ve tek kayıt bırakır", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const first = await createValue(request, session.token, { periodStart: "2092-01-01", periodEnd: "2092-01-31" });
  try {
    expect(first.response.status()).toBe(201);
    expect((await createValue(request, session.token, { periodStart: "2092-01-01", periodEnd: "2092-01-31", value: 999 })).response.status()).toBe(409);
    const count = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM variable_values WHERE variable_id = $1 AND period_start = '2092-01-01'", [ids.operatingHours]);
    expect(Number(count.rows[0]?.count)).toBe(1);
  } finally { await cleanupValue(first.record?.id ?? null); }
});

test("VALUE-07 value güncellemesi numeric precision ve scope'u korur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createValue(request, session.token, { periodStart: "2092-02-01", periodEnd: "2092-02-28" });
  try {
    const response = await request.put(`/api/variable-values/${created.record!.id}`, { headers: authorization(session.token), data: { value: 150.5 } });
    expect(response.status()).toBe(200);
    expect((await response.json() as VariableValue)).toMatchObject({ value: 150.5, unitId: ids.unitA1 });
  } finally { await cleanupValue(created.record?.id ?? null); }
});

test("VALUE-NUM PUT rejects partial numeric input and preserves the stored value", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createValue(request, session.token, { periodStart: "2092-06-01", periodEnd: "2092-06-30", value: 25.5 });
  try {
    const response = await request.put(`/api/variable-values/${created.record!.id}`, { headers: authorization(session.token), data: { value: "12abc" } });
    expect(response.status()).toBe(400);
    const stored = await pool.query<{ value: number }>("SELECT value FROM variable_values WHERE id = $1", [created.record!.id]);
    expect(stored.rows[0]?.value).toBe(25.5);
  } finally { await cleanupValue(created.record?.id ?? null); }
});

test("VALUE-07 başka tenant variable'a taşıma reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createValue(request, session.token, { periodStart: "2092-03-01", periodEnd: "2092-03-31" });
  try {
    expect((await request.put(`/api/variable-values/${created.record!.id}`, { headers: authorization(session.token), data: { variableId: ids.operatingHoursB } })).status()).toBe(400);
  } finally { await cleanupValue(created.record?.id ?? null); }
});

test("VALUE-08 standard yalnız kendi unit value kaydını siler", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const created = await createValue(request, session.token, { periodStart: "2092-04-01", periodEnd: "2092-04-30" });
  expect((await request.delete(`/api/variable-values/${created.record!.id}`, { headers: authorization(session.token) })).status()).toBe(204);
  expect((await pool.query("SELECT id FROM variable_values WHERE id = $1", [created.record!.id])).rowCount).toBe(0);
});

test("VALUE-08 standard başka unit value silemez", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const row = await pool.query<{ id: number }>("SELECT id FROM variable_values WHERE variable_id = $1 AND unit_id = $2 LIMIT 1", [ids.operatingHours, ids.unitA2]);
  expect((await request.delete(`/api/variable-values/${row.rows[0]!.id}`, { headers: authorization(session.token) })).status()).toBe(404);
});

for (const numericCase of [
  { label: "negative", value: -5, status: 201 },
  { label: "empty", value: "", status: 400 },
  { label: "Turkish comma", value: "12,5", status: 400 },
  { label: "partial numeric", value: "12abc", status: 400 },
  { label: "Infinity", value: "Infinity", status: 400 },
] as const) {
  test(`VALUE-NUM ${numericCase.label} sözleşmesi`, async ({ request }) => {
    const session = await login(request, credentials.adminA);
    const created = await createValue(request, session.token, { periodStart: `2093-0${markerCounter % 8 + 1}-01`, periodEnd: `2093-0${markerCounter % 8 + 1}-28`, value: numericCase.value });
    try { expect(created.response.status()).toBe(numericCase.status); }
    finally { await cleanupValue(created.record?.id ?? null); }
  });
}

test("SYSVAR-01 fixture sistem variable üretmez ve weather degree day listesi ayrı endpointtedir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const variables = await (await request.get("/api/variables", { headers: authorization(session.token) })).json() as Variable[];
  expect(variables.filter((row) => row.isSystemVariable)).toEqual([]);
  expect((await request.get("/api/weather-degree-days", { headers: authorization(session.token) })).status()).toBe(200);
});

test("SYSVAR-04 variable create body isSystemVariable manipülasyonunu yok sayar", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createVariable(request, session.token, { isSystemVariable: true, sourceType: "weather_auto" });
  try {
    expect(created.response.status()).toBe(201);
    expect(created.record?.isSystemVariable).toBe(false);
  } finally { await cleanupVariable(created.record?.id ?? null); }
});

test("VAR-IMPORT-02 valid batch iki farklı ayı doğru unit scope'unda kaydeder", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  try {
    const response = await request.post("/api/variable-values/batch", { headers: authorization(session.token), data: { rows: [
      { variable_name: "[E2E] Import Variable", unit_name: "[E2E] Unit A1", year: 2094, month: 1, value: 10 },
      { variable_name: "[E2E] Import Variable", unit_name: "[E2E] Unit A1", year: 2094, month: 2, value: 20.5 },
    ] } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 2, total: 2, errors: [] });
    const rows = await pool.query<{ unit_id: number; value: number }>("SELECT unit_id, value FROM variable_values WHERE variable_id = $1 AND period_start LIKE '2094-%' ORDER BY period_start", [ids.importVariableA]);
    expect(rows.rows).toEqual([{ unit_id: ids.unitA1, value: 10 }, { unit_id: ids.unitA1, value: 20.5 }]);
  } finally { await pool.query("DELETE FROM variable_values WHERE variable_id = $1 AND period_start LIKE '2094-%'", [ids.importVariableA]); }
});

test("VAR-IMPORT-03 duplicate dönem overwrite edilmeden satır hatasıdır", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const response = await request.post("/api/variable-values/batch", { headers: authorization(session.token), data: { rows: [
    { variable_name: "[E2E] Operating Hours", unit_name: "[E2E] Unit A1", year: 2025, month: 1, value: 999 },
  ] } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ imported: 0, total: 1 });
  const original = await pool.query<{ value: number }>("SELECT value FROM variable_values WHERE variable_id = $1 AND unit_id = $2 AND period_start = '2025-01-01'", [ids.operatingHours, ids.unitA1]);
  expect(original.rows[0]?.value).toBe(100);
});

test("VAR-IMPORT-05 admin Tenant B variable name ile tenant aşamaz", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const response = await request.post("/api/variable-values/batch", { headers: authorization(session.token), data: { rows: [
    { variable_name: "[E2E] Operating Hours", unit_name: "[E2E] Unit B1", year: 2094, month: 3, value: 1 },
  ] } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ imported: 0, total: 1 });
});

test("VAR-IMPORT-06 mixed batch partial başarı sözleşmesini korur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  try {
    const response = await request.post("/api/variable-values/batch", { headers: authorization(session.token), data: { rows: [
      { variable_name: "[E2E] Import Variable", unit_name: "[E2E] Unit A1", year: 2094, month: 4, value: 40 },
      { variable_name: "[E2E] Import Variable", unit_name: "[E2E] Unit A1", year: 2094, month: 5, value: "bad" },
    ] } });
    expect(await response.json()).toMatchObject({ imported: 1, total: 2 });
  } finally { await pool.query("DELETE FROM variable_values WHERE variable_id = $1 AND period_start LIKE '2094-04%'", [ids.importVariableA]); }
});

test("VALUE-NUM batch rejects partial numeric input and keeps the valid row", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  try {
    const response = await request.post("/api/variable-values/batch", { headers: authorization(session.token), data: { rows: [
      { variable_name: "[E2E] Import Variable", unit_name: "[E2E] Unit A1", year: 2094, month: 6, value: 60.5 },
      { variable_name: "[E2E] Import Variable", unit_name: "[E2E] Unit A1", year: 2094, month: 7, value: "12,5" },
    ] } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 1, total: 2 });
    const stored = await pool.query<{ period_start: string; value: number }>("SELECT period_start, value FROM variable_values WHERE variable_id = $1 AND period_start IN ('2094-06-01', '2094-07-01') ORDER BY period_start", [ids.importVariableA]);
    expect(stored.rows).toEqual([{ period_start: "2094-06-01", value: 60.5 }]);
  } finally { await pool.query("DELETE FROM variable_values WHERE variable_id = $1 AND period_start IN ('2094-06-01', '2094-07-01')", [ids.importVariableA]); }
});

test("EUG-01 standard A1 yalnız kendi unit gruplarını listeler", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const rows = await (await request.get("/api/energy-use-groups", { headers: authorization(session.token) })).json() as EnergyUseGroup[];
  expect(rows.some((row) => row.id === ids.lightingA1)).toBe(true);
  expect(rows.some((row) => row.id === ids.heatingA1)).toBe(true);
  expect(rows.some((row) => row.id === ids.groupA2)).toBe(false);
  expect(rows.some((row) => row.id === ids.lightingB1)).toBe(false);
});

test("EUG-02 null-unit standard boş liste ve mutation 403 alır", async ({ request }) => {
  const session = await login(request, credentials.nullUnit);
  const headers = authorization(session.token);
  expect(await (await request.get("/api/energy-use-groups", { headers })).json()).toEqual([]);
  expect((await createGroup(request, session.token)).response.status()).toBe(403);
});

for (const [label, username] of [["admin", credentials.adminA], ["kontrol_admin", credentials.kontrolAdminA]] as const) {
  test(`EUG-03 ${label} Tenant A company scope'unu korur`, async ({ request }) => {
    const session = await login(request, username);
    const rows = await (await request.get(`/api/energy-use-groups?companyId=${ids.companyB}`, { headers: authorization(session.token) })).json() as EnergyUseGroup[];
    expect(rows.some((row) => row.id === ids.lightingA1)).toBe(true);
    expect(rows.some((row) => row.id === ids.groupA2)).toBe(true);
    expect(rows.some((row) => row.companyId === ids.companyB)).toBe(false);
  });
}

test("EUG-04 superadmin company filtreleri Tenant A/B'yi ayırır", async ({ request }) => {
  const session = await login(request, credentials.superadmin);
  const headers = authorization(session.token);
  const tenantA = await (await request.get(`/api/energy-use-groups?companyId=${ids.companyA}`, { headers })).json() as EnergyUseGroup[];
  const tenantB = await (await request.get(`/api/energy-use-groups?companyId=${ids.companyB}`, { headers })).json() as EnergyUseGroup[];
  expect(tenantA.every((row) => row.companyId === ids.companyA)).toBe(true);
  expect(tenantB.map((row) => row.id)).toContain(ids.lightingB1);
  expect(tenantB.every((row) => row.companyId === ids.companyB)).toBe(true);
});

test("EUG-05 standard kendi unit parentlarıyla group oluşturur", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const created = await createGroup(request, session.token);
  try {
    expect(created.response.status()).toBe(201);
    expect(created.record).toMatchObject({ companyId: ids.companyA, unitId: ids.unitA1, subUnitId: ids.campusA1, energySourceId: ids.electricityA1 });
  } finally { await cleanupGroup(created.record?.id ?? null); }
});

test("EUG-05 admin body companyId ile tenant değiştiremez", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createGroup(request, session.token, { companyId: ids.companyB });
  try {
    expect(created.response.status()).toBe(201);
    expect(created.record?.companyId).toBe(ids.companyA);
  } finally { await cleanupGroup(created.record?.id ?? null); }
});

test("EUG-06 standard Unit A2 parent ile group oluşturamaz", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const name = marker("cross unit group");
  const response = await createGroup(request, session.token, { name, unitId: ids.unitA2, subUnitId: ids.campusA2, energySourceId: ids.electricityA2 });
  expect(response.response.status()).toBe(400);
  expect(await countByName("energy_use_groups", name)).toBe(0);
});

test("EUG-06 admin Tenant B source ile group oluşturamaz", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const name = marker("cross tenant source");
  const response = await createGroup(request, session.token, { name, energySourceId: ids.electricityB1 });
  expect(response.response.status()).toBe(400);
  expect(await countByName("energy_use_groups", name)).toBe(0);
});

test("EUG-06 farklı unit sub-unit ve source kombinasyonu reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  expect((await createGroup(request, session.token, { unitId: ids.unitA1, subUnitId: ids.campusA2, energySourceId: ids.electricityA1 })).response.status()).toBe(400);
});

test("EUG-07 aynı tenant içinde group adı ve parentları güncellenir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createGroup(request, session.token);
  try {
    const name = marker("updated group");
    const response = await request.put(`/api/energy-use-groups/${created.record!.id}`, { headers: authorization(session.token), data: groupBody({ name, unitId: ids.unitA2, subUnitId: ids.campusA2, energySourceId: ids.electricityA2 }) });
    expect(response.status()).toBe(200);
    expect((await response.json() as EnergyUseGroup)).toMatchObject({ name, companyId: ids.companyA, unitId: ids.unitA2 });
  } finally { await cleanupGroup(created.record?.id ?? null); }
});

test("EUG-07 standard başka unit group güncelleyemez", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  expect((await request.put(`/api/energy-use-groups/${ids.groupA2}`, { headers: authorization(session.token), data: groupBody({ name: marker("blocked group") }) })).status()).toBe(404);
});

test("EUG-08 bağımsız group silinir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createGroup(request, session.token);
  expect((await request.delete(`/api/energy-use-groups/${created.record!.id}`, { headers: authorization(session.token) })).status()).toBe(204);
  expect((await pool.query("SELECT id FROM energy_use_groups WHERE id = $1", [created.record!.id])).rowCount).toBe(0);
});

test("EUG-08 meter dependency bulunan group 409 ile korunur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  expect((await request.delete(`/api/energy-use-groups/${ids.lightingA1}`, { headers: authorization(session.token) })).status()).toBe(409);
  expect((await pool.query("SELECT id FROM energy_use_groups WHERE id = $1", [ids.lightingA1])).rowCount).toBe(1);
});

test("EUG-08 admin başka tenant group silemez", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  expect((await request.delete(`/api/energy-use-groups/${ids.lightingB1}`, { headers: authorization(session.token) })).status()).toBe(404);
});

test("EUG-09 aynı company içinde duplicate aktif group name reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  expect((await createGroup(request, session.token, { name: "[E2E] Lighting", unitId: ids.unitA2, subUnitId: ids.campusA2, energySourceId: ids.electricityA2 })).response.status()).toBe(400);
});

test("EUG-VAL whitespace-only ve aşırı uzun name DB kaydı oluşturmadan 400 döner", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const whitespace = await createGroup(request, session.token, { name: "   " });
  const tooLong = await createGroup(request, session.token, { name: `E2E_${"x".repeat(1000)}` });
  try {
    expect.soft(whitespace.response.status()).toBe(400);
    expect.soft(tooLong.response.status()).toBe(400);
  } finally { await cleanupGroup(tooLong.record?.id ?? null); }
});

test("EUG-VAL update ve batch aşırı uzun name değerini kayıt oluşturmadan reddeder", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createGroup(request, session.token);
  const longName = `E2E_${"x".repeat(1000)}`;
  try {
    const headers = authorization(session.token);
    const update = await request.put(`/api/energy-use-groups/${created.record!.id}`, { headers, data: groupBody({ name: longName }) });
    expect(update.status()).toBe(400);
    const batch = await request.post("/api/energy-use-groups/batch", { headers, data: { rows: [
      { group_name: longName, unit_name: "[E2E] Unit A1", sub_unit_name: "[E2E] Campus A1", energy_source_name: "[E2E] Electricity A1" },
    ] } });
    expect(batch.status()).toBe(200);
    expect(await batch.json()).toMatchObject({ imported: 0, total: 1, errors: [{ row: 1 }] });
    const stored = await pool.query<{ name: string }>("SELECT name FROM energy_use_groups WHERE id = $1", [created.record!.id]);
    expect(stored.rows[0]?.name).toBe(created.record!.name);
    expect((await pool.query("SELECT id FROM energy_use_groups WHERE name = $1", [longName])).rowCount).toBe(0);
  } finally { await cleanupGroup(created.record?.id ?? null); }
});

for (const [field, value] of [["unitId", "123abc"], ["subUnitId", "0"], ["energySourceId", "1.5"]] as const) {
  test(`EUG-ID ${field}=${value} strict 400`, async ({ request }) => {
    const session = await login(request, credentials.adminA);
    expect((await createGroup(request, session.token, { [field]: value })).response.status()).toBe(400);
  });
}

test("EUG-IMPORT valid ve hatalı satır partial sonucu döndürür", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const name = marker("imported group");
  try {
    const response = await request.post("/api/energy-use-groups/batch", { headers: authorization(session.token), data: { rows: [
      { group_name: name, unit_name: "[E2E] Unit A1", sub_unit_name: "[E2E] Campus A1", energy_source_name: "[E2E] Electricity A1" },
      { group_name: "", unit_name: "[E2E] Unit A1" },
    ] } });
    expect(await response.json()).toMatchObject({ imported: 1, total: 2 });
    expect(await countByName("energy_use_groups", name)).toBe(1);
  } finally { await pool.query("DELETE FROM energy_use_groups WHERE name = $1", [name]); }
});

test("EUG-IMPORT cross-tenant parent ID satırı reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const response = await request.post("/api/energy-use-groups/batch", { headers: authorization(session.token), data: { rows: [
    { group_name: marker("cross import"), unitId: ids.unitB1, subUnitId: ids.campusB1, energySourceId: ids.electricityB1 },
  ] } });
  expect(await response.json()).toMatchObject({ imported: 0, total: 1 });
});

test("EUG-EXPORT standard export yalnız Unit A1 ve Tenant A satırlarını içerir", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const rows = await (await request.get("/api/energy-use-groups/export", { headers: authorization(session.token) })).json() as EnergyUseGroup[];
  expect(rows.map((row) => row.id)).toContain(ids.lightingA1);
  expect(rows.map((row) => row.id)).not.toContain(ids.groupA2);
  expect(rows.every((row) => row.companyId === ids.companyA && row.unitId === ids.unitA1)).toBe(true);
});

test("UI-VAR-01 standard variable ekranında Tenant B marker görmez", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await page.goto("/degiskenler");
  await expect(page.getByText("[E2E] Production Quantity", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("[E2E] Tenant B", { exact: false })).toHaveCount(0);
  await page.getByRole("tab", { name: /Değer Girişi/ }).click();
  await page.getByRole("button", { name: /Dışa Aktar/ }).click();
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /CSV/ }).click();
  const csv = (await downloadBuffer(await csvPromise)).toString("utf8");
  expect(csv).toContain("[E2E] Operating Hours");
  expect(csv).not.toContain("[E2E] Unit A2");
  expect(csv).not.toContain("Tenant B");
});

test("UI-VAR-02 admin variable create ve data entry/import-export aksiyonlarını görür", async ({ page }) => {
  await loginUi(page, credentials.adminA);
  await page.goto("/degiskenler");
  await expect(page.getByRole("button", { name: /Değişken Ekle/ })).toBeVisible();
  await page.getByRole("tab", { name: /Değer Girişi/ }).click();
  await expect(page.getByRole("button", { name: /Toplu İçe Aktar/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dışa Aktar/ })).toBeVisible();
  await page.getByRole("button", { name: /Dışa Aktar/ }).click();
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /CSV/ }).click();
  const csv = (await downloadBuffer(await csvPromise)).toString("utf8");
  expect(csv).toContain("Değişken;Kod;Birim;Alt Birim;Dönem Başlangıç;Dönem Bitiş;Değer;Birim Etiketi");
  expect(csv).not.toContain("Tenant B");

  await page.getByRole("button", { name: /Toplu İçe Aktar/ }).click();
  const templatePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Şablon İndir/ }).click();
  const template = await templatePromise;
  const templateBytes = await downloadBuffer(template);
  expect(template.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(templateBytes.subarray(0, 2).toString("ascii")).toBe("PK");
});

test("UI-EUG-01 standard yalnız kendi unit group markerlarını görür", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await page.goto("/enerji-kullanim-gruplari");
  await expect(page.getByText("[E2E] Lighting", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("[E2E] Production A2", { exact: true })).toHaveCount(0);
});

test("UI-EUG-02 kontrol_admin unit filtresi ve create/import/export parity'sine sahiptir", async ({ page }) => {
  await loginUi(page, credentials.kontrolAdminA);
  await page.goto("/enerji-kullanim-gruplari");
  await expect(page.getByRole("button", { name: /Yeni Grup/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Toplu İçe Aktar/ })).toBeVisible();
  await expect(page.getByText("Tüm Birimler", { exact: true })).toHaveCount(3);
});

test("UI-EUG-03 superadmin company context ile Tenant A gruplarını görür", async ({ page }) => {
  await loginUi(page, credentials.superadmin);
  await page.goto("/enerji-kullanim-gruplari");
  await expect(page.getByText("[E2E] Lighting", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Dışa Aktar/ })).toBeVisible();
  await page.getByRole("button", { name: /Dışa Aktar/ }).click();
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /CSV/ }).click();
  const csv = (await downloadBuffer(await csvPromise)).toString("utf8");
  expect(csv).toContain("Birim;Alt Birim;Enerji Kaynağı;Grup Adı");
  expect(csv).not.toContain("[E2E] Tenant B");
  await page.getByRole("button", { name: /Toplu İçe Aktar/ }).click();
  const templatePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Şablon İndir/ }).click();
  const template = await templatePromise;
  expect(template.suggestedFilename()).toMatch(/\.xlsx$/);
  expect((await downloadBuffer(template)).subarray(0, 2).toString("ascii")).toBe("PK");
});
