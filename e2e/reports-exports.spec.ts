import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PDFParse } from "pdf-parse";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime value is required.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Reports E2E may run only against the disposable test DB.");
  }
  const raw = requiredEnv("DATABASE_URL");
  const url = new URL(raw);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Reports E2E connection does not match the disposable localhost DB.");
  }
  return raw;
}

type QueryResult<Row> = { rows: Row[]; rowCount: number | null };
type TestPool = { query<Row>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>; end(): Promise<void> };
const scriptsRequire = createRequire(resolve(process.cwd(), "scripts/package.json"));
const { Pool } = scriptsRequire("pg") as { Pool: new (options: { connectionString: string }) => TestPool };
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

type Login = { token: string; user: { companyId: number; unitId: number | null; role: string } };
type Ids = {
  companyA: number; companyB: number; unitA1: number; unitA2: number; unitB1: number;
  officialA1: number;
  acceptedA1: number; acceptedA2: number; acceptedB1: number;
  baselineA1: number; baselineA2: number; baselineB1: number;
  reportBaselineA1: number; reportBaselineA2: number; reportBaselineB1: number;
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
let ids: Ids;
let sessions: Record<string, Login>;
let initialReportMaxId = 0;
let initialSnapshotMaxId = 0;

async function login(request: APIRequestContext, username: string): Promise<Login> {
  const response = await request.post("/api/auth/login", { data: { username, password: credentials.password } });
  expect(response.status()).toBe(200);
  return response.json() as Promise<Login>;
}

async function loginUi(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
}

function decodeDataUrl(dataUrl: string): string {
  expect(dataUrl).toMatch(/^data:text\/html;base64,/);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64").toString("utf8");
}

async function reportHtml(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<string> {
  expect(response.status()).toBe(200);
  if (response.headers()["content-type"]?.includes("application/pdf")) {
    return (await parsePdf(response)).text;
  }
  const body = await response.json() as { dataUrl?: string; downloadUrl?: string };
  return decodeDataUrl(body.dataUrl ?? body.downloadUrl ?? "");
}

type ParsedPdf = { body: Buffer; text: string; pages: number; links: string[] };

async function parsePdf(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
  captureName?: string,
): Promise<ParsedPdf> {
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const body = await response.body();
  expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(body.length).toBeGreaterThan(1024);

  if (captureName && process.env.F3A8_CAPTURE_PDFS === "true") {
    const outputDir = resolve(process.cwd(), "tmp", "pdfs");
    await mkdir(outputDir, { recursive: true });
    await writeFile(resolve(outputDir, captureName), body);
  }

  const parser = new PDFParse({ data: body });
  try {
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo({ parsePageInfo: true });
    return {
      body,
      text: textResult.text,
      pages: textResult.total,
      links: infoResult.pages.flatMap((page) => page.links.map((link) => link.url)),
    };
  } finally {
    await parser.destroy();
  }
}

async function createReport(request: APIRequestContext, token: string, data: Record<string, unknown>) {
  return request.post("/api/reports/generate", { headers: auth(token), data });
}

test.beforeAll(async ({ request }) => {
  const reportBoundary = await pool.query<{ max_id: number | null }>("SELECT max(id) max_id FROM reports");
  initialReportMaxId = reportBoundary.rows[0]?.max_id ?? 0;
  const snapshotBoundary = await pool.query<{ max_id: number | null }>("SELECT max(id) max_id FROM report_generation_snapshots");
  initialSnapshotMaxId = snapshotBoundary.rows[0]?.max_id ?? 0;
  const fixture = await pool.query<Record<string, number>>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain='e2e-tenant-a') company_a,
      (SELECT id FROM companies WHERE subdomain='e2e-tenant-b') company_b,
      (SELECT id FROM units WHERE name='[E2E] Unit A1') unit_a1,
      (SELECT id FROM units WHERE name='[E2E] Unit A2') unit_a2,
      (SELECT id FROM units WHERE name='[E2E] Unit B1') unit_b1,
      (SELECT id FROM seu_assessments WHERE company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a') AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND year=2025 AND record_type='unit_official' AND is_official=true ORDER BY created_at DESC,id DESC LIMIT 1) official_a1,
      (SELECT i.id FROM seu_assessment_items i JOIN seu_assessments a ON a.id=i.assessment_id WHERE a.company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a') AND a.unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND a.is_official=true AND i.user_decision='accepted_as_seu') accepted_a1,
      (SELECT i.id FROM seu_assessment_items i JOIN seu_assessments a ON a.id=i.assessment_id WHERE a.unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A2') AND i.user_decision='accepted_as_seu') accepted_a2,
      (SELECT i.id FROM seu_assessment_items i JOIN seu_assessments a ON a.id=i.assessment_id WHERE a.company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b') AND i.user_decision='accepted_as_seu') accepted_b1,
      (SELECT id FROM energy_baselines WHERE company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a') AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND notes='[E2E] target parent fixture') baseline_a1,
      (SELECT id FROM energy_baselines WHERE unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A2') AND notes='[E2E] target parent fixture') baseline_a2,
      (SELECT id FROM energy_baselines WHERE company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b') AND notes='[E2E] target parent fixture') baseline_b1
  `);
  const f = fixture.rows[0]!;
  const inserted = await pool.query<{ id: number; company_id: number }>(`
    INSERT INTO energy_baselines
      (company_id,unit_id,seu_assessment_item_id,baseline_year,period_start,period_end,model_type,intercept,r_squared,adjusted_r_squared,sample_size,formula_text,is_valid,status,dependent_variable_unit,notes)
    VALUES
      ($1,$3,$6,2025,'2025-01-01','2025-12-31','single_regression',20,0.91,0.89,12,'y = 20 + 2x <script>alert(1)</script>',true,'active','kWh','[F3A8] report baseline A1'),
      ($1,$4,$7,2025,'2025-01-01','2025-12-31','single_regression',10,0.88,0.85,12,'y = 10 + x',true,'active','kWh','[F3A8] report baseline A2'),
      ($2,$5,$8,2025,'2025-01-01','2025-12-31','single_regression',30,0.90,0.87,12,'y = 30 + 3x',true,'active','kWh','[F3A8] report baseline B1')
    RETURNING id,company_id
  `, [f.company_a, f.company_b, f.unit_a1, f.unit_a2, f.unit_b1, f.accepted_a1, f.accepted_a2, f.accepted_b1]);
  const reportA1 = inserted.rows.find((row) => row.company_id === f.company_a)!.id;
  const reportA2 = inserted.rows.filter((row) => row.company_id === f.company_a)[1]!.id;
  const reportB1 = inserted.rows.find((row) => row.company_id === f.company_b)!.id;
  await pool.query(`
    INSERT INTO energy_baseline_variables (baseline_id,variable_name,variable_code,variable_source,coefficient,is_significant)
    VALUES ($1,'[F3A8] Production <img src=x onerror=alert(1)>','F3A8_PROD','manual',2,true)
  `, [reportA1]);
  for (const [baselineId, companyId, unitId, itemId, offset] of [
    [reportA1, f.company_a, f.unit_a1, f.accepted_a1, 0],
    [reportA2, f.company_a, f.unit_a2, f.accepted_a2, 100],
    [reportB1, f.company_b, f.unit_b1, f.accepted_b1, 200],
  ] as number[][]) {
    await pool.query(`
      INSERT INTO energy_performance_results
        (company_id,unit_id,seu_assessment_item_id,baseline_id,year,month,actual_consumption,expected_consumption,difference,cusum,eei,status)
      VALUES
        ($1,$2,$3,$4,2026,1,$5,$6,20,20,1.25,'deterioration'),
        ($1,$2,$3,$4,2026,2,$7,$8,-15,5,0.8,'improvement'),
        ($1,$2,$3,$4,2026,3,$9,-2,NULL,5,NULL,'negative_expected')
    `, [companyId, unitId, itemId, baselineId, 100 + offset, 80 + offset, 60 + offset, 75 + offset, 10 + offset]);
  }
  ids = {
    companyA:f.company_a, companyB:f.company_b, unitA1:f.unit_a1, unitA2:f.unit_a2, unitB1:f.unit_b1,
    officialA1:f.official_a1,
    acceptedA1:f.accepted_a1, acceptedA2:f.accepted_a2, acceptedB1:f.accepted_b1,
    baselineA1:f.baseline_a1, baselineA2:f.baseline_a2, baselineB1:f.baseline_b1,
    reportBaselineA1:reportA1, reportBaselineA2:reportA2, reportBaselineB1:reportB1,
  };
  sessions = {
    standardA1: await login(request, credentials.standardA1),
    standardB1: await login(request, credentials.standardB1),
    adminA: await login(request, credentials.adminA),
    kontrolAdminA: await login(request, credentials.kontrolAdminA),
    nullUnit: await login(request, credentials.nullUnit),
    superadmin: await login(request, credentials.superadmin),
  };
});

test.afterAll(async () => {
  if (ids) {
    await pool.query("DELETE FROM reports WHERE id > $1", [initialReportMaxId]);
    await pool.query("DELETE FROM report_generation_snapshots WHERE id > $1", [initialSnapshotMaxId]);
    await pool.query("DELETE FROM audit_events WHERE action LIKE 'energy_targets_report.%'");
    await pool.query("DELETE FROM audit_events WHERE action LIKE 'energy_performance_report.%'");
    await pool.query("DELETE FROM energy_performance_results WHERE baseline_id = ANY($1::int[])", [[ids.reportBaselineA1, ids.reportBaselineA2, ids.reportBaselineB1]]);
    await pool.query("DELETE FROM energy_baselines WHERE id = ANY($1::int[])", [[ids.reportBaselineA1, ids.reportBaselineA2, ids.reportBaselineB1]]);
  }
  await pool.end();
});

for (const [name, method, path] of [
  ["AUTH reports list requires authentication", "get", "/api/reports"],
  ["AUTH report generation requires authentication", "post", "/api/reports/generate"],
  ["AUTH target report requires authentication", "get", "/api/reports/energy-targets/pdf?year=2026"],
  ["AUTH performance report requires authentication", "get", "/api/reports/energy-performance/pdf?baselineId=1&year=2026"],
] as const) {
  test(name, async ({ request }) => {
    const response = method === "get" ? await request.get(path) : await request.post(path, { data: { year: 2026 } });
    expect(response.status()).toBe(401);
  });
}

test("HISTORY null-unit standard receives an empty list", async ({ request }) => {
  const response = await request.get("/api/reports", { headers: auth(sessions.nullUnit.token) });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual([]);
});

test("HISTORY standard sees only its own unit report", async ({ request }) => {
  const made = await createReport(request, sessions.standardA1.token, { year: 2091 });
  expect(made.status()).toBe(200);
  const rows = await (await request.get("/api/reports", { headers: auth(sessions.standardA1.token) })).json() as Array<{ unitId: number; year: number }>;
  expect(rows.some((row) => row.year === 2091 && row.unitId === ids.unitA1)).toBe(true);
  expect(rows.every((row) => row.unitId === ids.unitA1)).toBe(true);
});

for (const [label, key] of [["admin", "adminA"], ["kontrol_admin", "kontrolAdminA"]] as const) {
  test(`HISTORY ${label} remains inside the session company`, async ({ request }) => {
    await createReport(request, sessions[key].token, { year: 2092, unitId: ids.unitA2, companyId: ids.companyB });
    const rows = await (await request.get(`/api/reports?companyId=${ids.companyB}`, { headers: auth(sessions[key].token) })).json() as Array<{ unitId: number | null }>;
    expect(rows.some((row) => row.unitId === ids.unitA2)).toBe(true);
    expect(rows.every((row) => row.unitId !== ids.unitB1)).toBe(true);
  });
}

test("HISTORY company admin rejects a foreign unit filter", async ({ request }) => {
  expect((await request.get(`/api/reports?unitId=${ids.unitB1}`, { headers: auth(sessions.adminA.token) })).status()).toBe(403);
});

test("HISTORY superadmin company filters isolate tenants", async ({ request }) => {
  await createReport(request, sessions.superadmin.token, { year: 2093, companyId: ids.companyB, unitId: ids.unitB1 });
  const a = await (await request.get(`/api/reports?companyId=${ids.companyA}`, { headers: auth(sessions.superadmin.token) })).json() as Array<{ unitId: number | null }>;
  const b = await (await request.get(`/api/reports?companyId=${ids.companyB}`, { headers: auth(sessions.superadmin.token) })).json() as Array<{ unitId: number | null }>;
  expect(a.every((row) => row.unitId !== ids.unitB1)).toBe(true);
  expect(b.some((row) => row.unitId === ids.unitB1)).toBe(true);
});

test("HISTORY superadmin rejects company/unit mismatch", async ({ request }) => {
  expect((await request.get(`/api/reports?companyId=${ids.companyA}&unitId=${ids.unitB1}`, { headers: auth(sessions.superadmin.token) })).status()).toBe(403);
});

for (const value of ["123abc", "0", "-1", "1.5", "", "9007199254740992"]) {
  test(`HISTORY strictly rejects companyId=${value || "empty"}`, async ({ request }) => {
    expect((await request.get(`/api/reports?companyId=${encodeURIComponent(value)}`, { headers: auth(sessions.superadmin.token) })).status()).toBe(400);
  });
  test(`HISTORY strictly rejects unitId=${value || "empty"}`, async ({ request }) => {
    expect((await request.get(`/api/reports?unitId=${encodeURIComponent(value)}`, { headers: auth(sessions.adminA.token) })).status()).toBe(400);
  });
}

test("HISTORY rejects array-shaped companyId", async ({ request }) => {
  expect((await request.get(`/api/reports?companyId=${ids.companyA}&companyId=${ids.companyB}`, { headers: auth(sessions.superadmin.token) })).status()).toBe(400);
});

test("GENERATE standard report is bound to the session company and unit", async ({ request }) => {
  const response = await createReport(request, sessions.standardA1.token, { year: 2094, companyId: ids.companyB, unitId: ids.unitA1 });
  expect(response.status()).toBe(200);
  const row = await pool.query<{ company_id: number; unit_id: number }>("SELECT company_id,unit_id FROM reports WHERE id=$1", [(await response.json() as { id: number }).id]);
  expect(row.rows[0]).toEqual({ company_id: ids.companyA, unit_id: ids.unitA1 });
});

test("GENERATE standard rejects an attempted foreign unit override", async ({ request }) => {
  expect((await createReport(request, sessions.standardA1.token, { year: 2095, unitId: ids.unitA2 })).status()).toBe(403);
});

test("GENERATE standard accepts its explicit own unit and trims a numeric string", async ({ request }) => {
  expect((await createReport(request, sessions.standardA1.token, { year: 2095, unitId: ` ${ids.unitA1} ` })).status()).toBe(200);
});

test("GENERATE standard strictly rejects a partial unit ID before report creation", async ({ request }) => {
  const before = await pool.query<{ count: number }>("SELECT count(*)::int count FROM reports");
  const response = await createReport(request, sessions.standardA1.token, { year: 2095, unitId: `${ids.unitA1}abc` });
  expect(response.status()).toBe(400);
  expect(response.headers()["content-disposition"]).toBeUndefined();
  const after = await pool.query<{ count: number }>("SELECT count(*)::int count FROM reports");
  expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
});

test("GENERATE null-unit standard fails closed", async ({ request }) => {
  expect((await createReport(request, sessions.nullUnit.token, { year: 2096 })).status()).toBe(403);
});

for (const [label, key] of [["admin", "adminA"], ["kontrol_admin", "kontrolAdminA"]] as const) {
  test(`GENERATE ${label} can create an own-company unit report`, async ({ request }) => {
    const response = await createReport(request, sessions[key].token, { year: 2097, unitId: ids.unitA2, companyId: ids.companyB });
    expect(response.status()).toBe(200);
    const stored = await pool.query<{ company_id: number; unit_id: number }>("SELECT company_id,unit_id FROM reports WHERE id=$1", [(await response.json() as { id: number }).id]);
    expect(stored.rows[0]).toEqual({ company_id: ids.companyA, unit_id: ids.unitA2 });
  });
}

test("GENERATE company admin rejects a foreign unit", async ({ request }) => {
  expect((await createReport(request, sessions.adminA.token, { year: 2098, unitId: ids.unitB1 })).status()).toBe(403);
});

test("GENERATE superadmin requires explicit company context", async ({ request }) => {
  expect((await createReport(request, sessions.superadmin.token, { year: 2099 })).status()).toBe(400);
});

test("GENERATE superadmin creates a selected-tenant report", async ({ request }) => {
  const response = await createReport(request, sessions.superadmin.token, { year: 2100, companyId: ids.companyB, unitId: ids.unitB1 });
  expect(response.status()).toBe(200);
  const stored = await pool.query<{ company_id: number; unit_id: number }>("SELECT company_id,unit_id FROM reports WHERE id=$1", [(await response.json() as { id: number }).id]);
  expect(stored.rows[0]).toEqual({ company_id: ids.companyB, unit_id: ids.unitB1 });
});

test("GENERATE superadmin rejects company/unit mismatch", async ({ request }) => {
  expect((await createReport(request, sessions.superadmin.token, { year: 2101, companyId: ids.companyA, unitId: ids.unitB1 })).status()).toBe(403);
});

for (const value of ["2026abc", "0", "-2026", "2026.5", "", "9007199254740992", "3001"]) {
  test(`GENERATE strictly rejects year=${value || "empty"}`, async ({ request }) => {
    expect((await createReport(request, sessions.adminA.token, { year: value, unitId: ids.unitA1 })).status()).toBe(400);
  });
}

test("GENERATE uses scoped consumption totals and all 12 months", async ({ request }) => {
  const response = await createReport(request, sessions.adminA.token, { year: 2025, unitId: ids.unitA1 });
  const html = await reportHtml(response);
  const totals = await pool.query<{ kwh: number; tep: number; co2: number }>(`
    SELECT COALESCE(SUM(c.kwh),0)::float kwh,COALESCE(SUM(c.tep),0)::float tep,COALESCE(SUM(c.co2),0)::float co2
    FROM consumption c JOIN meters m ON m.id=c.meter_id
    WHERE c.company_id=$1 AND m.company_id=$1 AND m.unit_id=$2 AND c.year=2025
  `, [ids.companyA, ids.unitA1]);
  expect(html).toContain(Math.round(totals.rows[0]!.kwh).toLocaleString("tr-TR"));
  expect((html.match(/<tr><td>/g) ?? []).length).toBeGreaterThanOrEqual(12);
  expect(html).not.toContain("Tenant B");
});

test("GENERATE safely escapes SWOT, risk and SEU text", async ({ request }) => {
  const risk = await pool.query<{ id: number }>("INSERT INTO risks(company_id,unit_id,type,title,probability,severity,score,status) VALUES($1,$2,'risk','<script>alert(1)</script>',1,1,1,'acik') RETURNING id", [ids.companyA, ids.unitA1]);
  try {
    const html = await reportHtml(await createReport(request, sessions.adminA.token, { year: 2025, unitId: ids.unitA1 }));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  } finally {
    await pool.query("DELETE FROM risks WHERE id=$1", [risk.rows[0]!.id]);
  }
});

test("SEU-REPORT official assessment is authoritative, scoped, ordered and numerically exact", async ({ request }) => {
  const html = await reportHtml(await createReport(request, sessions.adminA.token, { year: 2025, unitId: ids.unitA1 }));
  const monitoring = "[E2E] SEU Monitoring A1";
  const naturalGas = "[E2E] SEU Natural Gas A1";
  const electricity = "[E2E] SEU Electricity A1";

  expect(html).toContain(monitoring);
  expect(html).toContain(naturalGas);
  expect(html).toContain(electricity);
  expect(html.indexOf(monitoring)).toBeLessThan(html.indexOf(naturalGas));
  expect(html.indexOf(naturalGas)).toBeLessThan(html.indexOf(electricity));
  expect(html).toContain("4,5000");
  expect(html).toContain("60,0");
  expect(html).toContain("ÖEK Dışı");
  expect(html).toContain("İzleme");
  expect(html).toContain("Toplam ÖEK: 1");
  expect(html).not.toContain("[E2E] Draft Accepted A1");
  expect(html).not.toContain("[E2E] Manual SEU A1");
  expect(html).not.toContain("[E2E] SEU Electricity A2");
  expect(html).not.toContain("Tenant B");
  expect(html).not.toMatch(/NaN|Infinity|undefined|\[object Object\]/);
});

test("SEU-REPORT draft and non-official records cannot replace the controlled empty state", async ({ request }) => {
  const assessments = await pool.query<{ id: number }>(`
    INSERT INTO seu_assessments(company_id,unit_id,year,analysis_level,record_type,is_official,unit_total_tep)
    VALUES
      ($1,$2,2084,'meter','admin_review',false,8),
      ($1,$2,2084,'subUnit','unit_official',false,9)
    RETURNING id
  `, [ids.companyA, ids.unitA1]);
  try {
    await pool.query(`
      INSERT INTO seu_assessment_items(assessment_id,name,energy_tep,consumption_share_percent,user_decision)
      VALUES ($1,'[F3A8] Draft SEU marker',8,100,'accepted_as_seu'),
             ($2,'[F3A8] Non-official SEU marker',9,100,'accepted_as_seu')
    `, [assessments.rows[0]!.id, assessments.rows[1]!.id]);
    const html = await reportHtml(await createReport(request, sessions.adminA.token, { year: 2084, unitId: ids.unitA1 }));
    expect(html).toContain("Bu yıl için resmî ÖEK değerlendirmesi bulunamadı.");
    expect(html).not.toContain("[F3A8] Draft SEU marker");
    expect(html).not.toContain("[F3A8] Non-official SEU marker");
    expect(html).not.toContain("[E2E] Manual SEU A1");
    expect(html).not.toMatch(/NaN|Infinity|undefined|\[object Object\]/);
  } finally {
    await pool.query("DELETE FROM seu_assessments WHERE id = ANY($1::int[])", [assessments.rows.map((row) => row.id)]);
  }
});

test("SEU-REPORT official assessment without items has a controlled item empty state", async ({ request }) => {
  const assessment = await pool.query<{ id: number }>(`
    INSERT INTO seu_assessments(company_id,unit_id,year,analysis_level,record_type,is_official,unit_total_tep)
    VALUES($1,$2,2085,'meter','unit_official',true,0) RETURNING id
  `, [ids.companyA, ids.unitA1]);
  try {
    const html = await reportHtml(await createReport(request, sessions.adminA.token, { year: 2085, unitId: ids.unitA1 }));
    expect(html).toContain("Resmî ÖEK değerlendirmesinde kayıtlı kalem bulunamadı.");
    expect(html).not.toMatch(/NaN|Infinity|undefined|\[object Object\]/);
  } finally {
    await pool.query("DELETE FROM seu_assessments WHERE id=$1", [assessment.rows[0]!.id]);
  }
});

test("SEU-REPORT selects only the latest official assessment for a unit", async ({ request }) => {
  const assessments = await pool.query<{ id: number }>(`
    INSERT INTO seu_assessments(company_id,unit_id,year,analysis_level,record_type,is_official,unit_total_tep,created_at,updated_at)
    VALUES
      ($1,$2,2086,'meter','unit_official',true,4,'2026-01-01','2026-01-01'),
      ($1,$2,2086,'subUnit','unit_official',true,5,'2026-01-02','2026-01-02')
    RETURNING id
  `, [ids.companyA, ids.unitA1]);
  try {
    await pool.query(`
      INSERT INTO seu_assessment_items(assessment_id,name,energy_tep,consumption_share_percent,user_decision)
      VALUES ($1,'[F3A8] Older official marker',4,100,'accepted_as_seu'),
             ($2,'[F3A8] Latest official marker',5,100,'accepted_as_seu')
    `, [assessments.rows[0]!.id, assessments.rows[1]!.id]);
    const html = await reportHtml(await createReport(request, sessions.adminA.token, { year: 2086, unitId: ids.unitA1 }));
    expect(html).toContain("[F3A8] Latest official marker");
    expect(html).not.toContain("[F3A8] Older official marker");
    expect((html.match(/\[F3A8\] Latest official marker/g) ?? []).length).toBe(1);
  } finally {
    await pool.query("DELETE FROM seu_assessments WHERE id = ANY($1::int[])", [assessments.rows.map((row) => row.id)]);
  }
});

test("SEU-REPORT escapes modern item name and decision rationale", async ({ request }) => {
  const item = await pool.query<{ id: number }>(`
    INSERT INTO seu_assessment_items(assessment_id,unit_id,name,energy_tep,consumption_share_percent,priority_result,user_decision,decision_reason)
    VALUES($1,$2,'<script>alert(1)</script>',0.125,1.25,2,'monitor','<img src=x onerror=alert(1)>')
    RETURNING id
  `, [ids.officialA1, ids.unitA1]);
  try {
    const html = await reportHtml(await createReport(request, sessions.adminA.token, { year: 2025, unitId: ids.unitA1 }));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  } finally {
    await pool.query("DELETE FROM seu_assessment_items WHERE id=$1", [item.rows[0]!.id]);
  }
});

test("SEU-REPORT standard, admin and kontrol_admin share the same official unit scope", async ({ request }) => {
  for (const [key, data] of [
    ["standardA1", { year: 2025 }],
    ["adminA", { year: 2025, unitId: ids.unitA1 }],
    ["kontrolAdminA", { year: 2025, unitId: ids.unitA1 }],
  ] as const) {
    const html = await reportHtml(await createReport(request, sessions[key].token, data));
    expect(html).toContain("[E2E] SEU Electricity A1");
    expect(html).not.toContain("[E2E] SEU Electricity A2");
    expect(html).not.toContain("Tenant B");
  }
});

test("TARGET report standard sees only its session unit", async ({ request }) => {
  const html = await reportHtml(await request.get("/api/reports/energy-targets/pdf?year=2026", { headers: auth(sessions.standardA1.token) }));
  expect(html).toContain("[E2E] Electricity Reduction Target");
  expect(html).not.toContain("[E2E] Unit A2 Target");
  expect(html).not.toContain("Tenant B");
});

test("TARGET report null-unit standard fails closed", async ({ request }) => {
  expect((await request.get("/api/reports/energy-targets/pdf?year=2026", { headers: auth(sessions.nullUnit.token) })).status()).toBe(403);
});

for (const [label, key] of [["admin", "adminA"], ["kontrol_admin", "kontrolAdminA"]] as const) {
  test(`TARGET report ${label} honors an own-company unit filter`, async ({ request }) => {
    const html = await reportHtml(await request.get(`/api/reports/energy-targets/pdf?year=2026&unitId=${ids.unitA2}`, { headers: auth(sessions[key].token) }));
    expect(html).toContain("[E2E] Unit A2 Target");
    expect(html).not.toContain("Tenant B");
  });
}

test("TARGET report company admin rejects a foreign unit", async ({ request }) => {
  expect((await request.get(`/api/reports/energy-targets/pdf?year=2026&unitId=${ids.unitB1}`, { headers: auth(sessions.adminA.token) })).status()).toBe(403);
});

test("TARGET report superadmin requires company context", async ({ request }) => {
  expect((await request.get("/api/reports/energy-targets/pdf?year=2026", { headers: auth(sessions.superadmin.token) })).status()).toBe(400);
});

test("TARGET report superadmin isolates selected companies", async ({ request }) => {
  const a = await reportHtml(await request.get(`/api/reports/energy-targets/pdf?year=2026&companyId=${ids.companyA}`, { headers: auth(sessions.superadmin.token) }));
  const b = await reportHtml(await request.get(`/api/reports/energy-targets/pdf?year=2026&companyId=${ids.companyB}`, { headers: auth(sessions.superadmin.token) }));
  expect(a).toContain("[E2E] Unit A2 Target");
  expect(b).not.toContain("[E2E] Unit A2 Target");
});

test("TARGET report superadmin rejects company/unit mismatch", async ({ request }) => {
  expect((await request.get(`/api/reports/energy-targets/pdf?year=2026&companyId=${ids.companyA}&unitId=${ids.unitB1}`, { headers: auth(sessions.superadmin.token) })).status()).toBe(403);
});

for (const value of ["2026abc", "0", "2026.5", "3001"]) {
  test(`TARGET report strictly rejects year=${value}`, async ({ request }) => {
    expect((await request.get(`/api/reports/energy-targets/pdf?year=${value}`, { headers: auth(sessions.adminA.token) })).status()).toBe(400);
  });
}

test("TARGET report strictly rejects invalid company and unit IDs", async ({ request }) => {
  expect((await request.get("/api/reports/energy-targets/pdf?year=2026&companyId=1abc", { headers: auth(sessions.superadmin.token) })).status()).toBe(400);
  expect((await request.get("/api/reports/energy-targets/pdf?year=2026&unitId=1.5", { headers: auth(sessions.adminA.token) })).status()).toBe(400);
});

test("TARGET report rejects an unsupported status enum", async ({ request }) => {
  expect((await request.get("/api/reports/energy-targets/pdf?year=2026&status=not-a-status", { headers: auth(sessions.adminA.token) })).status()).toBe(400);
});

test("TARGET report accepts an exact valid status and rejects array status atomically", async ({ request }) => {
  const valid = await request.get("/api/reports/energy-targets/pdf?year=2026&status=active", { headers: auth(sessions.adminA.token) });
  expect(valid.status()).toBe(200);
  expect((await valid.body()).subarray(0, 5).toString("ascii")).toBe("%PDF-");

  const invalid = await request.get("/api/reports/energy-targets/pdf?year=2026&status=active&status=draft", { headers: auth(sessions.adminA.token) });
  expect(invalid.status()).toBe(400);
  expect(invalid.headers()["content-disposition"]).toBeUndefined();
  expect(invalid.headers()["content-type"]).not.toContain("application/pdf");
});

test("TARGET report include flags remove optional sections", async ({ request }) => {
  const html = await reportHtml(await request.get(`/api/reports/energy-targets/pdf?year=2026&unitId=${ids.unitA1}&includeVap=false&includeProgress=false`, { headers: auth(sessions.adminA.token) }));
  expect(html).not.toContain("VAP Portföyü");
  expect(html).not.toContain("Gerçekleşme Kronolojisi");
});

test("TARGET report creates an immutable settings snapshot with default registry settings", async ({ request }) => {
  await pool.query("DELETE FROM audit_events WHERE action LIKE 'energy_targets_report.%'");
  await pool.query("DELETE FROM report_generation_snapshots WHERE company_id=$1", [ids.companyA]);
  await pool.query("DELETE FROM company_report_section_settings WHERE company_id=$1 AND report_type='energy_targets_management'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_type_settings WHERE company_id=$1 AND report_type='energy_targets_management'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_profiles WHERE company_id=$1", [ids.companyA]);

  const response = await request.get(
    `/api/reports/energy-targets/pdf?year=2026&unitId=${ids.unitA1}`,
    { headers: auth(sessions.adminA.token) },
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toMatch(/attachment;.*\.pdf/i);

  const snapshots = await pool.query<{ status: string; filename: string; settings_snapshot_json: {
    reportType: string;
    locale: string;
    confidentiality: string;
    profileVersion: number;
    typeSettingsVersion: number;
    sections: Array<{ code: string; visibilityResult: boolean; conditionalEvaluator: { applies: boolean; dataAvailable: boolean | null } }>;
  } }>(`
    SELECT status, filename, settings_snapshot_json
    FROM report_generation_snapshots
    WHERE company_id=$1 AND report_type='energy_targets_management'
    ORDER BY id DESC LIMIT 1
  `, [ids.companyA]);
  const snapshot = snapshots.rows[0]!;
  expect(snapshot.status).toBe("completed");
  expect(snapshot.filename.endsWith(".pdf")).toBe(true);
  expect(snapshot.settings_snapshot_json).toMatchObject({
    reportType: "energy_targets_management",
    locale: "tr-TR",
    confidentiality: "internal",
    profileVersion: 0,
    typeSettingsVersion: 0,
  });
  expect(snapshot.settings_snapshot_json.sections.find((section) => section.code === "cover")?.visibilityResult).toBe(true);
  expect(snapshot.settings_snapshot_json.sections.find((section) => section.code === "vap_portfolio")?.conditionalEvaluator.applies).toBe(true);

  const audit = await pool.query<{ action: string; metadata_json: { outputName?: string; sectionCodes?: string[] } }>(`
    SELECT action, metadata_json
    FROM audit_events
    WHERE action LIKE 'energy_targets_report.%' AND company_id=$1
    ORDER BY id
  `, [ids.companyA]);
  expect(audit.rows.map((row) => row.action)).toEqual([
    "energy_targets_report.generation_started",
    "energy_targets_report.generation_completed",
  ]);
  expect(audit.rows[0]?.metadata_json.outputName).toBe(snapshot.filename);
  expect(audit.rows[0]?.metadata_json.sectionCodes).toContain("energy_targets");
});

test("TARGET report applies profile, type, section settings and request-scope legacy overrides", async ({ request }) => {
  await pool.query("DELETE FROM audit_events WHERE action LIKE 'energy_targets_report.%'");
  await pool.query("DELETE FROM report_generation_snapshots WHERE company_id=$1", [ids.companyA]);
  await pool.query("DELETE FROM company_report_section_settings WHERE company_id=$1 AND report_type='energy_targets_management'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_type_settings WHERE company_id=$1 AND report_type='energy_targets_management'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_profiles WHERE company_id=$1", [ids.companyA]);
  await pool.query(`
    INSERT INTO company_report_profiles(company_id, default_title, default_subtitle, confidentiality_level, cover_style, file_name_pattern, revision_number, footer_text, profile_version)
    VALUES($1, 'Profile Default Title', 'Profile Subtitle', 'confidential', 'compact', '{company}_{year}_{revision}', 'R1', 'Short footer marker', 3)
  `, [ids.companyA]);
  await pool.query(`
    INSERT INTO company_report_type_settings(company_id, report_type, title_override, type_settings_version)
    VALUES($1, 'energy_targets_management', 'Target Type Title', 2)
  `, [ids.companyA]);
  await pool.query(`
    INSERT INTO company_report_section_settings(company_id, report_type, section_code, is_visible, display_order, label_override)
    VALUES
      ($1, 'energy_targets_management', 'executive_summary', true, 20, 'Executive Snapshot Label'),
      ($1, 'energy_targets_management', 'vap_portfolio', false, 50, NULL)
  `, [ids.companyA]);

  const pdf = await parsePdf(
    await request.get(`/api/reports/energy-targets/pdf?year=2026&unitId=${ids.unitA1}&includeVap=true`, { headers: auth(sessions.adminA.token) }),
    "target-report-settings.pdf",
  );
  expect(pdf.text).toContain("Target Type Title");
  expect(pdf.text).toContain("Executive Snapshot Label");
  expect(pdf.text).toContain("Gizli");
  expect(pdf.text).toContain("Short footer marker");

  const rows = await pool.query<{ is_visible: boolean }>("SELECT is_visible FROM company_report_section_settings WHERE company_id=$1 AND report_type='energy_targets_management' AND section_code='vap_portfolio'", [ids.companyA]);
  expect(rows.rows[0]?.is_visible).toBe(false);
  const snapshot = await pool.query<{ filename: string; settings_snapshot_json: {
    coverStyle: string;
    confidentiality: string;
    sections: Array<{ code: string; visibilityResult: boolean; finalTitle: string; legacyOverride: { param: string; value: boolean } | null }>;
  } }>("SELECT filename, settings_snapshot_json FROM report_generation_snapshots WHERE company_id=$1 ORDER BY id DESC LIMIT 1", [ids.companyA]);
  expect(snapshot.rows[0]?.filename).toMatch(/r1\.pdf$/);
  expect(snapshot.rows[0]?.settings_snapshot_json).toMatchObject({ coverStyle: "compact", confidentiality: "confidential" });
  const vapSection = snapshot.rows[0]?.settings_snapshot_json.sections.find((section) => section.code === "vap_portfolio");
  expect(vapSection).toMatchObject({ visibilityResult: true, legacyOverride: { param: "includeVap", value: true } });
});

test("TARGET report conditional sections disappear without data and legacy booleans are strict", async ({ request }) => {
  await pool.query("DELETE FROM audit_events WHERE action LIKE 'energy_targets_report.%'");
  await pool.query("DELETE FROM report_generation_snapshots WHERE company_id=$1", [ids.companyA]);
  await pool.query("DELETE FROM company_report_section_settings WHERE company_id=$1 AND report_type='energy_targets_management'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_type_settings WHERE company_id=$1 AND report_type='energy_targets_management'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_profiles WHERE company_id=$1", [ids.companyA]);
  const empty = await reportHtml(await request.get(`/api/reports/energy-targets/pdf?year=2999&unitId=${ids.unitA1}`, { headers: auth(sessions.adminA.token) }));
  expect(empty).toContain("Bu kapsam ve yıl için kayıtlı enerji hedefi bulunamadı.");
  expect(empty).not.toContain("VAP PortfÃ¶yÃ¼");
  expect(empty).not.toContain("GerÃ§ekleÅŸme Kronolojisi");

  const invalid = await request.get(`/api/reports/energy-targets/pdf?year=2026&unitId=${ids.unitA1}&includeVap=maybe`, { headers: auth(sessions.adminA.token) });
  expect(invalid.status()).toBe(400);
  expect(invalid.headers()["content-disposition"]).toBeUndefined();
  const audit = await pool.query<{ count: string }>("SELECT count(*)::text count FROM audit_events WHERE action='energy_targets_report.generation_completed' AND company_id=$1", [ids.companyA]);
  expect(audit.rows[0]?.count).toBe("1");
  await pool.query("DELETE FROM company_report_section_settings WHERE company_id=$1 AND report_type='energy_targets_management'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_type_settings WHERE company_id=$1 AND report_type='energy_targets_management'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_profiles WHERE company_id=$1", [ids.companyA]);
});

test("TARGET report safely escapes user-controlled fields", async ({ request }) => {
  const previous = await pool.query<{ name: string }>("SELECT name FROM energy_targets WHERE company_id=$1 AND unit_id=$2 ORDER BY id LIMIT 1", [ids.companyA, ids.unitA1]);
  const target = await pool.query<{ id: number }>("SELECT id FROM energy_targets WHERE company_id=$1 AND unit_id=$2 ORDER BY id LIMIT 1", [ids.companyA, ids.unitA1]);
  const payload = "<script>alert(1)</script> <img src=https://example.invalid/pixel onerror=alert(1)> <iframe src=file:///etc/passwd></iframe> javascript:alert(1)";
  await pool.query("UPDATE energy_targets SET name=$2 WHERE id=$1", [target.rows[0]!.id, payload]);
  try {
    const pdf = await parsePdf(
      await request.get(`/api/reports/energy-targets/pdf?year=2026&unitId=${ids.unitA1}`, { headers: auth(sessions.adminA.token) }),
      "target-report.pdf",
    );
    expect(pdf.text).toContain("<script>alert(1)</script>");
    expect(pdf.text).toContain("javascript:alert(1)");
    expect(pdf.links).toEqual([]);
    expect(pdf.body.toString("latin1")).not.toMatch(/\/JavaScript|\/Launch|file:\/\/\/|example\.invalid/);
  } finally {
    await pool.query("UPDATE energy_targets SET name=$2 WHERE id=$1", [target.rows[0]!.id, previous.rows[0]!.name]);
  }
});

test("TARGET report returns a controlled empty state", async ({ request }) => {
  const html = await reportHtml(await request.get(`/api/reports/energy-targets/pdf?year=2999&unitId=${ids.unitA1}`, { headers: auth(sessions.adminA.token) }));
  expect(html).toContain("Bu kapsam ve yıl için kayıtlı enerji hedefi bulunamadı.");
  expect(html).not.toMatch(/NaN|Infinity|undefined|\[object Object\]/);
});

for (const [label, assertion] of [
  ["MIME is application/pdf", "mime"],
  ["filename is a safe .pdf attachment", "filename"],
  ["body has PDF magic bytes", "magic"],
] as const) {
  test(`TARGET PDF contract: ${label}`, async ({ request }) => {
    const response = await request.get(`/api/reports/energy-targets/pdf?year=2026&unitId=${ids.unitA1}`, { headers: auth(sessions.adminA.token) });
    expect(response.status()).toBe(200);
    if (assertion === "mime") expect(response.headers()["content-type"]).toContain("application/pdf");
    if (assertion === "filename") expect(response.headers()["content-disposition"]).toMatch(/attachment;.*filename=.*\.pdf/i);
    if (assertion === "magic") {
      const body = await response.body();
      expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(body.length).toBeGreaterThan(1024);
      expect(Number(response.headers()["content-length"])).toBe(body.length);
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
  });
}

test("PERFORMANCE report standard gets authoritative monthly results", async ({ request }) => {
  const html = await reportHtml(await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA1}&year=2026`, { headers: auth(sessions.standardA1.token) }));
  expect(html).toContain("170,00");
  expect(html).toContain("153,00");
  expect(html).toContain("17,00");
  expect(html).not.toContain("Tenant B");
});

test("PERFORMANCE report standard cannot read another unit baseline", async ({ request }) => {
  expect((await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA2}&year=2026`, { headers: auth(sessions.standardA1.token) })).status()).toBe(404);
});

test("PERFORMANCE report null-unit standard fails closed", async ({ request }) => {
  expect((await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA1}&year=2026`, { headers: auth(sessions.nullUnit.token) })).status()).toBe(403);
});

for (const [label, key] of [["admin", "adminA"], ["kontrol_admin", "kontrolAdminA"]] as const) {
  test(`PERFORMANCE report ${label} reads an own-company baseline`, async ({ request }) => {
    expect((await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA2}&year=2026`, { headers: auth(sessions[key].token) })).status()).toBe(200);
  });
}

test("PERFORMANCE report company admin cannot read another tenant baseline", async ({ request }) => {
  expect((await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineB1}&year=2026`, { headers: auth(sessions.adminA.token) })).status()).toBe(404);
});

test("PERFORMANCE report superadmin honors explicit company context", async ({ request }) => {
  expect((await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineB1}&year=2026&companyId=${ids.companyB}`, { headers: auth(sessions.superadmin.token) })).status()).toBe(200);
});

test("PERFORMANCE report superadmin accepts matching company and unit context", async ({ request }) => {
  const response = await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineB1}&year=2026&companyId=${ids.companyB}&unitId=${ids.unitB1}`, { headers: auth(sessions.superadmin.token) });
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("PERFORMANCE report superadmin requires explicit company context", async ({ request }) => {
  expect((await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineB1}&year=2026`, { headers: auth(sessions.superadmin.token) })).status()).toBe(400);
});

test("PERFORMANCE report superadmin rejects mismatched company context", async ({ request }) => {
  expect((await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineB1}&year=2026&companyId=${ids.companyA}`, { headers: auth(sessions.superadmin.token) })).status()).toBe(404);
});

test("PERFORMANCE report requires baselineId", async ({ request }) => {
  expect((await request.get("/api/reports/energy-performance/pdf?year=2026", { headers: auth(sessions.adminA.token) })).status()).toBe(400);
});

for (const value of ["1abc", "0", "-1", "1.5", "9007199254740992"]) {
  test(`PERFORMANCE report strictly rejects baselineId=${value}`, async ({ request }) => {
    expect((await request.get(`/api/reports/energy-performance/pdf?baselineId=${value}&year=2026`, { headers: auth(sessions.adminA.token) })).status()).toBe(400);
  });
}

for (const value of ["2026abc", "2026.5", "3001"]) {
  test(`PERFORMANCE report strictly rejects year=${value}`, async ({ request }) => {
    expect((await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA1}&year=${value}`, { headers: auth(sessions.adminA.token) })).status()).toBe(400);
  });
}

test("PERFORMANCE report empty year is controlled", async ({ request }) => {
  const html = await reportHtml(await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA1}&year=2090`, { headers: auth(sessions.adminA.token) }));
  expect(html).toContain("Bu yıl için hesaplanmış EnPG sonucu bulunamadı.");
  expect(html).not.toMatch(/NaN|Infinity|undefined|\[object Object\]/);
});

test("PERFORMANCE report creates an immutable settings snapshot with default registry settings", async ({ request }) => {
  await pool.query("DELETE FROM audit_events WHERE action LIKE 'energy_performance_report.%'");
  await pool.query("DELETE FROM report_generation_snapshots WHERE company_id=$1 AND report_type='energy_performance_monitoring'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_section_settings WHERE company_id=$1 AND report_type='energy_performance_monitoring'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_type_settings WHERE company_id=$1 AND report_type='energy_performance_monitoring'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_profiles WHERE company_id=$1", [ids.companyA]);

  const response = await request.get(
    `/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA1}&year=2026`,
    { headers: auth(sessions.adminA.token) },
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toMatch(/attachment;.*\.pdf/i);

  const snapshots = await pool.query<{ status: string; filename: string; settings_snapshot_json: {
    reportType: string;
    locale: string;
    confidentiality: string;
    profileVersion: number;
    typeSettingsVersion: number;
    year: number;
    baselineId: number;
    seuAssessmentItemId: number;
    sections: Array<{ code: string; visibilityResult: boolean; conditionalEvaluator: { applies: boolean; dataAvailable: boolean | null } }>;
  } }>(`
    SELECT status, filename, settings_snapshot_json
    FROM report_generation_snapshots
    WHERE company_id=$1 AND report_type='energy_performance_monitoring'
    ORDER BY id DESC LIMIT 1
  `, [ids.companyA]);
  const snapshot = snapshots.rows[0]!;
  expect(snapshot.status).toBe("completed");
  expect(snapshot.filename.endsWith(".pdf")).toBe(true);
  expect(snapshot.settings_snapshot_json).toMatchObject({
    reportType: "energy_performance_monitoring",
    locale: "tr-TR",
    confidentiality: "internal",
    profileVersion: 0,
    typeSettingsVersion: 0,
    year: 2026,
    baselineId: ids.reportBaselineA1,
    seuAssessmentItemId: ids.acceptedA1,
  });
  expect(snapshot.settings_snapshot_json.sections.find((section) => section.code === "cover")?.visibilityResult).toBe(true);
  const modelVariables = snapshot.settings_snapshot_json.sections.find((section) => section.code === "model_variables");
  expect(modelVariables?.visibilityResult).toBe(true);
  expect(modelVariables?.conditionalEvaluator).toMatchObject({ applies: true, dataAvailable: true });

  const audit = await pool.query<{ action: string; metadata_json: { outputName?: string; sectionCodes?: string[]; requestOverrideUsed?: boolean } }>(`
    SELECT action, metadata_json
    FROM audit_events
    WHERE action LIKE 'energy_performance_report.%' AND company_id=$1
    ORDER BY id
  `, [ids.companyA]);
  expect(audit.rows.map((row) => row.action)).toEqual([
    "energy_performance_report.generation_started",
    "energy_performance_report.generation_completed",
  ]);
  expect(audit.rows[0]?.metadata_json.outputName).toBe(snapshot.filename);
  expect(audit.rows[0]?.metadata_json.sectionCodes).toContain("performance_summary");
  expect(audit.rows[0]?.metadata_json.requestOverrideUsed).toBe(false);
});

test("PERFORMANCE report applies profile, type and section settings without mutating them", async ({ request }) => {
  await pool.query("DELETE FROM audit_events WHERE action LIKE 'energy_performance_report.%'");
  await pool.query("DELETE FROM report_generation_snapshots WHERE company_id=$1 AND report_type='energy_performance_monitoring'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_section_settings WHERE company_id=$1 AND report_type='energy_performance_monitoring'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_type_settings WHERE company_id=$1 AND report_type='energy_performance_monitoring'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_profiles WHERE company_id=$1", [ids.companyA]);
  await pool.query(`
    INSERT INTO company_report_profiles(company_id, default_title, default_subtitle, confidentiality_level, cover_style, file_name_pattern, revision_number, footer_text, profile_version)
    VALUES($1, 'Performance Profile Default', 'Performance Profile Subtitle', 'confidential', 'compact', '{company}_{reportType}_{year}_{revision}', 'P1', 'Performance footer marker', 4)
  `, [ids.companyA]);
  await pool.query(`
    INSERT INTO company_report_type_settings(company_id, report_type, title_override, type_settings_version)
    VALUES($1, 'energy_performance_monitoring', 'Performance Type Title', 5)
  `, [ids.companyA]);
  await pool.query(`
    INSERT INTO company_report_section_settings(company_id, report_type, section_code, is_visible, display_order, label_override)
    VALUES($1, 'energy_performance_monitoring', 'performance_summary', true, 40, 'Performance Snapshot Label')
  `, [ids.companyA]);

  const pdf = await parsePdf(
    await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA1}&year=2026`, { headers: auth(sessions.adminA.token) }),
    "performance-report-settings.pdf",
  );
  expect(pdf.text).toContain("Performance Type Title");
  expect(pdf.text).toContain("Performance Snapshot Label");
  expect(pdf.text).toContain("Gizli");
  expect(pdf.text).toContain("Performance footer marker");

  const rows = await pool.query<{ label_override: string | null }>("SELECT label_override FROM company_report_section_settings WHERE company_id=$1 AND report_type='energy_performance_monitoring' AND section_code='performance_summary'", [ids.companyA]);
  expect(rows.rows[0]?.label_override).toBe("Performance Snapshot Label");
  const snapshot = await pool.query<{ filename: string; settings_snapshot_json: {
    coverStyle: string;
    confidentiality: string;
    profileVersion: number;
    typeSettingsVersion: number;
    sections: Array<{ code: string; finalTitle: string }>;
  } }>("SELECT filename, settings_snapshot_json FROM report_generation_snapshots WHERE company_id=$1 AND report_type='energy_performance_monitoring' ORDER BY id DESC LIMIT 1", [ids.companyA]);
  expect(snapshot.rows[0]?.filename).toMatch(/p1\.pdf$/);
  expect(snapshot.rows[0]?.settings_snapshot_json).toMatchObject({ coverStyle: "compact", confidentiality: "confidential", profileVersion: 4, typeSettingsVersion: 5 });
  expect(snapshot.rows[0]?.settings_snapshot_json.sections.find((section) => section.code === "performance_summary")?.finalTitle).toBe("Performance Snapshot Label");
});

test("PERFORMANCE report hides conditional model variables when regression variables are absent", async ({ request }) => {
  await pool.query("DELETE FROM report_generation_snapshots WHERE company_id=$1 AND report_type='energy_performance_monitoring'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_section_settings WHERE company_id=$1 AND report_type='energy_performance_monitoring'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_type_settings WHERE company_id=$1 AND report_type='energy_performance_monitoring'", [ids.companyA]);
  await pool.query("DELETE FROM company_report_profiles WHERE company_id=$1", [ids.companyA]);

  await reportHtml(await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA2}&year=2026`, { headers: auth(sessions.adminA.token) }));
  const snapshot = await pool.query<{ settings_snapshot_json: {
    sections: Array<{ code: string; visibilityResult: boolean; conditionalEvaluator: { applies: boolean; dataAvailable: boolean | null; reason: string } }>;
  } }>("SELECT settings_snapshot_json FROM report_generation_snapshots WHERE company_id=$1 AND report_type='energy_performance_monitoring' ORDER BY id DESC LIMIT 1", [ids.companyA]);
  const section = snapshot.rows[0]?.settings_snapshot_json.sections.find((item) => item.code === "model_variables");
  expect(section).toMatchObject({
    visibilityResult: false,
    conditionalEvaluator: { applies: true, dataAvailable: false, reason: "no_model_variables" },
  });
});

test("PERFORMANCE report escapes formula and variable text", async ({ request }) => {
  const pdf = await parsePdf(
    await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA1}&year=2026`, { headers: auth(sessions.adminA.token) }),
    "performance-report.pdf",
  );
  expect(pdf.text).toContain("<script>alert(1)</script>");
  expect(pdf.text).toContain("<img src=x onerror=alert(1)>");
  expect(pdf.links).toEqual([]);
  expect(pdf.body.toString("latin1")).not.toMatch(/\/JavaScript|\/Launch/);
});

for (const [label, assertion] of [
  ["MIME is application/pdf", "mime"],
  ["filename is a safe .pdf attachment", "filename"],
  ["body has PDF magic bytes", "magic"],
] as const) {
  test(`PERFORMANCE PDF contract: ${label}`, async ({ request }) => {
    const response = await request.get(`/api/reports/energy-performance/pdf?baselineId=${ids.reportBaselineA1}&year=2026`, { headers: auth(sessions.adminA.token) });
    expect(response.status()).toBe(200);
    if (assertion === "mime") expect(response.headers()["content-type"]).toContain("application/pdf");
    if (assertion === "filename") expect(response.headers()["content-disposition"]).toMatch(/attachment;.*filename=.*\.pdf/i);
    if (assertion === "magic") {
      const body = await response.body();
      expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(body.length).toBeGreaterThan(1024);
      expect(Number(response.headers()["content-length"])).toBe(body.length);
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
  });
}

for (const [label, path, mime] of [
  ["TARGET CSV", "/api/targets/export?format=csv&year=2026", "text/csv"],
  ["VAP CSV", "/api/vap-projects/export?format=csv", "text/csv"],
] as const) {
  test(`${label} is tenant scoped and uses the declared format`, async ({ request }) => {
    const response = await request.get(path, { headers: auth(sessions.adminA.token) });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain(mime);
    expect(response.headers()["content-disposition"]).toMatch(/\.csv/i);
    const csv = await response.text();
    expect(csv).toContain("[E2E]");
    expect(csv).not.toContain("Tenant B");
  });
}

for (const [label, path] of [
  ["TARGET XLSX", "/api/targets/export?format=xlsx&year=2026"],
  ["VAP XLSX", "/api/vap-projects/export?format=xlsx"],
] as const) {
  test(`${label} is a real ZIP-based workbook`, async ({ request }) => {
    const response = await request.get(path, { headers: auth(sessions.adminA.token) });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheetml");
    expect(response.headers()["content-disposition"]).toMatch(/\.xlsx/i);
    expect((await response.body()).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
}

for (const [label, path] of [
  ["TARGET export", "/api/targets/export"],
  ["VAP export", "/api/vap-projects/export"],
] as const) {
  test(`${label} defaults an omitted format to CSV`, async ({ request }) => {
    const response = await request.get(path, { headers: auth(sessions.adminA.token) });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toMatch(/\.csv/i);
  });

  test(`${label} rejects empty and array formats without file headers`, async ({ request }) => {
    for (const suffix of ["?format=", "?format=csv&format=xlsx"]) {
      const response = await request.get(`${path}${suffix}`, { headers: auth(sessions.adminA.token) });
      expect(response.status()).toBe(400);
      expect(response.headers()["content-disposition"]).toBeUndefined();
      expect(response.headers()["content-type"]).not.toContain("text/csv");
      expect(response.headers()["content-type"]).not.toContain("spreadsheetml");
    }
  });
}

for (const [label, path] of [
  ["TARGET export", "/api/targets/export?format=pdf"],
  ["VAP export", "/api/vap-projects/export?format=pdf"],
] as const) {
  test(`${label} rejects unsupported formats`, async ({ request }) => {
    expect((await request.get(path, { headers: auth(sessions.adminA.token) })).status()).toBe(400);
  });
}

test("LARGE DATA target report completes without tenant fallback", async ({ request }) => {
  const inserted = await pool.query<{ id: number }>(`
    INSERT INTO energy_targets(company_id,unit_id,name,baseline_year,target_year,target_reduction_percent,target_type,status,objective_text)
    SELECT $1,$2,'[F3A8] Bulk Target '||g,2025,2077,5,'monitoring','active',repeat('long safe description ',20)
    FROM generate_series(1,40) g RETURNING id
  `, [ids.companyA, ids.unitA1]);
  try {
    const response = await request.get(`/api/reports/energy-targets/pdf?year=2077&unitId=${ids.unitA1}`, { headers: auth(sessions.adminA.token), timeout: 30_000 });
    const pdf = await parsePdf(response, "target-report-large.pdf");
    expect((pdf.text.match(/\[F3A8\]\s+Bulk\s+Target/g) ?? []).length).toBe(40);
    expect(pdf.text).not.toContain("Tenant B");
    expect(pdf.pages).toBeGreaterThan(1);
  } finally {
    await pool.query("DELETE FROM energy_targets WHERE id = ANY($1::int[])", [inserted.rows.map((row) => row.id)]);
  }
});

for (const [label, username] of [
  ["standard", credentials.standardA1],
  ["admin", credentials.adminA],
  ["kontrol_admin", credentials.kontrolAdminA],
  ["superadmin", credentials.superadmin],
] as const) {
  test(`UI ${label} can open the reports screen without another-tenant marker`, async ({ page }) => {
    await loginUi(page, username);
    await page.goto("/raporlar");
    await expect(page.getByRole("heading", { name: "Raporlar" })).toBeVisible();
    await expect(page.getByText("Rapor Oluştur & İndir")).toBeVisible();
    await expect(page.getByText("Tenant B")).toHaveCount(0);
  });
}
