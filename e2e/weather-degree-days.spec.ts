import { createRequire } from "node:module";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Weather E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Weather E2E bağlantısı disposable localhost DB ile eşleşmiyor.");
  }
  return rawUrl;
}

type QueryResult<Row> = { rows: Row[]; rowCount: number | null };
type TestPool = { query<Row>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>; end(): Promise<void> };
const scriptsRequire = createRequire(resolve(process.cwd(), "scripts/package.json"));
const { Pool } = scriptsRequire("pg") as { Pool: new (options: { connectionString: string }) => TestPool };
const ExcelJS = scriptsRequire("exceljs") as { Workbook: new () => { addWorksheet(name: string): { addRow(values: unknown[]): void }; xlsx: { writeFile(path: string): Promise<void> } } };
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

type Session = { token: string };
type Ids = { companyA: number; companyB: number; unitA1: number; unitA2: number; unitB1: number; meterA1: number; meterA2: number; meterB1: number; acceptedA1: number };
type DegreeDay = { id: number; companyId: number | null; stationKey: string | null; province: string; district: string | null; year: number | null; month: number | null; hdd: number; cdd: number; isOfficial: boolean; periodType: string };
type Consumption = { id: number; hdd: number | null; cdd: number | null; weatherStationName: string | null; weatherStationNote: string | null; weatherDataMethod: string | null };
let ids: Ids;
const tempDir = resolve(process.cwd(), "tmp", "f3a9-weather-e2e");
const mappingFile = resolve(tempDir, "station-mapping.xlsx");
const degreeFile = resolve(tempDir, "degree-days.xlsx");
const invalidDegreeFile = resolve(tempDir, "invalid-degree-days.xlsx");
const mixedDegreeFile = resolve(tempDir, "mixed-degree-days.xlsx");
const mappingFileName = "station-mapping.xlsx";
const degreeFileName = "degree-days.xlsx";
const invalidDegreeFileName = "invalid-degree-days.xlsx";
const mixedDegreeFileName = "mixed-degree-days.xlsx";

function auth(token: string): { Authorization: string } { return { Authorization: `Bearer ${token}` }; }
async function login(request: APIRequestContext, username: string): Promise<Session> {
  const response = await request.post("/api/auth/login", { data: { username, password: credentials.password } });
  expect(response.status()).toBe(200);
  return response.json() as Promise<Session>;
}
async function loginUi(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
}
async function resolveIds(): Promise<Ids> {
  const result = await pool.query<Record<string, number>>(`SELECT
    (SELECT id FROM companies WHERE subdomain='e2e-tenant-a') company_a,
    (SELECT id FROM companies WHERE subdomain='e2e-tenant-b') company_b,
    (SELECT id FROM units WHERE name='[E2E] Unit A1') unit_a1,
    (SELECT id FROM units WHERE name='[E2E] Unit A2') unit_a2,
    (SELECT id FROM units WHERE name='[E2E] Unit B1') unit_b1,
    (SELECT id FROM meters WHERE name='[E2E] Shared Meter' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a')) meter_a1,
    (SELECT id FROM meters WHERE name='[E2E] Meter A2') meter_a2,
    (SELECT id FROM meters WHERE name='[E2E] Shared Meter' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b')) meter_b1,
    (SELECT sai.id FROM seu_assessment_items sai JOIN seu_assessments sa ON sa.id=sai.assessment_id WHERE sai.name='[E2E] SEU Electricity A1' AND sa.unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND sa.record_type='unit_official' LIMIT 1) accepted_a1`);
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => !Number.isSafeInteger(value))) throw new Error("Faz 3A.9 fixture kimlikleri çözülemedi.");
  return { companyA: row.company_a, companyB: row.company_b, unitA1: row.unit_a1, unitA2: row.unit_a2, unitB1: row.unit_b1, meterA1: row.meter_a1, meterA2: row.meter_a2, meterB1: row.meter_b1, acceptedA1: row.accepted_a1 };
}
async function createWorkbook(path: string, headers: string[], rows: unknown[][]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("E2E");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  await workbook.xlsx.writeFile(path);
}
async function createConsumption(request: APIRequestContext, token: string, meterId: number, month: number, extra: Record<string, unknown> = {}): Promise<{ responseStatus: number; body: Consumption | Record<string, unknown> }> {
  const response = await request.post("/api/consumption", { headers: auth(token), data: { meterId, year: 2026, month, kwh: 123, ...extra } });
  return { responseStatus: response.status(), body: await response.json() as Consumption | Record<string, unknown> };
}
async function deleteConsumption(id: number | undefined): Promise<void> { if (id) await pool.query("DELETE FROM consumption WHERE id=$1", [id]); }

test.beforeAll(async () => {
  ids = await resolveIds();
  await mkdir(tempDir, { recursive: true });
  await createWorkbook(mappingFile,
    ["station_key", "station_name", "province", "district", "confidence", "note", "is_active"],
    [["e2e-import-station", "[E2E] Import Station", "[E2E] Import Province", "[E2E] Import District", 1, "[E2E] import", true]]);
  await createWorkbook(degreeFile,
    ["station_key", "station_name", "province", "district", "year", "month", "hdd", "cdd", "source", "is_official"],
    [["e2e-import-station", "[E2E] Import Station", "[E2E] Import Province", "[E2E] Import District", 2028, 1, 123.6, 4.4, "[E2E] disposable", true]]);
  await createWorkbook(invalidDegreeFile,
    ["station_key", "station_name", "province", "year", "month", "hdd", "cdd"],
    [["e2e-import-invalid", "[E2E] Invalid", "[E2E] Import Province", 2028, 13, "bad", "bad"]]);
  await createWorkbook(mixedDegreeFile,
    ["station_key", "station_name", "province", "year", "month", "hdd", "cdd", "is_official"],
    [
      ["e2e-import-mixed", "[E2E] Mixed Valid", "[E2E] Import Province", 2029, 1, 12.75, 3.25, true],
      ["e2e-import-mixed-bad", "[E2E] Mixed Invalid", "[E2E] Import Province", 2029, 13, "bad", 1, true],
    ]);
});

test.afterAll(async () => {
  await pool.query("DELETE FROM consumption WHERE year=2026 AND notes LIKE '[F3A9]%'");
  await pool.query("DELETE FROM weather_degree_days WHERE station_key LIKE 'e2e-import-%'");
  await pool.query("DELETE FROM mgm_station_mappings WHERE station_key LIKE 'e2e-import-%'");
  await rm(tempDir, { recursive: true, force: true });
  await pool.end();
});

for (const route of ["/api/weather", "/api/weather-degree-days", "/api/mgm/stations", "/api/mgm/lookup?city=Ankara&year=2026&month=1", "/api/mgm/lookup-by-location?city=Ankara&year=2026&month=1", "/api/mgm/degree-data?stationCode=E2E-POOL", "/api/admin/mgm/station-mappings", "/api/admin/weather-degree-days"]) {
  test(`AUTH ${route} oturumsuz isteği 401 reddeder`, async ({ request }) => { expect((await request.get(route)).status()).toBe(401); });
}

for (const [role, username] of [["standard", credentials.standardA1], ["admin", credentials.adminA], ["kontrol_admin", credentials.kontrolAdminA]] as const) {
  for (const route of ["/api/admin/mgm/station-mappings", "/api/admin/weather-degree-days", "/api/mgm/sync-log"]) {
    test(`ROLE ${role} ${route} platform verisine erişemez`, async ({ request }) => { const s = await login(request, username); expect((await request.get(route, { headers: auth(s.token) })).status()).toBe(403); });
  }
  test(`ROLE ${role} MGM import mutation yapamaz`, async ({ request }) => {
    const s = await login(request, username);
    expect((await request.post("/api/admin/mgm/station-mapping/import-excel", { headers: auth(s.token), data: { filePath: mappingFile } })).status()).toBe(403);
  });
}

test("ADMIN MGM station mapping listesi yalnız superadmin'e açıktır", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  const response = await request.get("/api/admin/mgm/station-mappings?province=Ankara", { headers: auth(s.token) });
  expect(response.status()).toBe(200);
  const rows = await response.json() as Array<{ stationKey: string; isActive: boolean }>;
  expect(rows.some((row) => row.stationKey === "e2e-ankara-cankaya" && row.isActive)).toBe(true);
});

test("ADMIN resmi degree-day listesi manual company satırlarını içermez", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  const rows = await (await request.get("/api/admin/weather-degree-days?year=2026&province=Ankara", { headers: auth(s.token) })).json() as DegreeDay[];
  expect(rows.some((row) => row.stationKey === "e2e-ankara-cankaya" && row.month === 1)).toBe(true);
  expect(rows.every((row) => row.isOfficial && row.companyId === null)).toBe(true);
});

const lookupYearCases = ["2026abc", "2026.5", "0", "-1", "9007199254740992"];
for (const value of lookupYearCases) test(`STRICT mgm lookup year=${value} 400`, async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  expect((await request.get(`/api/mgm/lookup?city=Ankara%20%2F%20Cankaya&year=${value}&month=1`, { headers: auth(s.token) })).status()).toBe(400);
});
for (const value of ["1abc", "1.5", "0", "13", "-1", "9007199254740992"]) test(`STRICT mgm lookup month=${value} 400`, async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  expect((await request.get(`/api/mgm/lookup?city=Ankara%20%2F%20Cankaya&year=2026&month=${value}`, { headers: auth(s.token) })).status()).toBe(400);
});
for (const value of ["2026abc", "2026.5", "0", "-1"]) test(`STRICT degree-data year=${value} 400`, async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  expect((await request.get(`/api/mgm/degree-data?stationCode=E2E-POOL&year=${value}`, { headers: auth(s.token) })).status()).toBe(400);
});
for (const value of ["2026abc", "2026.5", "0", "-1"]) test(`STRICT admin weather year=${value} 400`, async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  expect((await request.get(`/api/admin/weather-degree-days?year=${value}`, { headers: auth(s.token) })).status()).toBe(400);
});

test("STRICT lookup-by-location invalid year/month 400", async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  expect((await request.get("/api/mgm/lookup-by-location?city=Ankara&year=2026abc&month=1", { headers: auth(s.token) })).status()).toBe(400);
  expect((await request.get("/api/mgm/lookup-by-location?city=Ankara&year=2026&month=1.5", { headers: auth(s.token) })).status()).toBe(400);
});

test("STRICT MGM array-shaped year/month 400", async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  expect((await request.get("/api/mgm/lookup?city=Ankara&year=2026&year=2025&month=1", { headers: auth(s.token) })).status()).toBe(400);
  expect((await request.get("/api/mgm/lookup?city=Ankara&year=2026&month=1&month=2", { headers: auth(s.token) })).status()).toBe(400);
});

test("STRICT admin weather month range 400", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  expect((await request.get("/api/admin/weather-degree-days?year=2026&month=13", { headers: auth(s.token) })).status()).toBe(400);
});

const exactLookups = [
  { month: 1, hdd: 321.5, cdd: 0 },
  { month: 2, hdd: 0, cdd: 0 },
  { month: 7, hdd: 0, cdd: 222.25 },
];
for (const item of exactLookups) test(`LOOKUP Ankara/Cankaya 2026-${item.month} resmi değeri döner`, async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  const response = await request.get(`/api/mgm/lookup?city=Ankara%20%2F%20Cankaya&year=2026&month=${item.month}`, { headers: auth(s.token) });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ stationFound: true, dataMethod: "official_monthly", hdd: item.hdd, cdd: item.cdd });
});

test("LOOKUP eksik ay no_official_data ve null değerler döner", async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  const body = await (await request.get("/api/mgm/lookup?city=Ankara%20%2F%20Cankaya&year=2026&month=3", { headers: auth(s.token) })).json();
  expect(body).toMatchObject({ stationFound: true, dataMethod: "no_official_data", hdd: null, cdd: null });
});

test("LOOKUP bilinmeyen ilçe Ankara merkez fallback kullanır", async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  const body = await (await request.get("/api/mgm/lookup?city=Ankara%20%2F%20Bilinmeyen&year=2026&month=1", { headers: auth(s.token) })).json();
  expect(body).toMatchObject({ stationFound: true, matchType: "province_center", usedProvinceFallback: true, hdd: 300.25, cdd: 1.5 });
});

test("MGM degree-data yıl filtresi E2E pool satırını ayırır", async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  const rows = await (await request.get("/api/mgm/degree-data?stationCode=E2E-POOL&year=2026", { headers: auth(s.token) })).json() as Array<{ year: number }>;
  expect(rows).toHaveLength(1); expect(rows[0]?.year).toBe(2026);
});

for (const [role, username, ownMarker, foreignMarker] of [
  ["standard A", credentials.standardA1, "[E2E] Manual A", "[E2E] Tenant B Manual"],
  ["admin A", credentials.adminA, "[E2E] Manual A", "[E2E] Tenant B Manual"],
  ["kontrol_admin A", credentials.kontrolAdminA, "[E2E] Manual A", "[E2E] Tenant B Manual"],
  ["standard B", credentials.standardB1, "[E2E] Tenant B Manual", "[E2E] Manual A"],
] as const) test(`WDD ${role} global ve kendi company kopyalarını görür`, async ({ request }) => {
  const s = await login(request, username);
  const rows = await (await request.get("/api/weather-degree-days", { headers: auth(s.token) })).json() as DegreeDay[];
  const ownCompanyId = role === "standard B" ? ids.companyB : ids.companyA;
  const foreignCompanyId = role === "standard B" ? ids.companyA : ids.companyB;
  const text = JSON.stringify(rows);
  expect(rows.some((row) => row.companyId === ownCompanyId)).toBe(true);
  expect(rows.some((row) => row.companyId === foreignCompanyId)).toBe(false);
  expect(text).toContain(role === "standard B" ? "[E2E] Tenant B" : ownMarker);
  expect(text).not.toContain(foreignMarker); expect(text).toContain("e2e-ankara-cankaya");
});

test("WDD superadmin company filtresi global+A döndürür, B kopyasını dışlar", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  const text = JSON.stringify(await (await request.get(`/api/weather-degree-days?companyId=${ids.companyA}`, { headers: auth(s.token) })).json());
  expect(text).toContain("[E2E] Manual A"); expect(text).not.toContain("[E2E] Tenant B Manual"); expect(text).toContain("e2e-ankara-cankaya");
});
for (const value of ["123abc", "0", "-1", "1.5", "", "9007199254740992"]) test(`WDD companyId=${value || "empty"} strict 400`, async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  expect((await request.get(`/api/weather-degree-days?companyId=${encodeURIComponent(value)}`, { headers: auth(s.token) })).status()).toBe(400);
});

for (const item of exactLookups) test(`SNAPSHOT consumption 2026-${item.month} resmi HDD/CDD kaydeder`, async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try { const made = await createConsumption(request, s.token, ids.meterA1, item.month, { notes: `[F3A9] snapshot ${item.month}` }); expect(made.responseStatus).toBe(201); const body = made.body as Consumption; id = body.id; expect(body).toMatchObject({ hdd: item.hdd, cdd: item.cdd, weatherDataMethod: "official_monthly" }); }
  finally { await deleteConsumption(id); }
});

test("SNAPSHOT resmi veri olmayan ay null ve no_official_data kaydeder", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try { const made = await createConsumption(request, s.token, ids.meterA1, 3, { notes: "[F3A9] missing" }); expect(made.responseStatus).toBe(201); const body = made.body as Consumption; id = body.id; expect(body).toMatchObject({ hdd: null, cdd: null, weatherDataMethod: "no_official_data" }); }
  finally { await deleteConsumption(id); }
});

test("SNAPSHOT manual HDD/CDD resmi değeri bilinçli override eder", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try { const made = await createConsumption(request, s.token, ids.meterA1, 1, { hdd: 12.5, cdd: 7.25, notes: "[F3A9] manual override" }); expect(made.responseStatus).toBe(201); const body = made.body as Consumption; id = body.id; expect(body).toMatchObject({ hdd: 12.5, cdd: 7.25, weatherDataMethod: null }); }
  finally { await deleteConsumption(id); }
});

for (const [field, value] of [["hdd", -1], ["cdd", -1], ["hdd", "12abc"], ["cdd", "7.5abc"]] as const) test(`VALIDATION consumption ${field}=${value} 400`, async ({ request }) => {
  const s = await login(request, credentials.adminA); const made = await createConsumption(request, s.token, ids.meterA1, 1, { [field]: value, notes: "[F3A9] invalid" });
  if ((made.body as Consumption).id) await deleteConsumption((made.body as Consumption).id); expect(made.responseStatus).toBe(400);
});

test("VALIDATION consumption zero ve decimal HDD/CDD değerlerini korur", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const made = await createConsumption(request, s.token, ids.meterA1, 1, { hdd: 0, cdd: "7.25", notes: "[F3A9] valid degree values" });
    expect(made.responseStatus).toBe(201);
    const body = made.body as Consumption; id = body.id;
    expect(body).toMatchObject({ hdd: 0, cdd: 7.25 });
  } finally { await deleteConsumption(id); }
});

test("VALIDATION invalid HDD PATCH hiçbir alanı değiştirmez", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const made = await createConsumption(request, s.token, ids.meterA1, 1, { hdd: 12.5, cdd: 3.5, notes: "[F3A9] atomic patch" });
    expect(made.responseStatus).toBe(201); id = (made.body as Consumption).id;
    const response = await request.patch(`/api/consumption/${id}`, { headers: auth(s.token), data: { kwh: 999, hdd: "12abc" } });
    expect(response.status()).toBe(400);
    const stored = await pool.query<{ kwh: number; hdd: number; cdd: number }>("SELECT kwh,hdd,cdd FROM consumption WHERE id=$1", [id]);
    expect(stored.rows[0]).toMatchObject({ kwh: 123, hdd: 12.5, cdd: 3.5 });
  } finally { await deleteConsumption(id); }
});

test("VALIDATION batch partial HDD satırını kaydetmez", async ({ request }) => {
  const s = await login(request, credentials.adminA);
  const response = await request.post("/api/consumption/batch", { headers: auth(s.token), data: { rows: [{ meterId: ids.meterA1, year: 2099, month: 1, kwh: 10, hdd: "12abc", notes: "[F3A9] invalid batch degree" }] } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ imported: 0, total: 1 });
  const count = await pool.query<{ count: string }>("SELECT count(*)::text count FROM consumption WHERE meter_id=$1 AND year=2099 AND month=1", [ids.meterA1]);
  expect(Number(count.rows[0]?.count)).toBe(0);
});

test("SNAPSHOT mevcut tüketim resmi pool değişse de geçmiş değeri korur", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try { const made = await createConsumption(request, s.token, ids.meterA1, 1, { notes: "[F3A9] immutable" }); const body = made.body as Consumption; id = body.id; await pool.query("UPDATE weather_degree_days SET hdd=999 WHERE station_key='e2e-ankara-cankaya' AND year=2026 AND month=1 AND is_official=true"); const row = await pool.query<{ hdd: number }>("SELECT hdd FROM consumption WHERE id=$1", [id]); expect(row.rows[0]?.hdd).toBe(321.5); }
  finally { await pool.query("UPDATE weather_degree_days SET hdd=321.5 WHERE station_key='e2e-ankara-cankaya' AND year=2026 AND month=1 AND is_official=true"); await deleteConsumption(id); }
});

test("SNAPSHOT dönem PATCH edilince resmi HDD/CDD yeni dönemden yeniden çözülür", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try { const made = await createConsumption(request, s.token, ids.meterA1, 1, { notes: "[F3A9] period patch" }); id = (made.body as Consumption).id; const response = await request.patch(`/api/consumption/${id}`, { headers: auth(s.token), data: { month: 7 } }); expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ hdd: 0, cdd: 222.25, weatherDataMethod: "official_monthly" }); }
  finally { await deleteConsumption(id); }
});

test("SNAPSHOT-02 meter PATCH uses the new meter location", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const made = await createConsumption(request, s.token, ids.meterA1, 1, { notes: "[F3A9] meter refresh" });
    id = (made.body as Consumption).id;
    const response = await request.patch(`/api/consumption/${id}`, { headers: auth(s.token), data: { meterId: ids.meterA2 } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ hdd: 111.25, cdd: 7.5, weatherDataMethod: "official_monthly" });
  } finally { await deleteConsumption(id); }
});

test("SNAPSHOT-03 explicit manual values survive a period change", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const made = await createConsumption(request, s.token, ids.meterA1, 1, { notes: "[F3A9] manual period" });
    id = (made.body as Consumption).id;
    const response = await request.patch(`/api/consumption/${id}`, { headers: auth(s.token), data: { month: 7, hdd: 12.5, cdd: 7.25 } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ hdd: 12.5, cdd: 7.25, weatherStationName: null, weatherStationNote: null, weatherDataMethod: null });
  } finally { await deleteConsumption(id); }
});

test("SNAPSHOT-04 missing official data does not carry the old snapshot", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const made = await createConsumption(request, s.token, ids.meterA1, 1, { notes: "[F3A9] missing refresh" });
    id = (made.body as Consumption).id;
    const response = await request.patch(`/api/consumption/${id}`, { headers: auth(s.token), data: { month: 3 } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ hdd: null, cdd: null, weatherStationName: null, weatherDataMethod: "no_official_data" });
  } finally { await deleteConsumption(id); }
});

test("SNAPSHOT-05 official zero values remain distinct from missing data", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const made = await createConsumption(request, s.token, ids.meterA1, 1, { notes: "[F3A9] zero refresh" });
    id = (made.body as Consumption).id;
    const response = await request.patch(`/api/consumption/${id}`, { headers: auth(s.token), data: { month: 2 } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ hdd: 0, cdd: 0, weatherDataMethod: "official_monthly" });
  } finally { await deleteConsumption(id); }
});

test("SNAPSHOT-06 kWh-only PATCH preserves the snapshot", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const made = await createConsumption(request, s.token, ids.meterA1, 1, { notes: "[F3A9] kwh only" });
    id = (made.body as Consumption).id;
    const response = await request.patch(`/api/consumption/${id}`, { headers: auth(s.token), data: { kwh: 456 } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ hdd: 321.5, cdd: 0 });
  } finally { await deleteConsumption(id); }
});

test("SNAPSHOT-07 invalid period plus valid kWh remains atomic", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const made = await createConsumption(request, s.token, ids.meterA1, 1, { notes: "[F3A9] invalid period atomic" });
    id = (made.body as Consumption).id;
    expect((await request.patch(`/api/consumption/${id}`, { headers: auth(s.token), data: { month: 13, kwh: 999 } })).status()).toBe(400);
    const stored = await pool.query<{ month: number; kwh: number; hdd: number; cdd: number }>("SELECT month,kwh,hdd,cdd FROM consumption WHERE id=$1", [id]);
    expect(stored.rows[0]).toMatchObject({ month: 1, kwh: 123, hdd: 321.5, cdd: 0 });
  } finally { await deleteConsumption(id); }
});

test("SNAPSHOT-08 cross-tenant meter PATCH preserves the snapshot", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const made = await createConsumption(request, s.token, ids.meterA1, 1, { notes: "[F3A9] cross tenant patch" });
    id = (made.body as Consumption).id;
    expect([403, 404]).toContain((await request.patch(`/api/consumption/${id}`, { headers: auth(s.token), data: { meterId: ids.meterB1 } })).status());
    const stored = await pool.query<{ meter_id: number; hdd: number; cdd: number }>("SELECT meter_id,hdd,cdd FROM consumption WHERE id=$1", [id]);
    expect(stored.rows[0]).toMatchObject({ meter_id: ids.meterA1, hdd: 321.5, cdd: 0 });
  } finally { await deleteConsumption(id); }
});

test("TENANT standard A başka tenant meter için consumption oluşturamaz", async ({ request }) => {
  const s = await login(request, credentials.standardA1); const made = await createConsumption(request, s.token, ids.meterB1, 1, { notes: "[F3A9] cross tenant" }); expect([403, 404]).toContain(made.responseStatus);
});

test("TENANT A2 meter İzmir resmi snapshot alır", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try { const made = await createConsumption(request, s.token, ids.meterA2, 1, { notes: "[F3A9] A2" }); expect(made.responseStatus).toBe(201); const body = made.body as Consumption; id = body.id; expect(body).toMatchObject({ hdd: 111.25, cdd: 7.5 }); }
  finally { await deleteConsumption(id); }
});

test("TENANT B meter Bursa resmi snapshot alır", async ({ request }) => {
  const s = await login(request, credentials.standardB1); let id: number | undefined;
  try { const made = await createConsumption(request, s.token, ids.meterB1, 1, { notes: "[F3A9] B" }); expect(made.responseStatus).toBe(201); const body = made.body as Consumption; id = body.id; expect(body).toMatchObject({ hdd: 777.75, cdd: 88.5 }); }
  finally { await deleteConsumption(id); }
});

test("REGRESSION dataset consumption snapshot HDD/CDD alanlarını kullanır", async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  const response = await request.get(`/api/energy-performance/dataset?seuItemId=${ids.acceptedA1}&year=2025`, { headers: auth(s.token) });
  expect(response.status()).toBe(200);
  const body = await response.json() as { consumptionDataset: Array<{ month: number; hdd: number; cdd: number }> };
  expect(body.consumptionDataset[0]).toMatchObject({ month: 1, hdd: 120, cdd: 10 });
});

test("LEGACY regression fallback başka tenant weather satırını kullanmaz", async ({ request }) => {
  const s = await login(request, credentials.adminA); let id: number | undefined;
  try {
    const inserted = await pool.query<{ id: number }>("INSERT INTO consumption(company_id,meter_id,year,month,kwh,tep,co2,hdd,cdd,notes) VALUES($1,$2,2026,1,10,0,0,NULL,NULL,'[F3A9] regression fallback') RETURNING id", [ids.companyA, ids.meterA2]); id = inserted.rows[0]?.id;
    const body = await (await request.get(`/api/analysis/regression?year=2026&unitId=${ids.unitA2}&meterId=${ids.meterA2}`, { headers: auth(s.token) })).json() as { dataPoints: Array<{ hdd: number }> };
    expect(body.dataPoints[0]?.hdd).toBe(51);
  } finally { await deleteConsumption(id); }
});

for (const [role, username, forbidden] of [["standard A", credentials.standardA1, "[E2E] Legacy Weather Tenant B marker"], ["admin A", credentials.adminA, "[E2E] Legacy Weather Tenant B marker"], ["standard B", credentials.standardB1, "[E2E] Legacy Weather A"]] as const) test(`LEGACY /weather ${role} başka tenant satırını döndürmez`, async ({ request }) => {
  const s = await login(request, username); const text = JSON.stringify(await (await request.get("/api/weather?year=2026", { headers: auth(s.token) })).json()); expect(text).not.toContain(forbidden);
});

test("LEGACY /weather null-unit standard için fail-closed boş sonuç döner", async ({ request }) => {
  const s = await login(request, credentials.nullUnit);
  expect(await (await request.get("/api/weather?year=2026", { headers: auth(s.token) })).json()).toEqual([]);
});

test("LEGACY /weather standard session unit başka unit query ile değiştirilemez", async ({ request }) => {
  const s = await login(request, credentials.standardA1);
  expect((await request.get(`/api/weather?year=2026&unitId=${ids.unitA2}`, { headers: auth(s.token) })).status()).toBe(403);
});

test("LEGACY /weather firma admini foreign unit filtresi kullanamaz", async ({ request }) => {
  const s = await login(request, credentials.adminA);
  expect((await request.get(`/api/weather?year=2026&unitId=${ids.unitB1}`, { headers: auth(s.token) })).status()).toBe(403);
});

test("LEGACY /weather firma admini foreign company query ile tenant değiştiremez", async ({ request }) => {
  const s = await login(request, credentials.adminA);
  const text = JSON.stringify(await (await request.get(`/api/weather?year=2026&companyId=${ids.companyB}`, { headers: auth(s.token) })).json());
  expect(text).toContain("[E2E] Legacy Weather A");
  expect(text).not.toContain("[E2E] Legacy Weather Tenant B marker");
});

test("LEGACY /weather superadmin explicit company context kullanır", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  expect((await request.get("/api/weather?year=2026", { headers: auth(s.token) })).status()).toBe(400);
  const response = await request.get(`/api/weather?year=2026&companyId=${ids.companyA}`, { headers: auth(s.token) });
  expect(response.status()).toBe(200);
  const text = JSON.stringify(await response.json());
  expect(text).toContain("[E2E] Legacy Weather A");
  expect(text).not.toContain("[E2E] Legacy Weather Tenant B marker");
});

test("LEGACY /weather year ve month strict doğrulanır", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  expect((await request.get(`/api/weather?companyId=${ids.companyA}&year=2026abc`, { headers: auth(s.token) })).status()).toBe(400);
  expect((await request.get(`/api/weather?companyId=${ids.companyA}&year=2026&month=13`, { headers: auth(s.token) })).status()).toBe(400);
});

test("LEGACY regression kontrol_admin admin ile aynı scoped weather değerini kullanır", async ({ request }) => {
  const s = await login(request, credentials.kontrolAdminA); let id: number | undefined;
  try {
    const inserted = await pool.query<{ id: number }>("INSERT INTO consumption(company_id,meter_id,year,month,kwh,tep,co2,hdd,cdd,notes) VALUES($1,$2,2026,1,10,0,0,NULL,NULL,'[F3A9] kontrol regression fallback') RETURNING id", [ids.companyA, ids.meterA2]); id = inserted.rows[0]?.id;
    const response = await request.get(`/api/analysis/regression?year=2026&unitId=${ids.unitA2}&meterId=${ids.meterA2}`, { headers: auth(s.token) });
    expect(response.status()).toBe(200);
    expect((await response.json() as { dataPoints: Array<{ hdd: number }> }).dataPoints[0]?.hdd).toBe(51);
  } finally { await deleteConsumption(id); }
});

test("LEGACY regression superadmin company context olmadan fail-closed", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  expect((await request.get(`/api/analysis/regression?year=2026&unitId=${ids.unitA2}&meterId=${ids.meterA2}`, { headers: auth(s.token) })).status()).toBe(400);
});

test("IMPORT station mapping aynı dosyada idempotent update yapar", async ({ request }) => {
  const s = await login(request, credentials.superadmin); const headers = auth(s.token);
  const first = await request.post("/api/admin/mgm/station-mapping/import-excel", { headers, data: { filePath: mappingFileName } }); expect(first.status()).toBe(200);
  const second = await request.post("/api/admin/mgm/station-mapping/import-excel", { headers, data: { filePath: mappingFileName } }); expect(second.status()).toBe(200);
  const count = await pool.query<{ count: string }>("SELECT count(*)::text count FROM mgm_station_mappings WHERE station_key='e2e-import-station'"); expect(Number(count.rows[0]?.count)).toBe(1);
});

test("IMPORT official degree-day aynı station/year/month satırını upsert eder", async ({ request }) => {
  const s = await login(request, credentials.superadmin); const headers = auth(s.token);
  expect((await request.post("/api/admin/weather-degree-days/import-excel", { headers, data: { filePath: degreeFileName } })).status()).toBe(200);
  expect((await request.post("/api/admin/weather-degree-days/import-excel", { headers, data: { filePath: degreeFileName } })).status()).toBe(200);
  const rows = await pool.query<{ count: string; hdd: number; cdd: number }>("SELECT count(*)::text count,max(hdd) hdd,max(cdd) cdd FROM weather_degree_days WHERE station_key='e2e-import-station' AND year=2028 AND month=1");
  expect(Number(rows.rows[0]?.count)).toBe(1); expect(rows.rows[0]).toMatchObject({ hdd: 123.6, cdd: 4.4 });
});

test("IMPORT geçersiz satırı başarı gibi sessizce yutmaz", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  const response = await request.post("/api/admin/weather-degree-days/import-excel", { headers: auth(s.token), data: { filePath: invalidDegreeFileName } });
  expect(response.status()).toBe(400);
});

test("IMPORT summary classifies an idempotent update", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  const response = await request.post("/api/admin/weather-degree-days/import-excel", { headers: auth(s.token), data: { filePath: degreeFileName } });
  expect(response.status()).toBe(200);
  const body = await response.json() as { totalRows: number; inserted: number; updated: number; skipped: number; failed: number; errors: unknown[] };
  expect(body).toMatchObject({ totalRows: 1, inserted: 0, updated: 1, skipped: 0, failed: 0, errors: [] });
  expect(body.totalRows).toBe(body.inserted + body.updated + body.skipped + body.failed);
});

test("IMPORT invalid-only summary reports a safe row error", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  const response = await request.post("/api/admin/weather-degree-days/import-excel", { headers: auth(s.token), data: { filePath: invalidDegreeFileName } });
  expect(response.status()).toBe(400);
  const body = await response.json() as { totalRows: number; inserted: number; updated: number; skipped: number; failed: number; errors: Array<{ rowNumber: number; code: string; message: string }> };
  expect(body).toMatchObject({ totalRows: 1, inserted: 0, updated: 0, skipped: 0, failed: 1 });
  expect(body.totalRows).toBe(body.inserted + body.updated + body.skipped + body.failed);
  expect(body.errors[0]).toMatchObject({ rowNumber: 2, code: "INVALID_MONTH" });
  expect(JSON.stringify(body.errors)).not.toContain("SELECT");
  expect(JSON.stringify(body.errors)).not.toContain(tempDir);
});

test("IMPORT mixed file keeps valid rows and reports invalid rows", async ({ request }) => {
  const s = await login(request, credentials.superadmin);
  const response = await request.post("/api/admin/weather-degree-days/import-excel", { headers: auth(s.token), data: { filePath: mixedDegreeFileName } });
  expect(response.status()).toBe(200);
  const body = await response.json() as { totalRows: number; inserted: number; updated: number; skipped: number; failed: number; errors: Array<{ rowNumber: number; code: string }> };
  expect(body).toMatchObject({ totalRows: 2, inserted: 1, updated: 0, skipped: 0, failed: 1 });
  expect(body.totalRows).toBe(body.inserted + body.updated + body.skipped + body.failed);
  expect(body.errors[0]).toMatchObject({ rowNumber: 3, code: "INVALID_MONTH" });
  const rows = await pool.query<{ station_key: string }>("SELECT station_key FROM weather_degree_days WHERE station_key LIKE 'e2e-import-mixed%' ORDER BY station_key");
  expect(rows.rows.map((row) => row.station_key)).toEqual(["e2e-import-mixed"]);
});

for (const [role, username] of [["standard", credentials.standardA1], ["admin", credentials.adminA], ["kontrol_admin", credentials.kontrolAdminA], ["superadmin", credentials.superadmin]] as const) test(`UI ${role} /meteoroloji kapalı route davranışını güvenli gösterir`, async ({ page }) => {
  await loginUi(page, username); await page.goto("/meteoroloji"); await expect(page).toHaveURL(/\/$/); await expect(page.getByRole("heading", { name: /Meteoroloji|HDD|CDD/ })).toHaveCount(0);
});
