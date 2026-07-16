import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime value is required.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("SEU/energy-performance E2E requires a disposable test database.");
  }
  const raw = requiredEnv("DATABASE_URL");
  const url = new URL(raw);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("SEU/energy-performance E2E database is not the disposable localhost database.");
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
  standardA2: "e2e_user_a2",
  standardB1: requiredEnv("E2E_STANDARD_B_USERNAME"),
  adminA: requiredEnv("E2E_ADMIN_USERNAME"),
  kontrolAdminA: requiredEnv("E2E_KONTROL_ADMIN_USERNAME"),
  nullUnit: requiredEnv("E2E_NULL_UNIT_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type Session = { token: string; user: { id: number; role: string; companyId: number; unitId: number | null } };
type Assessment = { id: number; unitId: number; year: number; recordType: string; isOfficial: boolean; itemCount: number };
type SeuItem = { id: number; assessmentId: number; name: string; userDecision: string; unitId: number; assessmentRecordType: string; assessmentIsOfficial: boolean };
type Regression = {
  error?: string; modelType: string; sampleSize: number; intercept: number; rSquared: number; adjustedRSquared: number;
  isValid: boolean; formulaText: string; dependentVariableUnit: string; dependentVariableType: string;
  variables: Array<{ variableName: string; code: string; coefficient: number; standardError: number; tStat: number; pValue: number; isSignificant: boolean }>;
  usedMonths: string[]; missingVariableMonths: Array<{ month: string; missingVariables: string[] }>;
};
type FixtureIds = {
  companyA: number; companyB: number; unitA1: number; unitA2: number; unitB1: number;
  assessmentA1: number; draftA1: number; assessmentA2: number; assessmentB1: number;
  acceptedA1: number; rejectedA1: number; monitorA1: number; draftAcceptedA1: number; acceptedA2: number; acceptedB1: number;
  production: number; hours: number; partial: number; invalidModel: number; importVariable: number; variableB: number;
};

let ids: FixtureIds;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const userCode = (id: number) => `user-${id}`;

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

async function resolveFixtureIds(): Promise<FixtureIds> {
  const result = await pool.query<Record<string, number>>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain='e2e-tenant-a') company_a,
      (SELECT id FROM companies WHERE subdomain='e2e-tenant-b') company_b,
      (SELECT id FROM units WHERE name='[E2E] Unit A1') unit_a1,
      (SELECT id FROM units WHERE name='[E2E] Unit A2') unit_a2,
      (SELECT id FROM units WHERE name='[E2E] Unit B1') unit_b1,
      (SELECT id FROM seu_assessments WHERE company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a') AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND record_type='unit_official') assessment_a1,
      (SELECT id FROM seu_assessments WHERE company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a') AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND record_type='admin_review') draft_a1,
      (SELECT id FROM seu_assessments WHERE unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A2')) assessment_a2,
      (SELECT id FROM seu_assessments WHERE unit_id=(SELECT id FROM units WHERE name='[E2E] Unit B1')) assessment_b1,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] SEU Electricity A1' AND assessment_id=(SELECT id FROM seu_assessments WHERE unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND record_type='unit_official')) accepted_a1,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] SEU Natural Gas A1') rejected_a1,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] SEU Monitoring A1') monitor_a1,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] Draft Accepted A1') draft_accepted_a1,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] SEU Electricity A2') accepted_a2,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] SEU Electricity A1' AND assessment_id=(SELECT id FROM seu_assessments WHERE unit_id=(SELECT id FROM units WHERE name='[E2E] Unit B1'))) accepted_b1,
      (SELECT id FROM variables WHERE code='E2E_PRODUCTION' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a')) production,
      (SELECT id FROM variables WHERE code='E2E_HOURS' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a')) hours,
      (SELECT id FROM variables WHERE code='E2E_PARTIAL') partial,
      (SELECT id FROM variables WHERE code='E2E_INVALID_MODEL') invalid_model,
      (SELECT id FROM variables WHERE code='E2E_IMPORT') import_variable,
      (SELECT id FROM variables WHERE code='E2E_HOURS' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b')) variable_b
  `);
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => !Number.isSafeInteger(value))) throw new Error("F3A6 fixture IDs could not be resolved.");
  return {
    companyA: row.company_a, companyB: row.company_b, unitA1: row.unit_a1, unitA2: row.unit_a2, unitB1: row.unit_b1,
    assessmentA1: row.assessment_a1, draftA1: row.draft_a1, assessmentA2: row.assessment_a2, assessmentB1: row.assessment_b1,
    acceptedA1: row.accepted_a1, rejectedA1: row.rejected_a1, monitorA1: row.monitor_a1, draftAcceptedA1: row.draft_accepted_a1,
    acceptedA2: row.accepted_a2, acceptedB1: row.accepted_b1, production: row.production, hours: row.hours, partial: row.partial,
    invalidModel: row.invalid_model, importVariable: row.import_variable, variableB: row.variable_b,
  };
}

async function regression(request: APIRequestContext, token: string, seuItemId: number, variables: string[], year = 2025) {
  const response = await request.post("/api/energy-performance/regression/run", {
    headers: auth(token), data: { seuItemId, year, selectedVariables: variables },
  });
  return { response, body: await response.json() as Regression };
}

function forgedRegression(variableId: number, overrides: Record<string, unknown> = {}) {
  return {
    modelType: "single_regression", intercept: 10, rSquared: 0.99, adjustedRSquared: 0.98, sampleSize: 12,
    formulaText: "E2E forged formula", isValid: true, dependentVariableUnit: "kWh",
    variables: [{ variableName: "E2E variable", code: userCode(variableId), coefficient: 2, standardError: 0.1, tStat: 20, pValue: 0.001, isSignificant: true }],
    ...overrides,
  };
}

async function createBaseline(request: APIRequestContext, token: string, seuItemId: number, variableId: number, status: "active" | "draft" = "draft", regressionResult = forgedRegression(variableId)) {
  return request.post("/api/energy-performance/baselines", {
    headers: auth(token),
    data: { seuItemId, year: 2025, baselinePeriodStart: "2025-01-01", baselinePeriodEnd: "2025-12-31", regressionResult, status, notes: "[E2E] F3A6" },
  });
}

async function cleanupBaselines(): Promise<void> {
  await pool.query("DELETE FROM energy_performance_results WHERE baseline_id IN (SELECT id FROM energy_baselines WHERE notes='[E2E] F3A6')");
  await pool.query("DELETE FROM energy_baseline_variables WHERE baseline_id IN (SELECT id FROM energy_baselines WHERE notes='[E2E] F3A6')");
  await pool.query("DELETE FROM energy_baselines WHERE notes='[E2E] F3A6'");
  await pool.query("UPDATE energy_baselines SET status='active' WHERE notes='[E2E] target parent fixture'");
}

function valuesForTargetRSquared(targetRSquared: number): number[] {
  const y = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500];
  const mean = y.reduce((sum, value) => sum + value, 0) / y.length;
  const centered = y.map(value => value - mean);
  const seed = y.map((_, index) => index % 2 === 0 ? 1 : -1);
  const seedMean = seed.reduce((sum, value) => sum + value, 0) / seed.length;
  const centeredSeed = seed.map(value => value - seedMean);
  const projection = centeredSeed.reduce((sum, value, index) => sum + value * centered[index]!, 0)
    / centered.reduce((sum, value) => sum + value * value, 0);
  const orthogonal = centeredSeed.map((value, index) => value - projection * centered[index]!);
  const centeredNorm = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0));
  const orthogonalNorm = Math.sqrt(orthogonal.reduce((sum, value) => sum + value * value, 0));
  const scaledOrthogonal = orthogonal.map(value => value * centeredNorm / orthogonalNorm);
  return centered.map((value, index) =>
    1000 + Math.sqrt(targetRSquared) * value + Math.sqrt(1 - targetRSquared) * scaledOrthogonal[index]!
  );
}

async function createCorrelationVariable(label: string, targetRSquared: number): Promise<number> {
  const variable = await pool.query<{ id: number }>(
    "INSERT INTO variables (company_id, name, code, category, variable_type, source_type, scope_type) VALUES ($1,$2,$3,'operational','numeric','operation_manual','company') RETURNING id",
    [ids.companyA, `[E2E] ${label}`, `E2E_${label}`,],
  );
  const variableId = variable.rows[0]!.id;
  const values = valuesForTargetRSquared(targetRSquared);
  for (let index = 0; index < values.length; index++) {
    const month = index + 1;
    await pool.query(
      "INSERT INTO variable_values (company_id, variable_id, period_start, period_end, value, source) VALUES ($1,$2,$3,$4,$5,'[E2E] boundary')",
      [ids.companyA, variableId, `2025-${String(month).padStart(2, "0")}-01`, `2025-${String(month).padStart(2, "0")}-28`, values[index]],
    );
  }
  return variableId;
}

async function deleteTestVariables(variableIds: number[]): Promise<void> {
  if (variableIds.length > 0) await pool.query("DELETE FROM variables WHERE id = ANY($1::int[])", [variableIds]);
}

test.beforeAll(async () => { ids = await resolveFixtureIds(); });
test.afterEach(async () => { await cleanupBaselines(); });
test.afterAll(async () => { await cleanupBaselines(); await pool.end(); });

test("SEU-01 standard A1 sees only its official assessment", async ({ request }) => {
  const s = await login(request, credentials.standardA1); const rows = await (await request.get("/api/seu/assessments", { headers: auth(s.token) })).json() as Assessment[];
  expect(rows.map((row) => row.id)).toEqual([ids.assessmentA1]);
});
test("SEU-02 standard A2 sees only its unit", async ({ request }) => { const s = await login(request, credentials.standardA2); const rows = await (await request.get("/api/seu/assessments", { headers: auth(s.token) })).json() as Assessment[]; expect(rows.map((r) => r.id)).toEqual([ids.assessmentA2]); });
test("SEU-03 null-unit standard gets empty list", async ({ request }) => { const s = await login(request, credentials.nullUnit); expect(await (await request.get("/api/seu/assessments", { headers: auth(s.token) })).json()).toEqual([]); });
test("SEU-04 null-unit standard detail fails closed", async ({ request }) => { const s = await login(request, credentials.nullUnit); expect((await request.get(`/api/seu/assessments/${ids.assessmentA1}`, { headers: auth(s.token) })).status()).toBe(403); });
test("SEU-05 admin sees Tenant A assessments only", async ({ request }) => { const s = await login(request, credentials.adminA); const rows = await (await request.get("/api/seu/assessments", { headers: auth(s.token) })).json() as Assessment[]; expect(new Set(rows.map((r) => r.id))).toEqual(new Set([ids.assessmentA1, ids.draftA1, ids.assessmentA2])); });
test("SEU-06 kontrol_admin matches admin", async ({ request }) => { const a = await login(request, credentials.adminA); const k = await login(request, credentials.kontrolAdminA); const ar = await (await request.get("/api/seu/assessments", { headers: auth(a.token) })).json() as Assessment[]; const kr = await (await request.get("/api/seu/assessments", { headers: auth(k.token) })).json() as Assessment[]; expect(kr.map((r) => r.id)).toEqual(ar.map((r) => r.id)); });
test("SEU-07 admin company query cannot escape tenant", async ({ request }) => { const s = await login(request, credentials.adminA); const rows = await (await request.get(`/api/seu/assessments?companyId=${ids.companyB}`, { headers: auth(s.token) })).json() as Assessment[]; expect(rows.some((r) => r.id === ids.assessmentB1)).toBe(false); });
test("SEU-08 admin filters own unit", async ({ request }) => { const s = await login(request, credentials.adminA); const rows = await (await request.get(`/api/seu/assessments?unitId=${ids.unitA2}`, { headers: auth(s.token) })).json() as Assessment[]; expect(rows.map((r) => r.id)).toEqual([ids.assessmentA2]); });
test("SEU-09 admin rejects foreign unit", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.get(`/api/seu/assessments?unitId=${ids.unitB1}`, { headers: auth(s.token) })).status()).toBe(403); });
test("SEU-10 superadmin company filters separate tenants", async ({ request }) => { const s = await login(request, credentials.superadmin); const a = await (await request.get(`/api/seu/assessments?companyId=${ids.companyA}`, { headers: auth(s.token) })).json() as Assessment[]; const b = await (await request.get(`/api/seu/assessments?companyId=${ids.companyB}`, { headers: auth(s.token) })).json() as Assessment[]; expect(a).toHaveLength(3); expect(b.map((r) => r.id)).toEqual([ids.assessmentB1]); });
test("SEU-11 superadmin rejects company/unit mismatch", async ({ request }) => { const s = await login(request, credentials.superadmin); expect((await request.get(`/api/seu/assessments?companyId=${ids.companyA}&unitId=${ids.unitB1}`, { headers: auth(s.token) })).status()).toBe(403); });
test("SEU-12 assessment detail parent items are scoped", async ({ request }) => { const s = await login(request, credentials.standardA1); const body = await (await request.get(`/api/seu/assessments/${ids.assessmentA1}`, { headers: auth(s.token) })).json() as Assessment & { items: Array<{ id: number }> }; expect(new Set(body.items.map((i) => i.id))).toEqual(new Set([ids.acceptedA1, ids.rejectedA1, ids.monitorA1])); });
test("SEU-13 standard cannot read another unit detail", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.get(`/api/seu/assessments/${ids.assessmentA2}`, { headers: auth(s.token) })).status()).toBe(404); });
test("SEU-14 admin cannot read another tenant detail", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.get(`/api/seu/assessments/${ids.assessmentB1}`, { headers: auth(s.token) })).status()).toBe(404); });
test("SEU-15 superadmin can read explicitly listed Tenant B assessment", async ({ request }) => { const s = await login(request, credentials.superadmin); expect((await request.get(`/api/seu/assessments/${ids.assessmentB1}`, { headers: auth(s.token) })).status()).toBe(200); });
test("SEU-15B superadmin matching explicit company can read detail", async ({ request }) => { const s = await login(request, credentials.superadmin); expect((await request.get(`/api/seu/assessments/${ids.assessmentB1}?companyId=${ids.companyB}`, { headers: auth(s.token) })).status()).toBe(200); });
test("SEU-15C superadmin mismatched explicit company cannot read detail", async ({ request }) => { const s = await login(request, credentials.superadmin); expect((await request.get(`/api/seu/assessments/${ids.assessmentB1}?companyId=${ids.companyA}`, { headers: auth(s.token) })).status()).toBe(404); });
test("SEU-15D superadmin invalid explicit company is rejected", async ({ request }) => { const s = await login(request, credentials.superadmin); expect((await request.get(`/api/seu/assessments/${ids.assessmentB1}?companyId=123abc`, { headers: auth(s.token) })).status()).toBe(400); });

for (const [label, path] of [
  ["assessment suffix", "/api/seu/assessments/123abc"], ["assessment zero", "/api/seu/assessments/0"], ["assessment decimal", "/api/seu/assessments/1.5"],
  ["company suffix", "/api/seu/assessments?companyId=123abc"], ["company zero", "/api/seu/assessments?companyId=0"],
  ["unit negative", "/api/seu/assessments?unitId=-1"], ["unit decimal", "/api/seu/assessments?unitId=1.5"], ["unit empty", "/api/seu/assessments?unitId="],
] as const) {
  test(`SEU-ID ${label} is rejected`, async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.get(path, { headers: auth(s.token) })).status()).toBe(400); });
}
test("SEU-ID year partial numeric is rejected", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.get("/api/seu/assessments?year=2025abc", { headers: auth(s.token) })).status()).toBe(400); });
test("SEU-ID analyze month decimal is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.get("/api/seu/analyze?year=2025&monthStart=1.5", { headers: auth(s.token) })).status()).toBe(400); });
for (const query of ["monthStart=0", "monthEnd=13", "monthStart=2abc"] as const) {
  test(`SEU-ID analyze ${query} is rejected`, async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.get(`/api/seu/analyze?year=2025&${query}`, { headers: auth(s.token) })).status()).toBe(400); });
}

test("ITEM-01 meter analysis returns 12-month deterministic TEP", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await request.get("/api/seu/analyze?year=2025&analysisLevel=meter", { headers: auth(s.token) }); expect(response.status()).toBe(200); const body = await response.json() as { unitId: number; unitTotalTep: number; items: Array<{ energyTep: number; consumptionSharePercent: number }> }; expect(body.unitId).toBe(ids.unitA1); expect(body.items.length).toBeGreaterThanOrEqual(3); expect(body.unitTotalTep).toBeGreaterThan(0); expect(body.items.reduce((sum, item) => sum + item.consumptionSharePercent, 0)).toBeCloseTo(100, 1); });
for (const level of ["energyUseGroup", "energySource", "subUnit", "unit"] as const) {
  test(`ITEM analysis level ${level} is tenant-scoped`, async ({ request }) => { const s = await login(request, credentials.adminA); const response = await request.get(`/api/seu/analyze?year=2025&unitId=${ids.unitA1}&analysisLevel=${level}`, { headers: auth(s.token) }); expect(response.status()).toBe(200); const body = await response.json() as { unitId: number; analysisLevel: string; items: unknown[] }; expect(body.unitId).toBe(ids.unitA1); expect(body.analysisLevel).toBe(level); expect(body.items.length).toBeGreaterThan(0); });
}
test("ITEM-02 null-unit analysis returns zero shape", async ({ request }) => { const s = await login(request, credentials.nullUnit); const body = await (await request.get("/api/seu/analyze?year=2025", { headers: auth(s.token) })).json() as { unitId: null; unitTotalTep: number; items: unknown[] }; expect(body).toMatchObject({ unitId: null, unitTotalTep: 0, items: [] }); });
test("ITEM-03 standard query unit cannot override session", async ({ request }) => { const s = await login(request, credentials.standardA1); const body = await (await request.get(`/api/seu/analyze?year=2025&unitId=${ids.unitA2}`, { headers: auth(s.token) })).json() as { unitId: number }; expect(body.unitId).toBe(ids.unitA1); });
test("ITEM-04 admin foreign analysis unit is rejected", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.get(`/api/seu/analyze?year=2025&unitId=${ids.unitB1}`, { headers: auth(s.token) })).status()).toBe(403); });

test("ITEM-05 accepted decision can be saved and restored", async ({ request }) => { const s = await login(request, credentials.standardA1); try { const response = await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.monitorA1}`, { headers: auth(s.token), data: { userDecision: "accepted_as_seu" } }); expect(response.status()).toBe(200); expect((await response.json() as { userDecision: string }).userDecision).toBe("accepted_as_seu"); } finally { await pool.query("UPDATE seu_assessment_items SET user_decision='monitor' WHERE id=$1", [ids.monitorA1]); } });
test("ITEM-06 rejected decision can be saved and restored", async ({ request }) => { const s = await login(request, credentials.standardA1); try { const response = await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.monitorA1}`, { headers: auth(s.token), data: { userDecision: "not_seu" } }); expect(response.status()).toBe(200); } finally { await pool.query("UPDATE seu_assessment_items SET user_decision='monitor' WHERE id=$1", [ids.monitorA1]); } });
test("ITEM-07 monitoring decision can be saved", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.monitorA1}`, { headers: auth(s.token), data: { userDecision: "monitor" } })).status()).toBe(200); });
test("ITEM-08 unknown decision is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); try { expect((await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.monitorA1}`, { headers: auth(s.token), data: { userDecision: "invented_decision" } })).status()).toBe(400); } finally { await pool.query("UPDATE seu_assessment_items SET user_decision='monitor' WHERE id=$1", [ids.monitorA1]); } });
test("ITEM-09 parent-child mismatch is hidden", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.acceptedA2}`, { headers: auth(s.token), data: { notes: "blocked" } })).status()).toBe(404); });
test("ITEM-10 standard cannot mutate another unit item", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.patch(`/api/seu/assessments/${ids.assessmentA2}/items/${ids.acceptedA2}`, { headers: auth(s.token), data: { notes: "blocked" } })).status()).toBe(404); });
test("ITEM-11 admin cannot mutate another tenant item", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.patch(`/api/seu/assessments/${ids.assessmentB1}/items/${ids.acceptedB1}`, { headers: auth(s.token), data: { notes: "blocked" } })).status()).toBe(404); });
test("ITEM-12 null-unit mutation is forbidden", async ({ request }) => { const s = await login(request, credentials.nullUnit); expect((await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.acceptedA1}`, { headers: auth(s.token), data: { notes: "blocked" } })).status()).toBe(403); });
test("ITEM-13 partial numeric target reduction is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); try { expect((await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.monitorA1}`, { headers: auth(s.token), data: { targetReductionPercent: "12abc" } })).status()).toBe(400); } finally { await pool.query("UPDATE seu_assessment_items SET target_reduction_percent=NULL WHERE id=$1", [ids.monitorA1]); } });
test("ITEM-14 invalid decision update is atomic", async ({ request }) => { const s = await login(request, credentials.standardA1); await pool.query("UPDATE seu_assessment_items SET notes='[E2E] original atomic note' WHERE id=$1", [ids.monitorA1]); try { const response = await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.monitorA1}`, { headers: auth(s.token), data: { userDecision: "invented_decision", notes: "must not persist" } }); expect(response.status()).toBe(400); const row = await pool.query<{ notes: string; user_decision: string }>("SELECT notes, user_decision FROM seu_assessment_items WHERE id=$1", [ids.monitorA1]); expect(row.rows[0]).toMatchObject({ notes: "[E2E] original atomic note", user_decision: "monitor" }); } finally { await pool.query("UPDATE seu_assessment_items SET notes=NULL, user_decision='monitor' WHERE id=$1", [ids.monitorA1]); } });
test("ITEM-15 invalid target reduction update is atomic", async ({ request }) => { const s = await login(request, credentials.standardA1); await pool.query("UPDATE seu_assessment_items SET notes='[E2E] original target note', target_reduction_percent=4.5 WHERE id=$1", [ids.monitorA1]); try { const response = await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.monitorA1}`, { headers: auth(s.token), data: { targetReductionPercent: "12abc", notes: "must not persist" } }); expect(response.status()).toBe(400); const row = await pool.query<{ notes: string; target_reduction_percent: number }>("SELECT notes, target_reduction_percent FROM seu_assessment_items WHERE id=$1", [ids.monitorA1]); expect(row.rows[0]?.notes).toBe("[E2E] original target note"); expect(row.rows[0]?.target_reduction_percent).toBeCloseTo(4.5, 5); } finally { await pool.query("UPDATE seu_assessment_items SET notes=NULL, target_reduction_percent=NULL WHERE id=$1", [ids.monitorA1]); } });
test("ITEM-16 valid decimal target reduction is accepted", async ({ request }) => { const s = await login(request, credentials.standardA1); try { const response = await request.patch(`/api/seu/assessments/${ids.assessmentA1}/items/${ids.monitorA1}`, { headers: auth(s.token), data: { targetReductionPercent: " 12.5 " } }); expect(response.status()).toBe(200); expect((await response.json() as { targetReductionPercent: number }).targetReductionPercent).toBeCloseTo(12.5, 5); } finally { await pool.query("UPDATE seu_assessment_items SET target_reduction_percent=NULL WHERE id=$1", [ids.monitorA1]); } });

test("ACC-01 only official accepted item appears for regression", async ({ request }) => { const s = await login(request, credentials.standardA1); const rows = await (await request.get("/api/energy-performance/seu-items", { headers: auth(s.token) })).json() as SeuItem[]; expect(rows.some((r) => r.id === ids.acceptedA1)).toBe(true); expect(rows.some((r) => r.id === ids.draftAcceptedA1)).toBe(false); });
test("ACC-02 rejected item is absent", async ({ request }) => { const s = await login(request, credentials.standardA1); const rows = await (await request.get("/api/energy-performance/seu-items", { headers: auth(s.token) })).json() as SeuItem[]; expect(rows.some((r) => r.id === ids.rejectedA1)).toBe(false); });
test("ACC-03 monitoring item is absent", async ({ request }) => { const s = await login(request, credentials.standardA1); const rows = await (await request.get("/api/energy-performance/seu-items", { headers: auth(s.token) })).json() as SeuItem[]; expect(rows.some((r) => r.id === ids.monitorA1)).toBe(false); });
test("ACC-04 standard A2 sees only accepted A2", async ({ request }) => { const s = await login(request, credentials.standardA2); const rows = await (await request.get("/api/energy-performance/seu-items", { headers: auth(s.token) })).json() as SeuItem[]; expect(rows.map((r) => r.id)).toEqual([ids.acceptedA2]); });
test("ACC-05 null-unit accepted list is empty", async ({ request }) => { const s = await login(request, credentials.nullUnit); expect(await (await request.get("/api/energy-performance/seu-items", { headers: auth(s.token) })).json()).toEqual([]); });
test("ACC-06 admin accepted list excludes Tenant B", async ({ request }) => { const s = await login(request, credentials.adminA); const rows = await (await request.get("/api/energy-performance/seu-items", { headers: auth(s.token) })).json() as SeuItem[]; expect(rows.some((r) => r.id === ids.acceptedB1)).toBe(false); });
test("ACC-07 superadmin company filter separates accepted items", async ({ request }) => { const s = await login(request, credentials.superadmin); const rows = await (await request.get(`/api/energy-performance/seu-items?companyId=${ids.companyB}`, { headers: auth(s.token) })).json() as SeuItem[]; expect(rows.map((r) => r.id)).toEqual([ids.acceptedB1]); });

test("REG-DATA-01 dataset has 12 consumption months", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await request.get(`/api/energy-performance/dataset?seuItemId=${ids.acceptedA1}&year=2025`, { headers: auth(s.token) }); expect(response.status()).toBe(200); const body = await response.json() as { matchType: string; matchedMeterCount: number; missingMonths: string[]; consumptionDataset: Array<{ month: number; totalKwh: number }> }; expect(body.matchType).toBe("meter"); expect(body.matchedMeterCount).toBe(1); expect(body.consumptionDataset).toHaveLength(12); expect(body.missingMonths).toEqual([]); expect(body.consumptionDataset[0]).toMatchObject({ month: 1, totalKwh: 1000 }); });
test("REG-DATA-02 standard cannot load A2 dataset", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.get(`/api/energy-performance/dataset?seuItemId=${ids.acceptedA2}&year=2025`, { headers: auth(s.token) })).status()).toBe(403); });
test("REG-DATA-03 admin cannot load Tenant B dataset", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.get(`/api/energy-performance/dataset?seuItemId=${ids.acceptedB1}&year=2025`, { headers: auth(s.token) })).status()).toBe(404); });
test("REG-DATA-04 null-unit dataset is forbidden", async ({ request }) => { const s = await login(request, credentials.nullUnit); expect((await request.get(`/api/energy-performance/dataset?seuItemId=${ids.acceptedA1}&year=2025`, { headers: auth(s.token) })).status()).toBe(403); });
test("REG-DATA-05 invalid item ID is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.get("/api/energy-performance/dataset?seuItemId=123abc&year=2025", { headers: auth(s.token) })).status()).toBe(400); });
test("REG-DATA-06 invalid year is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.get(`/api/energy-performance/dataset?seuItemId=${ids.acceptedA1}&year=2025abc`, { headers: auth(s.token) })).status()).toBe(400); });
test("REG-VAR-01 variable catalog is Tenant A scoped", async ({ request }) => { const s = await login(request, credentials.standardA1); const body = await (await request.get("/api/energy-performance/variables", { headers: auth(s.token) })).json() as { systemVariables: Array<{ code: string }>; userVariables: Array<{ id: number }> }; expect(body.systemVariables.some((v) => v.code === "HDD")).toBe(true); expect(body.userVariables.some((v) => v.id === ids.production)).toBe(true); expect(body.userVariables.some((v) => v.id === ids.variableB)).toBe(false); });
test("REG-VAR-02 null-unit variable catalog is empty", async ({ request }) => { const s = await login(request, credentials.nullUnit); expect(await (await request.get("/api/energy-performance/variables", { headers: auth(s.token) })).json()).toEqual({ systemVariables: [], userVariables: [] }); });

test("REG-01 high-correlation company variable produces valid single model", async ({ request }) => { const s = await login(request, credentials.standardA1); const { response, body } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.production)]); expect(response.status()).toBe(200); expect(body.modelType).toBe("single_regression"); expect(body.sampleSize).toBe(12); expect(body.rSquared).toBeGreaterThan(0.99); expect(body.variables[0]?.pValue).toBeLessThan(0.1); expect(body.isValid).toBe(true); expect(body.dependentVariableType).toBe("raw_consumption"); });
test("REG-02 unit variable uses A1 values only", async ({ request }) => { const s = await login(request, credentials.standardA1); const { body } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.hours)]); expect(body.sampleSize).toBe(12); expect(body.usedMonths).toHaveLength(12); });
test("REG-03 partial variable matches seven months", async ({ request }) => { const s = await login(request, credentials.standardA1); const { body } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.partial)]); expect(body.sampleSize).toBe(7); expect(body.usedMonths).toHaveLength(7); expect(body.missingVariableMonths).toHaveLength(5); });
test("REG-04 multi-variable dataset uses month intersection", async ({ request }) => { const s = await login(request, credentials.standardA1); const { body } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.production), userCode(ids.partial)]); expect(body.modelType).toBe("multiple_regression"); expect(body.sampleSize).toBe(7); expect(body.missingVariableMonths).toHaveLength(5); });
test("REG-05 low-quality variable is invalid", async ({ request }) => { const s = await login(request, credentials.standardA1); const { body } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.invalidModel)]); expect(body.sampleSize).toBe(12); expect(body.isValid).toBe(false); expect(body.rSquared).toBeLessThan(0.75); });
test("REG-06 no-value variable reports insufficient sample", async ({ request }) => { const s = await login(request, credentials.standardA1); const { body } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.importVariable)]); expect(body.sampleSize).toBe(0); expect(body.error).toBeTruthy(); expect(body.missingVariableMonths).toHaveLength(12); });
test("REG-07 cross-tenant variable is hidden", async ({ request }) => { const s = await login(request, credentials.standardA1); const { response } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.variableB)]); expect(response.status()).toBe(404); });
test("REG-08 cross-unit SEU is forbidden", async ({ request }) => { const s = await login(request, credentials.standardA1); const { response } = await regression(request, s.token, ids.acceptedA2, [userCode(ids.production)]); expect(response.status()).toBe(403); });
test("REG-09 cross-tenant SEU is hidden", async ({ request }) => { const s = await login(request, credentials.adminA); const { response } = await regression(request, s.token, ids.acceptedB1, [userCode(ids.production)]); expect(response.status()).toBe(404); });
test("REG-10 invalid selected variable code is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); const { response } = await regression(request, s.token, ids.acceptedA1, ["user-123abc"]); expect(response.status()).toBe(400); });
test("REG-11 empty variable selection is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); const { response } = await regression(request, s.token, ids.acceptedA1, []); expect(response.status()).toBe(400); });
test("REG-12 partial numeric year is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await request.post("/api/energy-performance/regression/run", { headers: auth(s.token), data: { seuItemId: ids.acceptedA1, year: "2025abc", selectedVariables: [userCode(ids.production)] } }); expect(response.status()).toBe(400); });
test("REG-BOUNDARY-01 exact-display and adjacent R-squared values follow the strict boundary", async ({ request }) => { const s = await login(request, credentials.standardA1); const variableIds: number[] = []; try { for (const [label, target, expectedValid] of [["R2_EXACT_DISPLAY", 0.7499995, false], ["R2_ABOVE", 0.750001, true], ["R2_BELOW", 0.749999, false]] as const) { const variableId = await createCorrelationVariable(label, target); variableIds.push(variableId); const { body } = await regression(request, s.token, ids.acceptedA1, [userCode(variableId)]); expect(body.rSquared).toBeCloseTo(target, 5); expect(body.variables[0]?.isSignificant).toBe(true); expect(body.isValid).toBe(expectedValid); } } finally { await deleteTestVariables(variableIds); } });
test("REG-BOUNDARY-02 p-value exact display boundary remains strict", async ({ request }) => { const s = await login(request, credentials.standardA1); const variableIds: number[] = []; try { const exactT = 1.8124611228107335; const exactR2 = exactT ** 2 / (exactT ** 2 + 10); const belowPointOneT = 1.8126; const belowPointOneR2 = belowPointOneT ** 2 / (belowPointOneT ** 2 + 10); const exactId = await createCorrelationVariable("P_EXACT", exactR2); const belowId = await createCorrelationVariable("P_BELOW", belowPointOneR2); variableIds.push(exactId, belowId); const exact = (await regression(request, s.token, ids.acceptedA1, [userCode(exactId)])).body; const below = (await regression(request, s.token, ids.acceptedA1, [userCode(belowId)])).body; expect(exact.variables[0]?.pValue).toBe(0.1); expect(exact.variables[0]?.isSignificant).toBe(false); expect(below.variables[0]?.pValue).toBe(0.1); expect(below.variables[0]?.isSignificant).toBe(true); } finally { await deleteTestVariables(variableIds); } });

test("BASE-01 valid active baseline can be created", async ({ request }) => { const s = await login(request, credentials.standardA1); const { body } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.production)]); const response = await createBaseline(request, s.token, ids.acceptedA1, ids.production, "active", body); expect(response.status()).toBe(201); expect((await response.json() as { status: string; isValid: boolean }).status).toBe("active"); });
test("BASE-02 invalid model cannot be active", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await createBaseline(request, s.token, ids.acceptedA1, ids.invalidModel, "active", forgedRegression(ids.invalidModel, { isValid: false, rSquared: 0.1, adjustedRSquared: 0.01 })); expect(response.status()).toBe(422); });
test("BASE-03 client-forged valid metrics are rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await createBaseline(request, s.token, ids.acceptedA1, ids.invalidModel, "active", forgedRegression(ids.invalidModel)); expect(response.status()).toBe(422); });
test("BASE-04 draft accepted item cannot create baseline", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await createBaseline(request, s.token, ids.draftAcceptedA1, ids.production); expect([400, 403, 404, 422]).toContain(response.status()); });
test("BASE-05 rejected item cannot create baseline", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await createBaseline(request, s.token, ids.rejectedA1, ids.production); expect([400, 403, 404, 422]).toContain(response.status()); });
test("BASE-06 monitoring item cannot create baseline", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await createBaseline(request, s.token, ids.monitorA1, ids.production); expect([400, 403, 404, 422]).toContain(response.status()); });
test("BASE-07 second active baseline archives first", async ({ request }) => { const s = await login(request, credentials.standardA1); const first = await createBaseline(request, s.token, ids.acceptedA1, ids.production, "active"); const second = await createBaseline(request, s.token, ids.acceptedA1, ids.production, "active"); expect(first.status()).toBe(201); expect(second.status()).toBe(201); const rows = await pool.query<{ status: string }>("SELECT status FROM energy_baselines WHERE notes='[E2E] F3A6' ORDER BY id"); expect(rows.rows.map((r) => r.status)).toEqual(["archived", "active"]); });
test("BASE-08 baseline metrics are server-authoritative", async ({ request }) => { const s = await login(request, credentials.standardA1); const { body } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.production)]); const response = await createBaseline(request, s.token, ids.acceptedA1, ids.production, "draft", forgedRegression(ids.production, { sampleSize: 6 })); expect(response.status()).toBe(201); const created = await response.json() as { id: number; sampleSize: number }; expect(created.sampleSize).toBe(body.sampleSize); expect(created.sampleSize).not.toBe(6); const rows = await pool.query<{ coefficient: number; variable_code: string }>("SELECT coefficient, variable_code FROM energy_baseline_variables WHERE baseline_id=$1", [created.id]); expect(rows.rows).toHaveLength(1); expect(rows.rows[0]?.variable_code).toBe(userCode(ids.production)); expect(rows.rows[0]?.coefficient).toBeCloseTo(body.variables[0]!.coefficient, 5); expect(rows.rows[0]?.coefficient).not.toBe(2); });
test("BASE-09 cross-tenant item cannot create baseline", async ({ request }) => { const s = await login(request, credentials.adminA); const response = await createBaseline(request, s.token, ids.acceptedB1, ids.production); expect(response.status()).toBe(404); });
test("BASE-10 null-unit baseline mutation is forbidden", async ({ request }) => { const s = await login(request, credentials.nullUnit); const response = await createBaseline(request, s.token, ids.acceptedA1, ids.production); expect(response.status()).toBe(403); });
test("BASE-11 invalid status is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await request.post("/api/energy-performance/baselines", { headers: auth(s.token), data: { seuItemId: ids.acceptedA1, year: 2025, baselinePeriodStart: "2025-01-01", baselinePeriodEnd: "2025-12-31", regressionResult: forgedRegression(ids.production), status: "published" } }); expect(response.status()).toBe(400); });
test("BASE-12 baseline list is scoped to item", async ({ request }) => { const s = await login(request, credentials.standardA1); const made = await createBaseline(request, s.token, ids.acceptedA1, ids.production); expect(made.status()).toBe(201); const created = await made.json() as { id: number }; const rows = await (await request.get(`/api/energy-performance/baselines?seuItemId=${ids.acceptedA1}`, { headers: auth(s.token) })).json() as Array<{ id: number; variables: unknown[] }>; const listed = rows.find((row) => row.id === created.id); expect(listed).toBeDefined(); expect(listed?.variables).toHaveLength(1); });
test("BASE-13 eligibility failure preserves the existing active baseline", async ({ request }) => { const s = await login(request, credentials.standardA1); const made = await createBaseline(request, s.token, ids.acceptedA1, ids.production, "active"); expect(made.status()).toBe(201); const active = await made.json() as { id: number }; const rejected = await createBaseline(request, s.token, ids.rejectedA1, ids.production, "active"); expect(rejected.status()).toBe(422); const rows = await pool.query<{ id: number; status: string }>("SELECT id, status FROM energy_baselines WHERE notes='[E2E] F3A6' ORDER BY id"); expect(rows.rows).toEqual([{ id: active.id, status: "active" }]); });

test("PERF-01 unit-scope baseline calculates 12 monthly results", async ({ request }) => { const s = await login(request, credentials.standardA1); const { body: serverModel } = await regression(request, s.token, ids.acceptedA1, [userCode(ids.hours)]); const response = await createBaseline(request, s.token, ids.acceptedA1, ids.hours, "active", forgedRegression(ids.hours, { intercept: 100, variables: [{ variableName: "Hours", code: userCode(ids.hours), coefficient: 10, standardError: 1, tStat: 10, pValue: 0.01, isSignificant: true }] })); expect(response.status()).toBe(201); const baseline = await response.json() as { id: number }; const calculatedResponse = await request.post("/api/energy-performance/results/calculate", { headers: auth(s.token), data: { baselineId: baseline.id, year: 2025 } }); expect(calculatedResponse.status()).toBe(200); const calculated = await calculatedResponse.json() as { calculated: number; skipped: number; results: Array<{ month: number; actualConsumption: number; expectedConsumption: number; difference: number; eei: number; cusum: number }> }; const expected = serverModel.intercept + serverModel.variables[0]!.coefficient * 100; expect(calculated.calculated).toBe(12); expect(calculated.skipped).toBe(0); expect(calculated.results[0]?.actualConsumption).toBe(1000); expect(calculated.results[0]?.expectedConsumption).toBeCloseTo(expected, 4); expect(calculated.results[0]?.difference).toBeCloseTo(1000 - expected, 4); expect(calculated.results[0]?.eei).toBeCloseTo(1000 / expected, 6); });
test("PERF-02 company-scope variable calculates 12 monthly results", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await createBaseline(request, s.token, ids.acceptedA1, ids.production, "active"); expect(response.status()).toBe(201); const baseline = await response.json() as { id: number }; const calculated = await (await request.post("/api/energy-performance/results/calculate", { headers: auth(s.token), data: { baselineId: baseline.id, year: 2025 } })).json() as { calculated: number; skipped: number }; expect(calculated.calculated).toBe(12); expect(calculated.skipped).toBe(0); });
test("PERF-SCOPEVAR-01 unit value overrides company fallback", async ({ request }) => { const s = await login(request, credentials.standardA1); const made = await createBaseline(request, s.token, ids.acceptedA1, ids.production, "active"); expect(made.status()).toBe(201); const baseline = await made.json() as { id: number; intercept: number; variables: Array<{ coefficient: number }> }; try { await pool.query("INSERT INTO variable_values (company_id, variable_id, unit_id, period_start, period_end, value, source) VALUES ($1,$2,$3,'2025-01-01','2025-01-31',999,'[E2E] scope override')", [ids.companyA, ids.production, ids.unitA1]); const body = await (await request.post("/api/energy-performance/results/calculate", { headers: auth(s.token), data: { baselineId: baseline.id, year: 2025, months: [1] } })).json() as { calculated: number; skipped: number; results: Array<{ expectedConsumption: number }> }; expect(body).toMatchObject({ calculated: 1, skipped: 0 }); expect(body.results[0]?.expectedConsumption).toBeCloseTo(baseline.intercept + baseline.variables[0]!.coefficient * 999, 3); } finally { await pool.query("DELETE FROM variable_values WHERE variable_id=$1 AND source='[E2E] scope override'", [ids.production]); } });
test("PERF-SCOPEVAR-02 another unit value cannot override company fallback", async ({ request }) => { const s = await login(request, credentials.standardA1); const made = await createBaseline(request, s.token, ids.acceptedA1, ids.production, "active"); const baseline = await made.json() as { id: number; intercept: number; variables: Array<{ coefficient: number }> }; try { await pool.query("INSERT INTO variable_values (company_id, variable_id, unit_id, period_start, period_end, value, source) VALUES ($1,$2,$3,'2025-01-01','2025-01-31',999,'[E2E] foreign unit override')", [ids.companyA, ids.production, ids.unitA2]); const body = await (await request.post("/api/energy-performance/results/calculate", { headers: auth(s.token), data: { baselineId: baseline.id, year: 2025, months: [1] } })).json() as { results: Array<{ expectedConsumption: number }> }; expect(body.results[0]?.expectedConsumption).toBeCloseTo(baseline.intercept + baseline.variables[0]!.coefficient * 100, 4); } finally { await pool.query("DELETE FROM variable_values WHERE variable_id=$1 AND source='[E2E] foreign unit override'", [ids.production]); } });
test("PERF-SCOPEVAR-03 another tenant value cannot override company fallback", async ({ request }) => { const s = await login(request, credentials.standardA1); const made = await createBaseline(request, s.token, ids.acceptedA1, ids.production, "active"); const baseline = await made.json() as { id: number; intercept: number; variables: Array<{ coefficient: number }> }; try { await pool.query("INSERT INTO variable_values (company_id, variable_id, period_start, period_end, value, source) VALUES ($1,$2,'2025-01-01','2025-01-31',999,'[E2E] foreign tenant override')", [ids.companyB, ids.production]); const body = await (await request.post("/api/energy-performance/results/calculate", { headers: auth(s.token), data: { baselineId: baseline.id, year: 2025, months: [1] } })).json() as { results: Array<{ expectedConsumption: number }> }; expect(body.results[0]?.expectedConsumption).toBeCloseTo(baseline.intercept + baseline.variables[0]!.coefficient * 100, 4); } finally { await pool.query("DELETE FROM variable_values WHERE variable_id=$1 AND source='[E2E] foreign tenant override'", [ids.production]); } });
test("PERF-03 repeat calculate upserts rather than duplicates", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await createBaseline(request, s.token, ids.acceptedA1, ids.hours, "active"); const baseline = await response.json() as { id: number }; for (let i = 0; i < 2; i++) expect((await request.post("/api/energy-performance/results/calculate", { headers: auth(s.token), data: { baselineId: baseline.id, year: 2025 } })).status()).toBe(200); const count = await pool.query<{ count: string }>("SELECT count(*)::text count FROM energy_performance_results WHERE baseline_id=$1", [baseline.id]); expect(Number(count.rows[0]?.count)).toBe(12); });
test("PERF-04 requested months limit result generation", async ({ request }) => { const s = await login(request, credentials.standardA1); const response = await createBaseline(request, s.token, ids.acceptedA1, ids.hours, "active"); const baseline = await response.json() as { id: number }; const body = await (await request.post("/api/energy-performance/results/calculate", { headers: auth(s.token), data: { baselineId: baseline.id, year: 2025, months: [1, 2, 3] } })).json() as { calculated: number; results: Array<{ month: number }> }; expect(body.calculated).toBe(3); expect(body.results.map((r) => r.month)).toEqual([1, 2, 3]); });
test("PERF-05 standard cannot calculate another unit baseline", async ({ request }) => { const admin = await login(request, credentials.adminA); const made = await createBaseline(request, admin.token, ids.acceptedA2, ids.hours, "active"); expect(made.status()).toBe(201); const baseline = await made.json() as { id: number }; const standard = await login(request, credentials.standardA1); expect((await request.post("/api/energy-performance/results/calculate", { headers: auth(standard.token), data: { baselineId: baseline.id, year: 2025 } })).status()).toBe(404); });
test("PERF-06 null-unit calculate is forbidden", async ({ request }) => { const admin = await login(request, credentials.adminA); const made = await createBaseline(request, admin.token, ids.acceptedA1, ids.hours, "active"); const baseline = await made.json() as { id: number }; const standard = await login(request, credentials.nullUnit); expect((await request.post("/api/energy-performance/results/calculate", { headers: auth(standard.token), data: { baselineId: baseline.id, year: 2025 } })).status()).toBe(403); });
test("PERF-07 result list returns generated rows", async ({ request }) => { const s = await login(request, credentials.standardA1); const made = await createBaseline(request, s.token, ids.acceptedA1, ids.hours, "active"); const baseline = await made.json() as { id: number }; await request.post("/api/energy-performance/results/calculate", { headers: auth(s.token), data: { baselineId: baseline.id, year: 2025, months: [1, 2] } }); const rows = await (await request.get(`/api/energy-performance/results?baselineId=${baseline.id}&year=2025`, { headers: auth(s.token) })).json() as Array<{ month: number }>; expect(rows.map((r) => r.month)).toEqual([1, 2]); });
test("PERF-08 invalid baseline ID is rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.get("/api/energy-performance/results?baselineId=123abc&year=2025", { headers: auth(s.token) })).status()).toBe(400); });

test("UI-SEU-01 standard SEU page has no Tenant B marker", async ({ page }) => { await loginUi(page, credentials.standardA1); await page.goto("/oek"); await expect(page.getByText("[E2E] Unit B1", { exact: false })).toHaveCount(0); });
test("UI-SEU-02 admin SEU page opens", async ({ page }) => { await loginUi(page, credentials.adminA); await page.goto("/oek"); await expect(page.locator("body")).toContainText(/Önemli Enerji|ÖEK|SEU/); });
test("UI-SEU-03 kontrol_admin SEU page opens with admin parity", async ({ page }) => { await loginUi(page, credentials.kontrolAdminA); await page.goto("/oek"); await expect(page.locator("body")).toContainText(/Önemli Enerji|ÖEK|SEU/); });
test("UI-REG-01 official accepted SEU is selectable", async ({ page }) => { await loginUi(page, credentials.standardA1); await page.goto("/performans-gostergeleri"); await expect(page.getByText("[E2E] SEU Electricity A1", { exact: false }).first()).toBeVisible(); });
test("UI-REG-02 draft accepted SEU is not selectable", async ({ page }) => { await loginUi(page, credentials.standardA1); await page.goto("/performans-gostergeleri"); await expect(page.getByText("[E2E] Draft Accepted A1", { exact: false })).toHaveCount(0); });
