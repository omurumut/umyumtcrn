import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function assertDisposableDatabase(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Dashboard/AI E2E testi yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/iso50001_test" ||
    url.port !== process.env.TEST_DB_PORT
  ) {
    throw new Error("Dashboard/AI E2E DB bağlantısı disposable localhost DB ile eşleşmiyor.");
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
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
} as const;
const password = requiredEnv("E2E_TEST_PASSWORD");

type LoginResult = {
  token: string;
  user: { id: number; companyId: number; unitId: number | null; role: string };
};

type FixtureIds = {
  companyA: number;
  companyB: number;
  unitA1: number;
  unitA2: number;
  unitB1: number;
  energySourceB1: number;
  targetA1: number;
};

type Tokens = {
  standardA1: string;
  standardB1: string;
  adminA: string;
  kontrolAdminA: string;
  nullUnit: string;
  superadmin: string;
};

const dashboardEndpoints = [
  "kpi",
  "monthly-trend",
  "seu-breakdown",
  "target-status",
  "action-status",
  "vap-summary",
  "seu-summary",
] as const;

let ids: FixtureIds;
let tokens: Tokens;

function authorization(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function loginApi(request: APIRequestContext, username: string): Promise<LoginResult> {
  const response = await request.post("/api/auth/login", { data: { username, password } });
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

async function json(response: APIResponse): Promise<unknown> {
  return response.json();
}

function endpointUrl(endpoint: typeof dashboardEndpoints[number], query = "year=2025"): string {
  return `/api/dashboard/${endpoint}${query ? `?${query}` : ""}`;
}

function analysisUrl(query = "year=2025"): string {
  return `/api/ai/analyses${query ? `?${query}` : ""}`;
}

function analysisRequest(analysisType = "energy_performance_overview") {
  return { analysisType };
}

function expectNoUnsafeNumbers(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(expectNoUnsafeNumbers);
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(expectNoUnsafeNumbers);
  }
}

function expectNullUnitEmpty(endpoint: typeof dashboardEndpoints[number], body: any): void {
  if (endpoint === "kpi") {
    expect(body).toMatchObject({ totalKwh: 0, totalTep: 0, totalCo2: 0, meterCount: 0, activeSeuCount: 0 });
  } else if (endpoint === "monthly-trend") {
    expect(body).toHaveLength(12);
    expect(body.every((row: any) => row.kwh === 0 && row.tep === 0 && row.co2 === 0)).toBe(true);
  } else if (endpoint === "seu-breakdown") {
    expect(body).toEqual([]);
  } else if (endpoint === "target-status") {
    expect(body).toEqual({ items: [] });
  } else if (endpoint === "action-status") {
    expect(body.summary.total).toBe(0);
    expect(body.items).toEqual([]);
  } else if (endpoint === "vap-summary") {
    expect(body.summary.total).toBe(0);
    expect(body.items).toEqual([]);
  } else {
    expect(body).toEqual({ totalAssessments: 0, byUnit: [], topSeuItems: [] });
  }
}

test.beforeAll(async ({ request }) => {
  const fixture = await pool.query<{
    company_a: number;
    company_b: number;
    unit_a1: number;
    unit_a2: number;
    unit_b1: number;
    energy_source_b1: number;
    target_a1: number;
  }>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a') AS company_a,
      (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b') AS company_b,
      (SELECT id FROM units WHERE name = '[E2E] Unit A1') AS unit_a1,
      (SELECT id FROM units WHERE name = '[E2E] Unit A2') AS unit_a2,
      (SELECT id FROM units WHERE name = '[E2E] Unit B1') AS unit_b1,
      (SELECT id FROM energy_sources WHERE name = '[E2E] Electricity A1' AND company_id =
        (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-b')) AS energy_source_b1,
      (SELECT id FROM energy_targets WHERE company_id = (SELECT id FROM companies WHERE subdomain = 'e2e-tenant-a')
        AND unit_id = (SELECT id FROM units WHERE name = '[E2E] Unit A1') ORDER BY id LIMIT 1) AS target_a1
  `);
  const row = fixture.rows[0];
  if (!row || Object.values(row).some((value) => !Number.isSafeInteger(value))) {
    throw new Error("Dashboard/AI fixture kimlikleri çözülemedi.");
  }
  ids = {
    companyA: row.company_a,
    companyB: row.company_b,
    unitA1: row.unit_a1,
    unitA2: row.unit_a2,
    unitB1: row.unit_b1,
    energySourceB1: row.energy_source_b1,
    targetA1: row.target_a1,
  };

  await pool.query(`
    INSERT INTO company_ai_settings (
      company_id,
      data_policy,
      retention_days,
      daily_analysis_limit,
      monthly_analysis_limit,
      max_concurrent_analyses,
      fallback_enabled,
      settings_version,
      updated_at
    )
    VALUES
      ($1, 'production_allowed', 365, NULL, NULL, 2, true, 1, now()),
      ($2, 'production_allowed', 365, NULL, NULL, 2, true, 1, now())
    ON CONFLICT (company_id) DO UPDATE SET
      data_policy = EXCLUDED.data_policy,
      retention_days = EXCLUDED.retention_days,
      daily_analysis_limit = EXCLUDED.daily_analysis_limit,
      monthly_analysis_limit = EXCLUDED.monthly_analysis_limit,
      max_concurrent_analyses = EXCLUDED.max_concurrent_analyses,
      fallback_enabled = EXCLUDED.fallback_enabled,
      updated_at = now()
  `, [ids.companyA, ids.companyB]);

  const [standardA1, standardB1, adminA, kontrolAdminA, nullUnit, superadmin] = await Promise.all([
    loginApi(request, users.standardA1),
    loginApi(request, users.standardB1),
    loginApi(request, users.adminA),
    loginApi(request, users.kontrolAdminA),
    loginApi(request, users.nullUnit),
    loginApi(request, users.superadmin),
  ]);
  tokens = {
    standardA1: standardA1.token,
    standardB1: standardB1.token,
    adminA: adminA.token,
    kontrolAdminA: kontrolAdminA.token,
    nullUnit: nullUnit.token,
    superadmin: superadmin.token,
  };
});

test.afterAll(async () => {
  await pool.end();
});

for (const endpoint of dashboardEndpoints) {
  test(`DASH-AUTH-${endpoint} oturumsuz erişimi reddeder`, async ({ request }) => {
    expect((await request.get(endpointUrl(endpoint))).status()).toBe(401);
  });

  test(`DASH-ID-COMPANY-${endpoint} partial companyId değerini reddeder`, async ({ request }) => {
    const response = await request.get(endpointUrl(endpoint, "year=2025&companyId=123abc"), {
      headers: authorization(tokens.superadmin),
    });
    expect(response.status()).toBe(400);
  });

  test(`DASH-ID-UNIT-${endpoint} sıfır unitId değerini reddeder`, async ({ request }) => {
    const response = await request.get(endpointUrl(endpoint, `year=2025&companyId=${ids.companyA}&unitId=0`), {
      headers: authorization(tokens.superadmin),
    });
    expect(response.status()).toBe(400);
  });

  test(`DASH-YEAR-${endpoint} partial year değerini reddeder`, async ({ request }) => {
    const response = await request.get(endpointUrl(endpoint, `year=2025abc&companyId=${ids.companyA}`), {
      headers: authorization(tokens.superadmin),
    });
    expect(response.status()).toBe(400);
  });

  test(`DASH-SA-CONTEXT-${endpoint} superadmin explicit company context kullanır`, async ({ request }) => {
    const response = await request.get(endpointUrl(endpoint, `year=2025&companyId=${ids.companyA}`), {
      headers: authorization(tokens.superadmin),
    });
    expect(response.status()).toBe(200);
    expect(JSON.stringify(await json(response))).not.toContain("Tenant B marker");
  });

  test(`DASH-SA-NOCONTEXT-${endpoint} superadmin context olmadan fail-closed davranır`, async ({ request }) => {
    const response = await request.get(endpointUrl(endpoint), {
      headers: authorization(tokens.superadmin),
    });
    expect(response.status()).toBe(400);
  });

  test(`DASH-ADMIN-COMPANY-${endpoint} admin query companyId ile tenant değiştiremez`, async ({ request }) => {
    const own = await request.get(endpointUrl(endpoint), { headers: authorization(tokens.adminA) });
    const manipulated = await request.get(endpointUrl(endpoint, `year=2025&companyId=${ids.companyB}`), {
      headers: authorization(tokens.adminA),
    });
    expect(own.status()).toBe(200);
    expect(manipulated.status()).toBe(200);
    expect(await json(manipulated)).toEqual(await json(own));
  });

  test(`DASH-STANDARD-UNIT-${endpoint} standard başka unit parametresiyle scope değiştiremez`, async ({ request }) => {
    const response = await request.get(endpointUrl(endpoint, `year=2025&unitId=${ids.unitA2}`), {
      headers: authorization(tokens.standardA1),
    });
    expect(response.status()).toBe(403);
  });

  test(`DASH-ADMIN-CROSS-${endpoint} admin başka tenant unit filtresini reddeder`, async ({ request }) => {
    const response = await request.get(endpointUrl(endpoint, `year=2025&unitId=${ids.unitB1}`), {
      headers: authorization(tokens.adminA),
    });
    expect(response.status()).toBe(403);
  });

  test(`DASH-NULL-${endpoint} null-unit standard güvenli boş sonuç alır`, async ({ request }) => {
    const response = await request.get(endpointUrl(endpoint), { headers: authorization(tokens.nullUnit) });
    expect(response.status()).toBe(200);
    const body = await json(response);
    expectNullUnitEmpty(endpoint, body);
    expect(JSON.stringify(body)).not.toContain("Tenant B");
  });
}

test("DASH-KPI-DB standard A1 toplamları bağımsız DB toplamlarıyla eşleşir", async ({ request }) => {
  const expected = await pool.query<{ kwh: number; tep: number; co2: number; meter_count: number }>(`
    SELECT
      COALESCE((SELECT SUM(c.kwh) FROM consumption c JOIN meters m ON m.id = c.meter_id
        WHERE c.company_id = $1 AND m.company_id = $1 AND m.unit_id = $2 AND c.year = 2025), 0)::float8 AS kwh,
      COALESCE((SELECT SUM(c.tep) FROM consumption c JOIN meters m ON m.id = c.meter_id
        WHERE c.company_id = $1 AND m.company_id = $1 AND m.unit_id = $2 AND c.year = 2025), 0)::float8 AS tep,
      COALESCE((SELECT SUM(c.co2) FROM consumption c JOIN meters m ON m.id = c.meter_id
        WHERE c.company_id = $1 AND m.company_id = $1 AND m.unit_id = $2 AND c.year = 2025), 0)::float8 AS co2,
      (SELECT COUNT(*) FROM meters WHERE company_id = $1 AND unit_id = $2)::int AS meter_count
  `, [ids.companyA, ids.unitA1]);
  const response = await request.get(endpointUrl("kpi"), { headers: authorization(tokens.standardA1) });
  expect(response.status()).toBe(200);
  const body = await response.json();
  const row = expected.rows[0];
  expect(body.totalKwh).toBe(Math.round(row.kwh));
  expect(body.totalTep).toBe(Math.round(row.tep * 1000) / 1000);
  expect(body.totalCo2).toBe(Math.round((row.co2 / 1000) * 100) / 100);
  expect(body.meterCount).toBe(row.meter_count);
});

test("DASH-TREND-DB standard A1 aylık tüketim toplamları DB ile eşleşir", async ({ request }) => {
  const expected = await pool.query<{ month: number; kwh: number; tep: number; co2: number }>(`
    SELECT c.month, SUM(c.kwh)::float8 AS kwh, SUM(c.tep)::float8 AS tep, SUM(c.co2)::float8 AS co2
    FROM consumption c JOIN meters m ON m.id = c.meter_id
    WHERE c.company_id = $1 AND m.company_id = $1 AND m.unit_id = $2 AND c.year = 2025
    GROUP BY c.month ORDER BY c.month
  `, [ids.companyA, ids.unitA1]);
  const response = await request.get(endpointUrl("monthly-trend"), { headers: authorization(tokens.standardA1) });
  expect(response.status()).toBe(200);
  const body = await response.json();
  for (const row of expected.rows) {
    expect(body[row.month - 1]).toMatchObject({
      month: row.month,
      kwh: Math.round(row.kwh),
      tep: Math.round(row.tep * 1000) / 1000,
      co2: Math.round(row.co2 * 100) / 100,
    });
  }
});

test("DASH-TREND-WEATHER aylık weather verisi tenant company scope taşır", async ({ request }) => {
  const response = await request.get(endpointUrl("monthly-trend", "year=2026"), {
    headers: authorization(tokens.standardA1),
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body[0]).toMatchObject({ hdd: 51, cdd: 5 });
  expect(body[0]).not.toMatchObject({ hdd: 951, cdd: 95 });
});

test("WEATHER-DASH-02 admin ve kontrol_admin aynı company weather sonucunu alır", async ({ request }) => {
  const [admin, kontrol] = await Promise.all([
    request.get(endpointUrl("monthly-trend", "year=2026"), { headers: authorization(tokens.adminA) }),
    request.get(endpointUrl("monthly-trend", "year=2026"), { headers: authorization(tokens.kontrolAdminA) }),
  ]);
  expect(admin.status()).toBe(200);
  expect(kontrol.status()).toBe(200);
  const adminBody = await admin.json();
  const kontrolBody = await kontrol.json();
  expect(kontrolBody).toEqual(adminBody);
  expect(adminBody[0]).toMatchObject({ hdd: 51, cdd: 5 });
});

test("WEATHER-DASH-03-04 superadmin selected company weather değerini kullanır", async ({ request }) => {
  const [companyA, companyB] = await Promise.all([
    request.get(endpointUrl("monthly-trend", `year=2026&companyId=${ids.companyA}`), { headers: authorization(tokens.superadmin) }),
    request.get(endpointUrl("monthly-trend", `year=2026&companyId=${ids.companyB}`), { headers: authorization(tokens.superadmin) }),
  ]);
  expect(companyA.status()).toBe(200);
  expect(companyB.status()).toBe(200);
  expect((await companyA.json())[0]).toMatchObject({ hdd: 51, cdd: 5 });
  expect((await companyB.json())[0]).toMatchObject({ hdd: 951, cdd: 95 });
});

test("WEATHER-DASH-05 missing weather başka tenant fallback kullanmaz", async ({ request }) => {
  const response = await request.get(endpointUrl("monthly-trend", "year=2040"), {
    headers: authorization(tokens.standardA1),
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toHaveLength(12);
  expect(body.every((row: any) => row.hdd === null && row.cdd === null)).toBe(true);
});

test("WEATHER-DASH-06 gerçek zero weather missing kabul edilmez", async ({ request }) => {
  const inserted = await pool.query<{ id: number }>(`
    INSERT INTO weather (company_id, year, month, hdd, cdd, location)
    VALUES ($1, 2031, 4, 0, 0, '[E2E] Dashboard zero weather')
    RETURNING id
  `, [ids.companyA]);
  try {
    const response = await request.get(endpointUrl("monthly-trend", "year=2031"), {
      headers: authorization(tokens.standardA1),
    });
    expect(response.status()).toBe(200);
    expect((await response.json())[3]).toMatchObject({ month: 4, hdd: 0, cdd: 0 });
  } finally {
    await pool.query("DELETE FROM weather WHERE id = $1 AND company_id = $2", [inserted.rows[0].id, ids.companyA]);
  }
});

test("WEATHER-DASH-07 duplicate company/month weather belirsiz ve null kalır", async ({ request }) => {
  const inserted = await pool.query<{ id: number }>(`
    INSERT INTO weather (company_id, year, month, hdd, cdd, location)
    VALUES
      ($1, 2032, 2, 10, 1, '[E2E] Dashboard duplicate weather A'),
      ($1, 2032, 2, 20, 2, '[E2E] Dashboard duplicate weather B')
    RETURNING id
  `, [ids.companyA]);
  try {
    const response = await request.get(endpointUrl("monthly-trend", "year=2032"), {
      headers: authorization(tokens.standardA1),
    });
    expect(response.status()).toBe(200);
    expect((await response.json())[1]).toMatchObject({ month: 2, hdd: null, cdd: null });
  } finally {
    await pool.query(
      "DELETE FROM weather WHERE id = ANY($1::int[]) AND company_id = $2",
      [inserted.rows.map((row) => row.id), ids.companyA],
    );
  }
});

test("DASH-KONTROL-PARITY kontrol_admin ve admin company KPI sonucu eşleşir", async ({ request }) => {
  const [admin, kontrol] = await Promise.all([
    request.get(endpointUrl("kpi"), { headers: authorization(tokens.adminA) }),
    request.get(endpointUrl("kpi"), { headers: authorization(tokens.kontrolAdminA) }),
  ]);
  expect(admin.status()).toBe(200);
  expect(kontrol.status()).toBe(200);
  expect(await kontrol.json()).toEqual(await admin.json());
});

test("DASH-TENANT-KPI Tenant A ve Tenant B company sonuçları ayrıdır", async ({ request }) => {
  const [a, b] = await Promise.all([
    request.get(endpointUrl("kpi", `year=2025&companyId=${ids.companyA}`), { headers: authorization(tokens.superadmin) }),
    request.get(endpointUrl("kpi", `year=2025&companyId=${ids.companyB}`), { headers: authorization(tokens.superadmin) }),
  ]);
  expect(a.status()).toBe(200);
  expect(b.status()).toBe(200);
  expect(await a.json()).not.toEqual(await b.json());
});

test("DASH-NUMERIC bütün dashboard response değerleri finite kalır", async ({ request }) => {
  for (const endpoint of dashboardEndpoints) {
    const response = await request.get(endpointUrl(endpoint, `year=2025&companyId=${ids.companyA}`), {
      headers: authorization(tokens.superadmin),
    });
    expect(response.status()).toBe(200);
    expectNoUnsafeNumbers(await response.json());
  }
});

test("DASH-TARGET invalid status allowlist dışında reddedilir", async ({ request }) => {
  const response = await request.get(endpointUrl("target-status", "year=2025&status=not-a-status"), {
    headers: authorization(tokens.adminA),
  });
  expect(response.status()).toBe(400);
});

test("DASH-TARGET cross-tenant energySourceId reddedilir", async ({ request }) => {
  const response = await request.get(endpointUrl("target-status", `year=2025&energySourceId=${ids.energySourceB1}`), {
    headers: authorization(tokens.adminA),
  });
  expect(response.status()).toBe(403);
});

test("DASH-ACTION invalid status allowlist dışında reddedilir", async ({ request }) => {
  const response = await request.get(endpointUrl("action-status", "year=2025&status=not-a-status"), {
    headers: authorization(tokens.adminA),
  });
  expect(response.status()).toBe(400);
});

test("DASH-ACTION invalid priority allowlist dışında reddedilir", async ({ request }) => {
  const response = await request.get(endpointUrl("action-status", "year=2025&priority=not-a-priority"), {
    headers: authorization(tokens.adminA),
  });
  expect(response.status()).toBe(400);
});

test("DASH-ACTION invalid isVap boolean değerini reddeder", async ({ request }) => {
  const response = await request.get(endpointUrl("action-status", "year=2025&isVap=yes"), {
    headers: authorization(tokens.adminA),
  });
  expect(response.status()).toBe(400);
});

test("DASH-VAP invalid status allowlist dışında reddedilir", async ({ request }) => {
  const response = await request.get(endpointUrl("vap-summary", "year=2025&status=not-a-status"), {
    headers: authorization(tokens.adminA),
  });
  expect(response.status()).toBe(400);
});

test("DASH-VAP invalid feasibility status allowlist dışında reddedilir", async ({ request }) => {
  const response = await request.get(endpointUrl("vap-summary", "year=2025&feasibilityStatus=not-a-status"), {
    headers: authorization(tokens.adminA),
  });
  expect(response.status()).toBe(400);
});

test("AI-AUTH oturumsuz analiz endpointlerini reddeder", async ({ request }) => {
  expect((await request.post(analysisUrl(), { data: analysisRequest() })).status()).toBe(401);
  expect((await request.get(analysisUrl())).status()).toBe(401);
});

test("AI-STANDARD standard kullanici manuel analiz olusturur ve history/detail gorur", async ({ request }) => {
  const create = await request.post(analysisUrl(), {
    headers: authorization(tokens.standardA1),
    data: analysisRequest("energy_performance_overview"),
  });
  expect(create.status()).toBe(201);
  const body = await create.json();
  expect(body.meta.provider).toBe("mock");
  expect(body.meta.cacheHit).toBe(false);
  expect(body.analysis.result.summary).toContain("mock on analiz");
  expect(body.analysis.result.findings.length).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toContain("Tenant B marker");
  expect(JSON.stringify(body)).not.toContain("GEMINI_API_KEY");

  const history = await request.get(analysisUrl("year=2025&limit=8&offset=0"), {
    headers: authorization(tokens.standardA1),
  });
  expect(history.status()).toBe(200);
  const historyBody = await history.json();
  expect(historyBody.items.some((item: any) => item.id === body.analysis.id)).toBe(true);
  expect(JSON.stringify(historyBody)).not.toContain("result");

  const detail = await request.get("/api/ai/analyses/" + body.analysis.id + "?year=2025", {
    headers: authorization(tokens.standardA1),
  });
  expect(detail.status()).toBe(200);
  expect((await detail.json()).analysis.result.findings[0].id).toBe(body.analysis.result.findings[0].id);
});

test("AI-CACHE ayni scope ikinci analizde cache hit doner ve provider attempt artmaz", async ({ request }) => {
  const first = await request.post(analysisUrl("year=2025"), {
    headers: authorization(tokens.adminA),
    data: analysisRequest("data_quality_and_monitoring"),
  });
  expect(first.status()).toBe(201);
  const firstBody = await first.json();
  const attemptsBefore = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM ai_analysis_attempts WHERE analysis_id=$1",
    [firstBody.analysis.id],
  );
  expect(attemptsBefore.rows[0].count).toBe(1);

  const second = await request.post(analysisUrl("year=2025"), {
    headers: authorization(tokens.kontrolAdminA),
    data: analysisRequest("data_quality_and_monitoring"),
  });
  expect(second.status()).toBe(200);
  const secondBody = await second.json();
  expect(secondBody.meta.cacheHit).toBe(true);
  expect(secondBody.meta.sourceAnalysisId).toBe(firstBody.analysis.id);
  const attemptsAfter = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM ai_analysis_attempts WHERE analysis_id=$1",
    [firstBody.analysis.id],
  );
  expect(attemptsAfter.rows[0].count).toBe(1);
});

test("AI-SCOPE roller yeni analiz endpointinde fail-closed davranir", async ({ request }) => {
  const standardCrossUnit = await request.post(analysisUrl("year=2025&unitId=" + ids.unitA2), {
    headers: authorization(tokens.standardA1),
    data: analysisRequest(),
  });
  expect(standardCrossUnit.status()).toBe(403);

  const nullUnit = await request.post(analysisUrl(), {
    headers: authorization(tokens.nullUnit),
    data: analysisRequest(),
  });
  expect(nullUnit.status()).toBe(403);

  const adminCrossCompany = await request.post(analysisUrl("year=2025&companyId=" + ids.companyB), {
    headers: authorization(tokens.adminA),
    data: analysisRequest(),
  });
  expect(adminCrossCompany.status()).toBe(403);

  const superNoCompany = await request.post(analysisUrl(), {
    headers: authorization(tokens.superadmin),
    data: analysisRequest(),
  });
  expect(superNoCompany.status()).toBe(400);
});

test("AI-SA-COMPANY superadmin explicit Tenant A/B analizlerini ayirir", async ({ request }) => {
  const [a, b] = await Promise.all([
    request.post(analysisUrl("year=2025&companyId=" + ids.companyA), {
      headers: authorization(tokens.superadmin),
      data: analysisRequest("equipment_improvement_opportunities"),
    }),
    request.post(analysisUrl("year=2025&companyId=" + ids.companyB), {
      headers: authorization(tokens.superadmin),
      data: analysisRequest("equipment_improvement_opportunities"),
    }),
  ]);
  expect([200, 201]).toContain(a.status());
  expect([200, 201]).toContain(b.status());
  expect((await a.json()).analysis.id).not.toBe((await b.json()).analysis.id);
});

test("AI-INJECTION body scope/provider/cache manipulasyonu reddedilir veya yok sayilir", async ({ request }) => {
  const mismatch = await request.post(analysisUrl("year=2025&companyId=" + ids.companyB), {
    headers: authorization(tokens.superadmin),
    data: { ...analysisRequest(), companyId: ids.companyA },
  });
  expect(mismatch.status()).toBe(400);

  const response = await request.post(analysisUrl("year=2025"), {
    headers: authorization(tokens.adminA),
    data: {
      ...analysisRequest("energy_performance_overview"),
      provider: "gemini",
      model: "evil",
      cacheKey: "evil",
      dataVersion: "evil",
      cacheHit: true,
      fallbackUsed: true,
      result: { injected: true },
    },
  });
  expect([200, 201]).toContain(response.status());
  const body = await response.json();
  expect(body.meta.provider).toBe("mock");
  expect(body.meta.model).toBe("mock-v1");
  expect(JSON.stringify(body)).not.toContain("evil");
});

test("AI-LEGACY kural tabanli oneriler yalniz manuel endpoint ile calisir", async ({ request }) => {
  const authHeaders = authorization(tokens.adminA);
  const invalid = await request.post("/api/ai/suggestions", {
    headers: authHeaders,
    data: { focus: "not-a-focus", year: 2025 },
  });
  expect(invalid.status()).toBe(400);

  const response = await request.post("/api/ai/suggestions", {
    headers: authHeaders,
    data: { focus: "genel", year: 2025 },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.suggestions.length).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toContain("mock-v1");
});

test("UI-DASH-STANDARD standard dashboard kendi scope kartlarını güvenli render eder", async ({ page }) => {
  await loginUi(page, users.standardA1);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Yılı Enerji Performansı/ })).toBeVisible();
  await expect(page.getByText("Toplam TEP", { exact: true })).toBeVisible();
  await expect(page.getByText("Tenant B marker")).toHaveCount(0);
});

test("UI-AI-STANDARD sayfa acilisinda analiz cagirmadan yeni AI ekranini gosterir", async ({ page }) => {
  await loginUi(page, users.standardA1);
  const analysisPosts: string[] = [];
  const legacyPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/ai/analyses")) analysisPosts.push(request.url());
    if (request.method() === "POST" && request.url().includes("/api/ai/suggestions")) legacyPosts.push(request.url());
  });
  await page.goto("/oneriler");
  await expect(page.getByRole("heading", { name: "AI Enerji Analizleri" })).toBeVisible();
  await expect(page.getByText("Firma AI kullanimi")).toBeVisible();
  await expect(page.getByText("Analiz gecmisi")).toBeVisible();
  await expect(page.getByText("Sayfa acilisinda AI provider cagrisi yapilmaz.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Analiz olustur" })).toBeVisible();
  expect(analysisPosts).toEqual([]);
  expect(legacyPosts).toEqual([]);
  await expect(page.locator("script", { hasText: "alert(1)" })).toHaveCount(0);
  await expect(page.getByText("Tenant B marker")).toHaveCount(0);
});

test("UI-AI-ANALYSIS manuel analiz, cache, detail ve draft action akisi calisir", async ({ page }) => {
  await loginUi(page, users.adminA);
  const analysisResponses: APIResponse[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.url().includes("/api/ai/analyses")) {
      analysisResponses.push(response);
    }
  });
  await page.goto("/oneriler");
  await expect(page.getByRole("heading", { name: "AI Enerji Analizleri" })).toBeVisible();
  await page.locator("#analysis-unit").click();
  await page.getByRole("option", { name: "[E2E] Unit A1" }).click();

  const createButton = page.getByRole("button", { name: "Analiz olustur" });
  await createButton.dblclick();
  await expect(page.locator('[data-testid="ai-analysis-result"]').getByText("Ozet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Gerekce, kanit ve sinirlamalar" }).first().click();
  await expect(page.getByText("Kanitlar").first()).toBeVisible();
  await expect(page.getByText("Sinirlamalar").first()).toBeVisible();
  await expect(page.getByText("AI sonuc aciklamasi")).toBeVisible();
  expect(analysisResponses).toHaveLength(1);
  const firstBody = await analysisResponses[0].json();
  expect(firstBody.meta.cacheHit).toBe(false);
  expect(JSON.stringify(firstBody)).not.toContain("GEMINI_API_KEY");
  expect(JSON.stringify(firstBody)).not.toContain("promptPolicyVersion");
  expect(JSON.stringify(firstBody)).not.toContain("contextSchemaVersion");

  await createButton.click();
  await expect(page.getByText("Cache hit").first()).toBeVisible();
  expect(analysisResponses).toHaveLength(2);
  const secondBody = await analysisResponses[1].json();
  expect(secondBody.meta.cacheHit).toBe(true);

  await expect(page.getByText("Analiz gecmisi")).toBeVisible();
  const historyRow = page.getByRole("row").filter({ hasText: `Unit #${ids.unitA1}` }).first();
  await expect(historyRow).toBeVisible();
  await historyRow.getByRole("button", { name: /Goster/ }).click();
  const detailDialog = page.getByRole("dialog");
  await expect(detailDialog.getByText("Analiz detayi")).toBeVisible();
  await expect(detailDialog.locator('[data-testid="ai-analysis-result"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Taslak aksiyon olustur" }).first().click();
  await expect(page.getByRole("dialog").getByText("Kayit yalniz onay verilip kaydet butonuna basildiginda olusturulur.")).toBeVisible();
  const saveButton = page.getByRole("button", { name: "Taslak aksiyonu kaydet" });
  await expect(saveButton).toBeDisabled();
  await expect(page.locator("#draft-saving")).toHaveValue("");
  await page.locator("#draft-target").click();
  await page.getByRole("option").first().click();
  await page.locator("#draft-title").fill("E2E AI taslak aksiyon");
  await page.getByLabel(/AI destekli karar destegi/).click();
  const draftResponse = page.waitForResponse((response) => response.url().includes("/draft-action") && response.request().method() === "POST");
  await saveButton.click();
  const draftBody = await (await draftResponse).json();
  expect(draftBody.created).toBe(true);
  expect(draftBody.action.status).toBe("planned");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const action = await pool.query<{ status: string; progress_percent: number; expected_saving_value: string | null }>(
    "SELECT status, progress_percent, expected_saving_value FROM energy_action_plans WHERE id=$1",
    [draftBody.action.id],
  );
  expect(action.rows[0]).toMatchObject({ status: "planned", progress_percent: 0, expected_saving_value: null });
});

test("UI-AI-KONTROL kontrol_admin yeni AI analiz ekranina erisebilir", async ({ page }) => {
  await loginUi(page, users.kontrolAdminA);
  await page.goto("/oneriler");
  await expect(page.getByRole("heading", { name: "AI Enerji Analizleri" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analiz olustur" })).toBeVisible();
});

test("UI-AI-NULL null-unit kullanici analiz hatasini kontrollu gorur", async ({ page }) => {
  await loginUi(page, users.nullUnit);
  await page.goto("/oneriler");
  await page.getByRole("button", { name: "Analiz olustur" }).click();
  await expect(page.getByText(/birim kapsami gereklidir/i).first()).toBeVisible();
});

test("UI-AI-LEGACY legacy oneriler manuel acilir ve guvenli render edilir", async ({ page }) => {
  await loginUi(page, users.adminA);
  await page.goto("/oneriler");
  await expect(page.getByText("Kural tabanli oneriler", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Kural tabanli onerileri goster" }).click();
  await expect(page.getByText("Tasarruf").first()).toBeVisible();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator("[onerror], [onclick]")).toHaveCount(0);
});
