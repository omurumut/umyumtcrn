import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Download,
  type Page,
} from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Meters/consumption E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Meters/consumption E2E bağlantısı disposable localhost DB ile eşleşmiyor.");
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
const dashboardRequire = createRequire(resolve(process.cwd(), "artifacts/ems-dashboard/package.json"));
const XLSX = dashboardRequire("xlsx") as {
  read(data: Buffer, options: { type: "buffer" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json<T>(sheet: unknown, options?: { defval?: string }): T[];
    json_to_sheet(rows: Array<Record<string, unknown>>): unknown;
    book_new(): unknown;
    book_append_sheet(workbook: unknown, sheet: unknown, name: string): void;
  };
  write(workbook: unknown, options: { type: "buffer"; bookType: "xlsx" }): Buffer;
};

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
  user: { id: number; role: string; companyId: number; unitId: number | null };
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
  electricMeterA1: number;
  gasMeterA1: number;
  manualMeterA1: number;
  importMeterA1: number;
  dependencyMeterA1: number;
  meterA2: number;
  meterB1: number;
};

type Meter = {
  id: number;
  companyId: number;
  unitId: number | null;
  subUnitId: number | null;
  energySourceId: number | null;
  name: string;
  type: string;
  recordType: string;
  unit: string;
};

type Consumption = {
  id: number;
  companyId: number;
  meterId: number;
  meterName?: string;
  year: number;
  month: number;
  kwh: number;
  tep: number;
  co2: number;
  hdd: number | null;
  cdd: number | null;
  weatherStationNote?: string | null;
  weatherDataMethod?: string | null;
};

let ids: FixtureIds;
let markerCounter = 0;

function marker(prefix: string): string {
  markerCounter += 1;
  return `[E2E] F3A3 ${prefix} ${Date.now()} ${markerCounter}`;
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
      (SELECT id FROM sub_units WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A1') AND name = '[E2E] Campus A1') AS campus_a1,
      (SELECT id FROM sub_units WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A2') AND name = '[E2E] Campus A2') AS campus_a2,
      (SELECT id FROM sub_units WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AND name = '[E2E] Campus A1') AS campus_b1,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A1') AND name = '[E2E] Electricity A1') AS electricity_a1,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A1') AND name = '[E2E] Natural Gas A1') AS gas_a1,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A2') AND name = '[E2E] Electricity A2') AS electricity_a2,
      (SELECT id FROM energy_sources WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AND name = '[E2E] Electricity A1') AS electricity_b1,
      (SELECT id FROM meters WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A1') AND name = '[E2E] Shared Meter') AS electric_meter_a1,
      (SELECT id FROM meters WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Gas Meter A1') AS gas_meter_a1,
      (SELECT id FROM meters WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Manual Meter A1') AS manual_meter_a1,
      (SELECT id FROM meters WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Import Meter A1') AS import_meter_a1,
      (SELECT id FROM meters WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND name = '[E2E] Dependency Meter A1') AS dependency_meter_a1,
      (SELECT id FROM meters WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A2') AND name = '[E2E] Meter A2') AS meter_a2,
      (SELECT id FROM meters WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AND name = '[E2E] Shared Meter') AS meter_b1
  `);
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => !Number.isSafeInteger(value))) {
    throw new Error("Faz 3A.3 fixture kimlikleri çözülemedi.");
  }
  return {
    companyA: row.company_a, companyB: row.company_b,
    unitA1: row.unit_a1, unitA2: row.unit_a2, unitB1: row.unit_b1,
    campusA1: row.campus_a1, campusA2: row.campus_a2, campusB1: row.campus_b1,
    electricityA1: row.electricity_a1, gasA1: row.gas_a1,
    electricityA2: row.electricity_a2, electricityB1: row.electricity_b1,
    electricMeterA1: row.electric_meter_a1, gasMeterA1: row.gas_meter_a1,
    manualMeterA1: row.manual_meter_a1, importMeterA1: row.import_meter_a1,
    dependencyMeterA1: row.dependency_meter_a1, meterA2: row.meter_a2, meterB1: row.meter_b1,
  };
}

function meterBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: marker("meter"), type: "elektrik", unit: "kWh", location: "E2E Panel",
    city: "Ankara / Cankaya", unitId: ids.unitA1, subUnitId: ids.campusA1,
    energySourceId: ids.electricityA1, uiRecordType: "measurement", ...overrides,
  };
}

async function createMeter(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ response: APIResponse; meter: Meter | null }> {
  const response = await request.post("/api/meters", {
    headers: authorization(token), data: meterBody(overrides),
  });
  return { response, meter: response.status() === 201 ? (await response.json()) as Meter : null };
}

async function createConsumption(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ response: APIResponse; record: Consumption | null }> {
  const response = await request.post("/api/consumption", {
    headers: authorization(token),
    data: { meterId: ids.importMeterA1, year: 2090, month: 1, kwh: 500, hdd: 5, cdd: 2, ...overrides },
  });
  return { response, record: response.status() === 201 ? (await response.json()) as Consumption : null };
}

async function cleanupMeter(id: number | null): Promise<void> {
  if (id === null) return;
  await pool.query("DELETE FROM consumption WHERE meter_id = $1", [id]);
  await pool.query("DELETE FROM meters WHERE id = $1", [id]);
}

async function cleanupConsumption(id: number | null): Promise<void> {
  if (id !== null) await pool.query("DELETE FROM consumption WHERE id = $1", [id]);
}

async function cleanupPeriod(meterId: number, year: number, months?: number[]): Promise<void> {
  if (months?.length) {
    await pool.query("DELETE FROM consumption WHERE meter_id = $1 AND year = $2 AND month = ANY($3::int[])", [meterId, year, months]);
  } else {
    await pool.query("DELETE FROM consumption WHERE meter_id = $1 AND year = $2", [meterId, year]);
  }
}

async function countMetersByName(name: string): Promise<number> {
  const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM meters WHERE name = $1", [name]);
  return Number(result.rows[0]?.count ?? 0);
}

async function countConsumption(meterId: number, year: number, month: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM consumption WHERE meter_id = $1 AND year = $2 AND month = $3",
    [meterId, year, month],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function downloadBuffer(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function xlsxRows(download: Download): Promise<Array<Record<string, unknown>>> {
  const workbook = XLSX.read(await downloadBuffer(download), { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]!];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
}

test.beforeAll(async () => { ids = await resolveFixtureIds(); });
test.afterAll(async () => { await pool.end(); });

test("METER-01 standard yalnız Unit A1 sayaçlarını listeler", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const response = await request.get("/api/meters", { headers: authorization(session.token) });
  expect(response.status()).toBe(200);
  const rows = (await response.json()) as Meter[];
  expect(rows.length).toBeGreaterThanOrEqual(6);
  expect(rows.every((row) => row.companyId === ids.companyA && row.unitId === ids.unitA1)).toBe(true);
  expect(rows.some((row) => row.id === ids.meterA2 || row.id === ids.meterB1)).toBe(false);
});

test("METER-02 null-unit standard listede boş, tekil ve mutation için 403 alır", async ({ request }) => {
  const session = await login(request, credentials.nullUnit);
  const headers = authorization(session.token);
  const list = await request.get("/api/meters", { headers });
  expect(list.status()).toBe(200);
  expect(await list.json()).toEqual([]);
  expect((await request.get(`/api/meters/${ids.electricMeterA1}`, { headers })).status()).toBe(403);
  expect((await request.post("/api/meters", { headers, data: meterBody() })).status()).toBe(403);
});

for (const [label, username] of [["admin", credentials.adminA], ["kontrol_admin", credentials.kontrolAdminA]] as const) {
  test(`METER-03 ${label} Tenant A company scope'unu korur`, async ({ request }) => {
    const session = await login(request, username);
    const headers = authorization(session.token);
    const list = await request.get(`/api/meters?companyId=${ids.companyB}`, { headers });
    expect(list.status()).toBe(200);
    const rows = (await list.json()) as Meter[];
    expect(rows.some((row) => row.id === ids.electricMeterA1)).toBe(true);
    expect(rows.some((row) => row.id === ids.meterA2)).toBe(true);
    expect(rows.every((row) => row.companyId === ids.companyA)).toBe(true);
  });
}

test("METER-04 superadmin platform ve company filtreli liste kullanır", async ({ request }) => {
  const session = await login(request, credentials.superadmin);
  const headers = authorization(session.token);
  const platform = (await (await request.get("/api/meters", { headers })).json()) as Meter[];
  expect(platform.some((row) => row.companyId === ids.companyA)).toBe(true);
  expect(platform.some((row) => row.companyId === ids.companyB)).toBe(true);
  const tenantA = (await (await request.get(`/api/meters?companyId=${ids.companyA}`, { headers })).json()) as Meter[];
  const tenantB = (await (await request.get(`/api/meters?companyId=${ids.companyB}`, { headers })).json()) as Meter[];
  expect(tenantA.every((row) => row.companyId === ids.companyA)).toBe(true);
  expect(tenantB.every((row) => row.companyId === ids.companyB)).toBe(true);
});

for (const value of ["123abc", "0", "-1", "1.5", "9007199254740992"]) {
  test(`METER-ID query companyId=${value} strict 400`, async ({ request }) => {
    const session = await login(request, credentials.superadmin);
    expect((await request.get(`/api/meters?companyId=${encodeURIComponent(value)}`, { headers: authorization(session.token) })).status()).toBe(400);
  });
}

for (const value of ["123abc", "0", "1.5", "9007199254740992"]) {
  test(`METER-ID path id=${value} strict 400`, async ({ request }) => {
    const session = await login(request, credentials.adminA);
    expect((await request.get(`/api/meters/${value}`, { headers: authorization(session.token) })).status()).toBe(400);
  });
}

for (const [label, username] of [
  ["standard", credentials.standardA1], ["admin", credentials.adminA],
  ["kontrol_admin", credentials.kontrolAdminA], ["superadmin", credentials.superadmin],
] as const) {
  test(`METER-05 ${label} geçerli sayaç oluşturur`, async ({ request }) => {
    const session = await login(request, username);
    let meterId: number | null = null;
    try {
      const overrides = label === "superadmin"
        ? { unitId: ids.unitB1, subUnitId: ids.campusB1, energySourceId: ids.electricityB1 }
        : {};
      const { response, meter } = await createMeter(request, session.token, overrides);
      expect(response.status()).toBe(201);
      meterId = meter!.id;
      expect(meter).toMatchObject({
        companyId: label === "superadmin" ? ids.companyB : ids.companyA,
        unitId: label === "superadmin" ? ids.unitB1 : ids.unitA1,
        recordType: "physical_meter",
      });
    } finally { await cleanupMeter(meterId); }
  });
}

test("METER-06 standard cross-unit sub-unit ile sayaç oluşturamaz", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const name = marker("cross-unit");
  const { response } = await createMeter(request, session.token, { name, subUnitId: ids.campusA2 });
  expect([400, 403, 404]).toContain(response.status());
  expect(await countMetersByName(name)).toBe(0);
});

test("METER-06 admin cross-tenant sub-unit ile sayaç oluşturamaz", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const name = marker("cross-tenant-subunit");
  const { response } = await createMeter(request, session.token, { name, subUnitId: ids.campusB1 });
  expect([400, 403, 404]).toContain(response.status());
  expect(await countMetersByName(name)).toBe(0);
});

test("METER-07 Tenant B energy source Tenant A meter'a bağlanamaz", async ({ request }) => {
  const session = await login(request, credentials.kontrolAdminA);
  const name = marker("cross-source");
  const { response } = await createMeter(request, session.token, { name, energySourceId: ids.electricityB1 });
  expect([400, 403, 404]).toContain(response.status());
  expect(await countMetersByName(name)).toBe(0);
});

test("METER-07 superadmin company-parent uyumsuzluğunu reddeder", async ({ request }) => {
  const session = await login(request, credentials.superadmin);
  const name = marker("super-mismatch");
  const { response } = await createMeter(request, session.token, {
    name, unitId: ids.unitA1, subUnitId: ids.campusA1, energySourceId: ids.electricityB1,
  });
  expect([400, 403, 404]).toContain(response.status());
  expect(await countMetersByName(name)).toBe(0);
});

test("METER-08 aynı tenant içinde sayaç adı ve parent ilişkileri güncellenir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let meterId: number | null = null;
  try {
    const created = await createMeter(request, session.token);
    meterId = created.meter!.id;
    const newName = marker("updated");
    const response = await request.patch(`/api/meters/${meterId}`, {
      headers: authorization(session.token),
      data: { name: newName, unitId: ids.unitA2, subUnitId: ids.campusA2, energySourceId: ids.electricityA2 },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ name: newName, unitId: ids.unitA2, subUnitId: ids.campusA2, energySourceId: ids.electricityA2 });
  } finally { await cleanupMeter(meterId); }
});

test("METER-08 standard başka unit sayacını güncelleyemez", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  expect((await request.patch(`/api/meters/${ids.meterA2}`, {
    headers: authorization(session.token), data: { name: marker("forbidden") },
  })).status()).toBe(403);
});

test("METER-08 admin başka tenant sayacını güncelleyemez", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  expect((await request.patch(`/api/meters/${ids.meterB1}`, {
    headers: authorization(session.token), data: { name: marker("forbidden") },
  })).status()).toBe(404);
});

test("METER-08 body companyId manipülasyonu session tenantını değiştirmez", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let meterId: number | null = null;
  try {
    const created = await createMeter(request, session.token, { companyId: ids.companyB });
    expect(created.response.status()).toBe(201);
    meterId = created.meter!.id;
    expect(created.meter!.companyId).toBe(ids.companyA);
  } finally { await cleanupMeter(meterId); }
});

test("METER-09 bağımsız sayaç fiziksel olarak silinir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const created = await createMeter(request, session.token);
  const meterId = created.meter!.id;
  const response = await request.delete(`/api/meters/${meterId}`, { headers: authorization(session.token) });
  expect(response.status()).toBe(204);
  expect((await pool.query("SELECT id FROM meters WHERE id = $1", [meterId])).rowCount).toBe(0);
});

test("METER-09 tüketimli sayaç silinmez ve tüketim korunur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const before = await pool.query("SELECT id FROM consumption WHERE meter_id = $1", [ids.dependencyMeterA1]);
  const response = await request.delete(`/api/meters/${ids.dependencyMeterA1}`, { headers: authorization(session.token) });
  expect(response.status()).toBe(409);
  expect((await pool.query("SELECT id FROM meters WHERE id = $1", [ids.dependencyMeterA1])).rowCount).toBe(1);
  expect((await pool.query("SELECT id FROM consumption WHERE meter_id = $1", [ids.dependencyMeterA1])).rowCount).toBe(before.rowCount);
});

test("METER-10 aynı unit içinde duplicate sayaç adı mevcut sözleşmede kabul edilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const name = marker("duplicate-name");
  const createdIds: number[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const created = await createMeter(request, session.token, { name });
      expect(created.response.status()).toBe(201);
      createdIds.push(created.meter!.id);
    }
    expect(await countMetersByName(name)).toBe(2);
  } finally { for (const id of createdIds) await cleanupMeter(id); }
});

test("METER-TYPE-01 measurement ve manual UI tipleri doğru recordType üretir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const createdIds: number[] = [];
  try {
    for (const [uiRecordType, expected] of [["measurement", "physical_meter"], ["manual", "manual_consumption_point"]] as const) {
      const created = await createMeter(request, session.token, { uiRecordType });
      expect(created.response.status()).toBe(201);
      createdIds.push(created.meter!.id);
      expect(created.meter!.recordType).toBe(expected);
    }
  } finally { for (const id of createdIds) await cleanupMeter(id); }
});

test("METER-TYPE-02 bilinmeyen energy type reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const name = marker("unknown-energy-type");
  let meterId: number | null = null;
  try {
    const created = await createMeter(request, session.token, { name, type: "unknown_type" });
    meterId = created.meter?.id ?? null;
    expect(created.response.status()).toBe(400);
  } finally { await cleanupMeter(meterId); }
});

test("METER-TYPE-03 bilinmeyen UI record type reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let meterId: number | null = null;
  try {
    const created = await createMeter(request, session.token, { uiRecordType: "calculated_unknown" });
    meterId = created.meter?.id ?? null;
    expect(created.response.status()).toBe(400);
  } finally { await cleanupMeter(meterId); }
});

test("METER-VAL zorunlu alan eksikliği DB kaydı oluşturmadan 400 döner", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const name = marker("missing-type");
  const response = await request.post("/api/meters", {
    headers: authorization(session.token), data: meterBody({ name, type: "" }),
  });
  expect(response.status()).toBe(400);
  expect(await countMetersByName(name)).toBe(0);
});

test("METER-VAL whitespace-only name reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let meterId: number | null = null;
  try {
    const created = await createMeter(request, session.token, { name: "   " });
    meterId = created.meter?.id ?? null;
    expect(created.response.status()).toBe(400);
  } finally { await cleanupMeter(meterId); }
});

test("METER-VAL aşırı uzun name reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let meterId: number | null = null;
  try {
    const created = await createMeter(request, session.token, { name: `E2E_${"x".repeat(1000)}` });
    meterId = created.meter?.id ?? null;
    expect(created.response.status()).toBe(400);
  } finally { await cleanupMeter(meterId); }
});

test("CONSUMPTION-01 standard yalnız Unit A1 tüketimlerini listeler", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const response = await request.get("/api/consumption", { headers: authorization(session.token) });
  expect(response.status()).toBe(200);
  const rows = (await response.json()) as Consumption[];
  expect(rows.length).toBeGreaterThanOrEqual(6);
  expect(rows.every((row) => row.companyId === ids.companyA && row.meterId !== ids.meterA2 && row.meterId !== ids.meterB1)).toBe(true);
});

for (const [label, username] of [["admin", credentials.adminA], ["kontrol_admin", credentials.kontrolAdminA]] as const) {
  test(`CONSUMPTION-02 ${label} Tenant A tüketim scope'unu korur`, async ({ request }) => {
    const session = await login(request, username);
    const response = await request.get(`/api/consumption?companyId=${ids.companyB}`, { headers: authorization(session.token) });
    const rows = (await response.json()) as Consumption[];
    expect(response.status()).toBe(200);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.every((row) => row.companyId === ids.companyA)).toBe(true);
  });
}

test("CONSUMPTION-03 superadmin company filtreleri Tenant A/B'yi ayırır", async ({ request }) => {
  const session = await login(request, credentials.superadmin);
  const headers = authorization(session.token);
  const tenantA = (await (await request.get(`/api/consumption?companyId=${ids.companyA}`, { headers })).json()) as Consumption[];
  const tenantB = (await (await request.get(`/api/consumption?companyId=${ids.companyB}`, { headers })).json()) as Consumption[];
  expect(tenantA.every((row) => row.companyId === ids.companyA)).toBe(true);
  expect(tenantB.length).toBeGreaterThanOrEqual(2);
  expect(tenantB.every((row) => row.companyId === ids.companyB)).toBe(true);
});

test("CONSUMPTION-04 null-unit standard boş liste ve mutation 403 alır", async ({ request }) => {
  const session = await login(request, credentials.nullUnit);
  const headers = authorization(session.token);
  expect(await (await request.get("/api/consumption", { headers })).json()).toEqual([]);
  expect((await request.post("/api/consumption", {
    headers, data: { meterId: ids.electricMeterA1, year: 2090, month: 1, kwh: 1 },
  })).status()).toBe(403);
});

for (const [field, value] of [["companyId", "123abc"], ["meterId", "0"], ["unitId", "-1"], ["month", "1.5"], ["year", "9007199254740992"]] as const) {
  test(`CONSUMPTION-ID query ${field}=${value} strict 400`, async ({ request }) => {
    const session = await login(request, credentials.superadmin);
    expect((await request.get(`/api/consumption?${field}=${encodeURIComponent(value)}`, { headers: authorization(session.token) })).status()).toBe(400);
  });
}

test("CONSUMPTION-05 elektrik tüketimi default TEP ve CO2 hesaplar", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let id: number | null = null;
  try {
    const created = await createConsumption(request, session.token, { meterId: ids.electricMeterA1, year: 2091, month: 1, kwh: 500 });
    expect(created.response.status()).toBe(201);
    id = created.record!.id;
    expect(created.record!.tep).toBeCloseTo(0.043, 8);
    expect(created.record!.co2).toBeCloseTo(200, 8);
  } finally { await cleanupConsumption(id); }
});

test("CONSUMPTION-05 doğalgaz tüketimi kaynak katsayılarıyla hesaplanır", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let id: number | null = null;
  try {
    const created = await createConsumption(request, session.token, { meterId: ids.gasMeterA1, year: 2091, month: 2, kwh: 500 });
    expect(created.response.status()).toBe(201);
    id = created.record!.id;
    expect(created.record!.tep).toBeCloseTo(0.43, 8);
    expect(created.record!.co2).toBeCloseTo(101, 8);
  } finally { await cleanupConsumption(id); }
});

test("CONSUMPTION-05 client sahte TEP/CO2 gönderse server authoritative kalır", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let id: number | null = null;
  try {
    const created = await createConsumption(request, session.token, { meterId: ids.electricMeterA1, year: 2091, month: 3, kwh: 500, tep: 999, co2: 999 });
    expect(created.response.status()).toBe(201);
    id = created.record!.id;
    expect(created.record!.tep).toBeCloseTo(0.043, 8);
    expect(created.record!.co2).toBeCloseTo(200, 8);
  } finally { await cleanupConsumption(id); }
});

test("CONSUMPTION-05 manual/fatura tipi sayaç tüketimi kabul eder", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  let id: number | null = null;
  try {
    const created = await createConsumption(request, session.token, { meterId: ids.manualMeterA1, year: 2091, month: 4, kwh: 12.5 });
    expect(created.response.status()).toBe(201);
    id = created.record!.id;
    expect(created.record!.kwh).toBeCloseTo(12.5, 8);
  } finally { await cleanupConsumption(id); }
});

test("CONSUMPTION-06 duplicate meter/year/month 409 ve tek kayıt bırakır", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let id: number | null = null;
  try {
    const first = await createConsumption(request, session.token, { year: 2092, month: 1, kwh: 10 });
    expect(first.response.status()).toBe(201);
    id = first.record!.id;
    const second = await createConsumption(request, session.token, { year: 2092, month: 1, kwh: 20 });
    expect(second.response.status()).toBe(409);
    expect(await second.response.json()).toEqual({ error: "Bu sayaç ve dönem için tüketim kaydı zaten mevcut." });
    expect(await countConsumption(ids.importMeterA1, 2092, 1)).toBe(1);
  } finally { await cleanupConsumption(id); }
});

test("CONSUMPTION-RACE eşzamanlı duplicate create 201/409 ve tek kayıt bırakır", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let meterId: number | null = null;
  try {
    const createdMeter = await createMeter(request, session.token);
    expect(createdMeter.response.status()).toBe(201);
    meterId = createdMeter.meter!.id;
    const data = { meterId, year: 2092, month: 8, kwh: 321.5, hdd: 11.25, cdd: 3.75 };

    const responses = await Promise.all([
      request.post("/api/consumption", { headers: authorization(session.token), data }),
      request.post("/api/consumption", { headers: authorization(session.token), data }),
    ]);
    expect(responses.map((response) => response.status()).sort((a, b) => a - b)).toEqual([201, 409]);
    const conflict = responses.find((response) => response.status() === 409)!;
    expect(await conflict.json()).toEqual({ error: "Bu sayaç ve dönem için tüketim kaydı zaten mevcut." });

    const stored = await pool.query<{ hdd: number; cdd: number; kwh: number }>(
      "SELECT hdd, cdd, kwh FROM consumption WHERE meter_id = $1 AND year = 2092 AND month = 8",
      [meterId],
    );
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0]).toMatchObject({ hdd: 11.25, cdd: 3.75, kwh: 321.5 });
  } finally { await cleanupMeter(meterId); }
});

test("CONSUMPTION-07 kwh güncellemesinde TEP/CO2 yeniden hesaplanır", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let id: number | null = null;
  try {
    const created = await createConsumption(request, session.token, { year: 2092, month: 2, kwh: 100 });
    id = created.record!.id;
    const response = await request.patch(`/api/consumption/${id}`, { headers: authorization(session.token), data: { kwh: 200 } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ kwh: 200, tep: 0.0172, co2: 80 });
  } finally { await cleanupConsumption(id); }
});

test("CONSUMPTION-07 kayıt duplicate döneme taşınamaz", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const idsToDelete: number[] = [];
  try {
    const first = await createConsumption(request, session.token, { year: 2092, month: 3 });
    const second = await createConsumption(request, session.token, { year: 2092, month: 4 });
    idsToDelete.push(first.record!.id, second.record!.id);
    const before = await pool.query<{ meter_id: number; year: number; month: number; kwh: number; hdd: number | null; cdd: number | null }>(
      "SELECT meter_id, year, month, kwh, hdd, cdd FROM consumption WHERE id = $1",
      [second.record!.id],
    );
    const response = await request.patch(`/api/consumption/${second.record!.id}`, {
      headers: authorization(session.token), data: { month: 3 },
    });
    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({ error: "Bu sayaç ve dönem için tüketim kaydı zaten mevcut." });
    expect(await countConsumption(ids.importMeterA1, 2092, 3)).toBe(1);
    expect(await countConsumption(ids.importMeterA1, 2092, 4)).toBe(1);
    const after = await pool.query<{ meter_id: number; year: number; month: number; kwh: number; hdd: number | null; cdd: number | null }>(
      "SELECT meter_id, year, month, kwh, hdd, cdd FROM consumption WHERE id = $1",
      [second.record!.id],
    );
    expect(after.rows).toEqual(before.rows);
  } finally { for (const id of idsToDelete) await cleanupConsumption(id); }
});

test("CONSUMPTION-07 başka tenant meter'a taşıma reddedilir", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let id: number | null = null;
  try {
    const created = await createConsumption(request, session.token, { year: 2092, month: 5 });
    id = created.record!.id;
    expect((await request.patch(`/api/consumption/${id}`, {
      headers: authorization(session.token), data: { meterId: ids.meterB1 },
    })).status()).toBe(404);
  } finally { await cleanupConsumption(id); }
});

test("CONSUMPTION-08 yalnız hedef tüketim kaydı silinir", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const first = await createConsumption(request, session.token, { year: 2092, month: 6 });
  const second = await createConsumption(request, session.token, { year: 2092, month: 7 });
  try {
    expect((await request.delete(`/api/consumption/${first.record!.id}`, { headers: authorization(session.token) })).status()).toBe(204);
    expect((await pool.query("SELECT id FROM consumption WHERE id = $1", [second.record!.id])).rowCount).toBe(1);
  } finally {
    await cleanupConsumption(first.record!.id);
    await cleanupConsumption(second.record!.id);
  }
});

test("CONSUMPTION-08 standard başka unit kaydını silemez", async ({ request }) => {
  const session = await login(request, credentials.standardA1);
  const target = await pool.query<{ id: number }>("SELECT id FROM consumption WHERE meter_id = $1 LIMIT 1", [ids.meterB1]);
  expect((await request.delete(`/api/consumption/${target.rows[0]!.id}`, { headers: authorization(session.token) })).status()).toBe(404);
});

const numericCases: Array<{ label: string; value: unknown; expected: number }> = [
  { label: "sıfır", value: 0, expected: 201 },
  { label: "pozitif decimal", value: 12.3456, expected: 201 },
  { label: "numeric string", value: "15.5", expected: 201 },
  { label: "negatif", value: -1, expected: 400 },
  { label: "boş string", value: "", expected: 400 },
  { label: "Türkçe virgül", value: "1,5", expected: 400 },
  { label: "null", value: null, expected: 400 },
];

for (const [index, numericCase] of numericCases.entries()) {
  test(`CONSUMPTION-NUM ${numericCase.label} sözleşmesi`, async ({ request }) => {
    const session = await login(request, credentials.adminA);
    let id: number | null = null;
    try {
      const created = await createConsumption(request, session.token, { year: 2093, month: index + 1, kwh: numericCase.value });
      id = created.record?.id ?? null;
      expect(created.response.status()).toBe(numericCase.expected);
    } finally { await cleanupConsumption(id); }
  });
}

test("WEATHER-02 MGM fixture yoksa HDD/CDD null ve güvenli not döner", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let id: number | null = null;
  try {
    const created = await createConsumption(request, session.token, { year: 2094, month: 1, hdd: undefined, cdd: undefined });
    expect(created.response.status()).toBe(201);
    id = created.record!.id;
    expect(created.record).toMatchObject({ hdd: null, cdd: null, weatherDataMethod: "no_official_data" });
    expect(created.record!.weatherStationNote).toContain("Ankara / Cankaya");
  } finally { await cleanupConsumption(id); }
});

test("WEATHER-03 client HDD/CDD değerleri mevcut sözleşmede korunur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let id: number | null = null;
  try {
    const created = await createConsumption(request, session.token, { year: 2094, month: 2, hdd: 123.45, cdd: 67.89 });
    id = created.record!.id;
    expect(created.record).toMatchObject({ hdd: 123.45, cdd: 67.89 });
  } finally { await cleanupConsumption(id); }
});

test("WEATHER-04 otomatik lookup meter city değerini kullanır", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  let meterId: number | null = null;
  let consumptionId: number | null = null;
  try {
    const createdMeter = await createMeter(request, session.token, { city: "Adana / Seyhan" });
    meterId = createdMeter.meter!.id;
    const created = await createConsumption(request, session.token, { meterId, year: 2094, month: 3, hdd: undefined, cdd: undefined });
    consumptionId = created.record!.id;
    expect(created.record!.weatherStationNote).toContain("Adana / Seyhan");
    expect(created.record!.weatherStationNote).not.toContain("Ankara / Cankaya");
  } finally { await cleanupConsumption(consumptionId); await cleanupMeter(meterId); }
});

test("CONSUMPTION-IMPORT-02 batch iki farklı ayı ve katsayıları kaydeder", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  try {
    const response = await request.post("/api/consumption/batch", {
      headers: authorization(session.token),
      data: { rows: [
        { meterId: ids.gasMeterA1, year: 2095, month: 1, kwh: 1000 },
        { meterId: ids.gasMeterA1, year: 2095, month: 2, kwh: 1500 },
      ] },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 2, total: 2, errors: [] });
    const rows = await pool.query<{ tep: number; co2: number }>("SELECT tep, co2 FROM consumption WHERE meter_id = $1 AND year = 2095 ORDER BY month", [ids.gasMeterA1]);
    expect(rows.rows[0]).toMatchObject({ tep: 0.86, co2: 202 });
    expect(rows.rows[1]).toMatchObject({ tep: 1.29, co2: 303 });
  } finally { await cleanupPeriod(ids.gasMeterA1, 2095); }
});

test("CONSUMPTION-IMPORT-03 batch duplicate satırı overwrite etmeden raporlar", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  try {
    const response = await request.post("/api/consumption/batch", {
      headers: authorization(session.token),
      data: { rows: [
        { meterId: ids.importMeterA1, year: 2095, month: 3, kwh: 10 },
        { meterId: ids.importMeterA1, year: 2095, month: 3, kwh: 20 },
      ] },
    });
    const body = await response.json() as { imported: number; errors: unknown[] };
    expect(body.imported).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors).toEqual([{ row: 2, message: "Bu sayaç ve dönem için tüketim kaydı zaten mevcut." }]);
    expect(await countConsumption(ids.importMeterA1, 2095, 3)).toBe(1);
  } finally { await cleanupPeriod(ids.importMeterA1, 2095, [3]); }
});

test("CONSUMPTION-IMPORT-04 negatif numeric değer satır hatasıdır", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  try {
    const response = await request.post("/api/consumption/batch", {
      headers: authorization(session.token),
      data: { rows: [{ meterId: ids.importMeterA1, year: 2095, month: 4, kwh: -10 }] },
    });
    expect(await response.json()).toMatchObject({ imported: 0, total: 1, errors: [expect.any(Object)] });
  } finally { await cleanupPeriod(ids.importMeterA1, 2095, [4]); }
});

test("CONSUMPTION-IMPORT-05 admin cross-tenant meter ID kullanamaz", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  const response = await request.post("/api/consumption/batch", {
    headers: authorization(session.token),
    data: { rows: [{ meterId: ids.meterB1, year: 2095, month: 5, kwh: 10 }] },
  });
  expect(await response.json()).toMatchObject({ imported: 0, total: 1, errors: [expect.any(Object)] });
  expect(await countConsumption(ids.meterB1, 2095, 5)).toBe(0);
});

test("CONSUMPTION-IMPORT-06 mixed batch partial başarı sözleşmesini korur", async ({ request }) => {
  const session = await login(request, credentials.adminA);
  try {
    const response = await request.post("/api/consumption/batch", {
      headers: authorization(session.token),
      data: { rows: [
        { meterId: ids.importMeterA1, year: 2095, month: 6, kwh: 10 },
        { meterId: ids.importMeterA1, year: 2095, month: 13, kwh: 10 },
      ] },
    });
    expect(await response.json()).toMatchObject({ imported: 1, total: 2, errors: [expect.any(Object)] });
  } finally { await cleanupPeriod(ids.importMeterA1, 2095, [6]); }
});

test("CONSUMPTION-IMPORT superadmin belirsiz meterName'i reddeder", async ({ request }) => {
  const session = await login(request, credentials.superadmin);
  const response = await request.post("/api/consumption/batch", {
    headers: authorization(session.token),
    data: { rows: [{ meterName: "[E2E] Shared Meter", year: 2095, month: 7, kwh: 10 }] },
  });
  const body = await response.json() as { imported: number; errors: Array<{ message: string }> };
  expect(body.imported).toBe(0);
  expect(body.errors[0]?.message).toBe("Sayaç adı birden fazla şirkette eşleşiyor. companyId veya meterId belirtin.");
});

test("UI-METER-01 standard sayaç ekranında yalnız kendi unit markerlarını görür", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await page.goto("/sayaclar");
  await expect(page.getByRole("heading", { name: "Sayaç Yönetimi" })).toBeVisible();
  await expect(page.getByText("[E2E] Shared Meter", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("[E2E] Meter A2", { exact: true })).toHaveCount(0);
});

for (const [label, username] of [["admin", credentials.adminA], ["kontrol_admin", credentials.kontrolAdminA]] as const) {
  test(`UI-METER-02 ${label} sayaç create/import/export aksiyonlarını görür`, async ({ page }) => {
    await loginUi(page, username);
    await page.goto(`/sayaclar?unitId=${ids.unitA1}`);
    await expect(page.getByRole("button", { name: "Yeni Sayaç" })).toBeVisible();
    await expect(page.getByRole("button", { name: "İçe Aktar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dışa Aktar" })).toBeVisible();
  });
}

test("METER-IMPORT-01 sayaç XLSX şablonu güvenli headerları içerir", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await page.goto("/sayaclar");
  await page.getByRole("button", { name: "İçe Aktar" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Şablon İndir/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("sayac_sablonu.xlsx");
  const rows = await xlsxRows(download);
  expect(Object.keys(rows[0] ?? {})).toEqual(expect.arrayContaining(["Sayaç Adı", "Kayıt Tipi", "Enerji Kaynağı", "Alt Birim", "İl", "İlçe"]));
  expect(JSON.stringify(rows)).not.toContain("[E2E]");
});

test("METER-IMPORT-02 valid ve hatalı satır partial sonucu DB'de doğrulanır", async ({ page }) => {
  const importedName = marker("ui-import");
  try {
    await loginUi(page, credentials.standardA1);
    await page.goto("/sayaclar");
    await page.getByRole("button", { name: "İçe Aktar" }).click();
    const sheet = XLSX.utils.json_to_sheet([
      { "Sayaç Adı": importedName, "Kayıt Tipi": "olcum", "Enerji Kaynağı": "[E2E] Electricity A1", "Alt Birim": "[E2E] Campus A1", "İl": "Ankara", "İlçe": "Cankaya" },
      { "Sayaç Adı": "", "Kayıt Tipi": "olcum", "Enerji Kaynağı": "[E2E] Electricity A1", "Alt Birim": "[E2E] Campus A1" },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sayaçlar");
    const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    await page.locator('input[type="file"]').setInputFiles({ name: "f3a3-meter-import.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
    await expect(page.getByText(/1 sayaç başarıyla eklendi/)).toBeVisible();
    await expect(page.getByText(/"Sayaç Adı" sütunu boş/)).toBeVisible();
    const imported = await pool.query<{ company_id: number; unit_id: number; sub_unit_id: number; energy_source_id: number }>(
      "SELECT company_id, unit_id, sub_unit_id, energy_source_id FROM meters WHERE name = $1",
      [importedName],
    );
    expect(imported.rowCount).toBe(1);
    expect(imported.rows[0]).toMatchObject({ company_id: ids.companyA, unit_id: ids.unitA1, sub_unit_id: ids.campusA1, energy_source_id: ids.electricityA1 });
  } finally {
    await pool.query("DELETE FROM meters WHERE name = $1", [importedName]);
  }
});

test("METER-EXPORT-01 standard XLSX export yalnız görünür unit satırlarını içerir", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await page.goto("/sayaclar");
  await expect(page.getByText("[E2E] Shared Meter", { exact: true }).first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Dışa Aktar" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("sayaclar.xlsx");
  const rows = await xlsxRows(download);
  expect(rows.some((row) => row["Sayaç Adı"] === "[E2E] Shared Meter")).toBe(true);
  expect(rows.some((row) => row["Sayaç Adı"] === "[E2E] Meter A2")).toBe(false);
});

test("UI-CONS-01 standard tüketim ekranında yalnız kendi scope'unu görür", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await page.goto("/tuketim");
  await expect(page.getByRole("heading", { name: "Tüketim Verileri" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Veri Ekle" })).toBeVisible();
  await expect(page.getByText("[E2E] Gas Meter A1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("[E2E] Meter A2", { exact: true })).toHaveCount(0);
});

test("CONSUMPTION-IMPORT-01 tüketim XLSX şablonu indirilebilir", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await page.goto("/tuketim");
  await page.getByRole("button", { name: "Toplu İçe Aktar" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Şablon İndir/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("tuketim_sablonu.xlsx");
  const rows = await xlsxRows(download);
  expect(Object.keys(rows[0] ?? {})).toEqual(expect.arrayContaining(["sayac_adi", "yil", "ay", "kwh", "tep", "co2", "hdd", "cdd"]));
  expect(JSON.stringify(rows)).not.toContain("[E2E]");
});

test("CONSUMPTION-EXPORT-01 standard CSV export tenant dışı marker içermez", async ({ page }) => {
  await loginUi(page, credentials.standardA1);
  await page.goto("/tuketim");
  await expect(page.getByText("[E2E] Gas Meter A1", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Dışa Aktar" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByText("CSV (.csv)", { exact: true }).click();
  const download = await downloadPromise;
  const csv = (await downloadBuffer(download)).toString("utf8");
  expect(download.suggestedFilename()).toMatch(/^tuketim_\d{4}\.csv$/);
  expect(csv).toContain("CO2 (ton)");
  expect(csv).not.toContain("[E2E] Meter A2");
  expect(csv).not.toContain("[E2E] Tenant B");
});
