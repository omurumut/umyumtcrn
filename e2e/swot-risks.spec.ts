import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime value is required.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("SWOT/Risk E2E requires a disposable test database.");
  }
  const raw = requiredEnv("DATABASE_URL");
  const url = new URL(raw);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("SWOT/Risk E2E database is not the disposable localhost database.");
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
type Swot = { id: number; unitId: number | null; category: string; title: string; score: number; impact: string };
type Note = { id: number; riskId: number; userId: number | null; userName: string; content: string };
type Risk = { id: number; unitId: number | null; type: string; title: string; probability: number; severity: number; score: number; responseType: string; targetProbability: number | null; targetSeverity: number | null; targetScore: number | null; status: string; notes: Note[] };
type FixtureIds = { companyA: number; companyB: number; unitA1: number; unitA2: number; unitB1: number; swotA1: number; swotA2: number; swotB1: number; riskA1: number; riskA2: number; riskB1: number; actionRiskA1: number };

let ids: FixtureIds;
let counter = 0;
const marker = (name: string) => `[E2E] F3A5 ${name} ${Date.now()} ${++counter}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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
      (SELECT id FROM swot_items WHERE title='[E2E] Manual Readings') swot_a1,
      (SELECT id FROM swot_items WHERE description='A2 strength') swot_a2,
      (SELECT id FROM swot_items WHERE description='B1 strength') swot_b1,
      (SELECT id FROM risks WHERE title='[E2E] Medium Equipment Risk') risk_a1,
      (SELECT id FROM risks WHERE title='[E2E] Unit A2 Risk') risk_a2,
      (SELECT id FROM risks WHERE description='B1 risk') risk_b1,
      (SELECT id FROM risks WHERE title='[E2E] Action Risk') action_risk_a1
  `);
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => !Number.isSafeInteger(value))) throw new Error("F3A5 fixture IDs could not be resolved.");
  return { companyA: row.company_a, companyB: row.company_b, unitA1: row.unit_a1, unitA2: row.unit_a2, unitB1: row.unit_b1, swotA1: row.swot_a1, swotA2: row.swot_a2, swotB1: row.swot_b1, riskA1: row.risk_a1, riskA2: row.risk_a2, riskB1: row.risk_b1, actionRiskA1: row.action_risk_a1 };
}

function swotBody(overrides: Record<string, unknown> = {}) { return { category: "strengths", title: marker("SWOT"), description: "E2E", score: 3, impact: "orta", unitId: ids.unitA1, ...overrides }; }
function riskBody(overrides: Record<string, unknown> = {}) { return { type: "risk", title: marker("Risk"), description: "E2E", probability: 2, severity: 3, responseType: "izleme", status: "acik", unitId: ids.unitA1, ...overrides }; }

async function createSwot(request: APIRequestContext, token: string, overrides: Record<string, unknown> = {}): Promise<{ response: APIResponse; row: Swot | null; title: string }> {
  const body = swotBody(overrides); const response = await request.post("/api/swot", { headers: auth(token), data: body });
  return { response, row: response.status() === 201 ? await response.json() as Swot : null, title: String(body.title) };
}
async function createRisk(request: APIRequestContext, token: string, overrides: Record<string, unknown> = {}): Promise<{ response: APIResponse; row: Risk | null; title: string }> {
  const body = riskBody(overrides); const response = await request.post("/api/risks", { headers: auth(token), data: body });
  return { response, row: response.status() === 201 ? await response.json() as Risk : null, title: String(body.title) };
}
async function cleanupTitle(table: "swot_items" | "risks", title: string): Promise<void> {
  if (table === "risks") await pool.query("DELETE FROM risk_notes WHERE risk_id IN (SELECT id FROM risks WHERE title=$1)", [title]);
  await pool.query(`DELETE FROM ${table} WHERE title=$1`, [title]);
}

test.beforeAll(async () => { ids = await resolveFixtureIds(); });
test.afterAll(async () => { await pool.end(); });

test("SWOT-01 standard A1 only sees its unit", async ({ request }) => {
  const s = await login(request, credentials.standardA1); const rows = await (await request.get("/api/swot", { headers: auth(s.token) })).json() as Swot[];
  expect(rows.length).toBe(4); expect(rows.every((r) => r.unitId === ids.unitA1)).toBe(true); expect(rows.some((r) => r.id === ids.swotB1)).toBe(false);
});
test("SWOT-02 standard A2 only sees A2", async ({ request }) => {
  const s = await login(request, credentials.standardA2); const rows = await (await request.get("/api/swot", { headers: auth(s.token) })).json() as Swot[];
  expect(rows.map((r) => r.id)).toEqual([ids.swotA2]);
});
test("SWOT-03 null-unit standard gets empty list", async ({ request }) => {
  const s = await login(request, credentials.nullUnit); expect(await (await request.get("/api/swot", { headers: auth(s.token) })).json()).toEqual([]);
});
test("SWOT-04 admin sees Tenant A only", async ({ request }) => {
  const s = await login(request, credentials.adminA); const rows = await (await request.get("/api/swot", { headers: auth(s.token) })).json() as Swot[];
  expect(rows).toHaveLength(5); expect(rows.some((r) => r.id === ids.swotB1)).toBe(false);
});
test("SWOT-05 kontrol_admin matches admin scope", async ({ request }) => {
  const a = await login(request, credentials.adminA); const k = await login(request, credentials.kontrolAdminA);
  const ar = await (await request.get("/api/swot", { headers: auth(a.token) })).json() as Swot[]; const kr = await (await request.get("/api/swot", { headers: auth(k.token) })).json() as Swot[];
  expect(kr.map((r) => r.id)).toEqual(ar.map((r) => r.id));
});
test("SWOT-06 admin companyId query cannot change tenant", async ({ request }) => {
  const s = await login(request, credentials.adminA); const rows = await (await request.get(`/api/swot?companyId=${ids.companyB}`, { headers: auth(s.token) })).json() as Swot[];
  expect(rows.some((r) => r.id === ids.swotB1)).toBe(false); expect(rows.some((r) => r.id === ids.swotA1)).toBe(true);
});
test("SWOT-07 admin can filter own unit", async ({ request }) => {
  const s = await login(request, credentials.adminA); const rows = await (await request.get(`/api/swot?unitId=${ids.unitA2}`, { headers: auth(s.token) })).json() as Swot[];
  expect(rows.map((r) => r.id)).toEqual([ids.swotA2]);
});
test("SWOT-08 admin rejects foreign unit filter", async ({ request }) => {
  const s = await login(request, credentials.adminA); expect((await request.get(`/api/swot?unitId=${ids.unitB1}`, { headers: auth(s.token) })).status()).toBe(403);
});
test("SWOT-09 superadmin company filters separate tenants", async ({ request }) => {
  const s = await login(request, credentials.superadmin); const a = await (await request.get(`/api/swot?companyId=${ids.companyA}`, { headers: auth(s.token) })).json() as Swot[]; const b = await (await request.get(`/api/swot?companyId=${ids.companyB}`, { headers: auth(s.token) })).json() as Swot[];
  expect(a).toHaveLength(5); expect(b.map((r) => r.id)).toEqual([ids.swotB1]);
});
test("SWOT-10 superadmin rejects company/unit mismatch", async ({ request }) => {
  const s = await login(request, credentials.superadmin); expect((await request.get(`/api/swot?companyId=${ids.companyA}&unitId=${ids.unitB1}`, { headers: auth(s.token) })).status()).toBe(403);
});

for (const [label, query] of [["company suffix", "companyId=123abc"], ["company zero", "companyId=0"], ["unit decimal", "unitId=1.5"], ["unit negative", "unitId=-1"], ["unit empty", "unitId="]] as const) {
  test(`SWOT-ID ${label} is rejected`, async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.get(`/api/swot?${query}`, { headers: auth(s.token) })).status()).toBe(400); });
}

test("SWOT-11 standard create is fixed to session unit", async ({ request }) => {
  const s = await login(request, credentials.standardA1); const made = await createSwot(request, s.token, { unitId: ids.unitA2 });
  try { expect(made.response.status()).toBe(201); expect(made.row?.unitId).toBe(ids.unitA1); } finally { await cleanupTitle("swot_items", made.title); }
});
test("SWOT-12 admin creates in own second unit", async ({ request }) => {
  const s = await login(request, credentials.adminA); const made = await createSwot(request, s.token, { unitId: ids.unitA2 });
  try { expect(made.response.status()).toBe(201); expect(made.row?.unitId).toBe(ids.unitA2); } finally { await cleanupTitle("swot_items", made.title); }
});
test("SWOT-13 admin cannot create in foreign unit", async ({ request }) => {
  const s = await login(request, credentials.adminA); const made = await createSwot(request, s.token, { unitId: ids.unitB1 });
  try { expect([400,403,404]).toContain(made.response.status()); } finally { await cleanupTitle("swot_items", made.title); }
});
test("SWOT-14 superadmin can target company B with matching unit", async ({ request }) => {
  const s = await login(request, credentials.superadmin); const made = await createSwot(request, s.token, { companyId: ids.companyB, unitId: ids.unitB1 });
  try { expect(made.response.status()).toBe(201); const db = await pool.query<{ company_id: number }>("SELECT company_id FROM swot_items WHERE title=$1", [made.title]); expect(db.rows[0]?.company_id).toBe(ids.companyB); } finally { await cleanupTitle("swot_items", made.title); }
});
test("SWOT-14B superadmin company/unit mismatch is rejected without insert", async ({ request }) => { const s = await login(request, credentials.superadmin); const made = await createSwot(request, s.token, { companyId: ids.companyA, unitId: ids.unitB1 }); try { expect([400, 403]).toContain(made.response.status()); const db = await pool.query("SELECT id FROM swot_items WHERE title=$1", [made.title]); expect(db.rowCount).toBe(0); } finally { await cleanupTitle("swot_items", made.title); } });
test("SWOT-14C superadmin create without company context fails closed", async ({ request }) => { const s = await login(request, credentials.superadmin); const made = await createSwot(request, s.token, { unitId: ids.unitA1 }); try { expect(made.response.status()).toBe(400); const db = await pool.query("SELECT id FROM swot_items WHERE title=$1", [made.title]); expect(db.rowCount).toBe(0); } finally { await cleanupTitle("swot_items", made.title); } });
test("SWOT-14D admin body companyId cannot change tenant", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createSwot(request, s.token, { companyId: ids.companyB, unitId: ids.unitA1 }); try { expect(made.response.status()).toBe(201); const db = await pool.query<{ company_id: number }>("SELECT company_id FROM swot_items WHERE title=$1", [made.title]); expect(db.rows[0]?.company_id).toBe(ids.companyA); } finally { await cleanupTitle("swot_items", made.title); } });
test("SWOT-14E superadmin cannot move Tenant B record to Tenant A unit", async ({ request }) => { const s = await login(request, credentials.superadmin); const made = await createSwot(request, s.token, { companyId: ids.companyB, unitId: ids.unitB1 }); try { expect(made.response.status()).toBe(201); expect((await request.patch(`/api/swot/${made.row!.id}`, { headers: auth(s.token), data: { unitId: ids.unitA1 } })).status()).toBe(403); } finally { await cleanupTitle("swot_items", made.title); } });
test("SWOT-15 standard updates own item but not A2", async ({ request }) => {
  const s = await login(request, credentials.standardA1); const own = await createSwot(request, s.token); try { expect((await request.patch(`/api/swot/${own.row!.id}`, { headers: auth(s.token), data: { description: "updated" } })).status()).toBe(200); expect((await request.patch(`/api/swot/${ids.swotA2}`, { headers: auth(s.token), data: { title: "blocked" } })).status()).toBe(403); } finally { await cleanupTitle("swot_items", own.title); }
});
test("SWOT-16 admin moves own-company item between units", async ({ request }) => {
  const s = await login(request, credentials.adminA); const made = await createSwot(request, s.token); try { const r = await request.patch(`/api/swot/${made.row!.id}`, { headers: auth(s.token), data: { unitId: ids.unitA2 } }); expect(r.status()).toBe(200); expect((await r.json() as Swot).unitId).toBe(ids.unitA2); } finally { await cleanupTitle("swot_items", made.title); }
});
test("SWOT-17 foreign item update/delete are hidden", async ({ request }) => {
  const s = await login(request, credentials.adminA); expect((await request.patch(`/api/swot/${ids.swotB1}`, { headers: auth(s.token), data: { title: "blocked" } })).status()).toBe(404); expect((await request.delete(`/api/swot/${ids.swotB1}`, { headers: auth(s.token) })).status()).toBe(404);
});
test("SWOT-18 independent item deletes physically", async ({ request }) => {
  const s = await login(request, credentials.adminA); const made = await createSwot(request, s.token); expect((await request.delete(`/api/swot/${made.row!.id}`, { headers: auth(s.token) })).status()).toBe(204); const db = await pool.query("SELECT id FROM swot_items WHERE id=$1", [made.row!.id]); expect(db.rowCount).toBe(0);
});
test("SWOT-19 duplicate title is currently allowed in the same scope", async ({ request }) => { const s = await login(request, credentials.adminA); const title = marker("duplicate SWOT"); const first = await createSwot(request, s.token, { title }); const second = await createSwot(request, s.token, { title }); try { expect(first.response.status()).toBe(201); expect(second.response.status()).toBe(201); const db = await pool.query("SELECT id FROM swot_items WHERE title=$1", [title]); expect(db.rowCount).toBe(2); } finally { await cleanupTitle("swot_items", title); } });

for (const [label, patchBody] of [
  ["blank title", { title: "   " }], ["unknown category", { category: "unknown" }], ["decimal score", { score: "1.5" }], ["suffix score", { score: "2abc" }], ["zero score", { score: "0" }], ["negative score", { score: "-1" }], ["score above five", { score: "6" }], ["unknown impact", { impact: "critical" }], ["blank impact", { impact: "" }], ["long title", { title: "X".repeat(1001) }],
] as const) {
  test(`SWOT-VALIDATION ${label}`, async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createSwot(request, s.token, patchBody); try { expect(made.response.status()).toBe(400); } finally { await cleanupTitle("swot_items", made.title); } });
}
test("SWOT-VALIDATION invalid PATCH preserves old record", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createSwot(request, s.token); try { const response = await request.patch(`/api/swot/${made.row!.id}`, { headers: auth(s.token), data: { title: "should not persist", score: "2abc" } }); expect(response.status()).toBe(400); const db = await pool.query<{ title: string; score: number }>("SELECT title, score FROM swot_items WHERE id=$1", [made.row!.id]); expect(db.rows[0]).toMatchObject({ title: made.title, score: 3 }); } finally { await cleanupTitle("swot_items", made.title); } });
test("SWOT-VALIDATION numeric string score is accepted and title is trimmed", async ({ request }) => { const s = await login(request, credentials.adminA); const title = marker("trimmed SWOT"); const made = await createSwot(request, s.token, { title: `  ${title}  `, score: " 5 " }); try { expect(made.response.status()).toBe(201); expect(made.row?.title).toBe(title); expect(made.row?.score).toBe(5); } finally { await cleanupTitle("swot_items", title); } });
test("SWOT-ID invalid path is rejected", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.patch("/api/swot/123abc", { headers: auth(s.token), data: { title: "x" } })).status()).toBe(400); });

test("RISK-01 standard A1 sees only A1 risks and notes", async ({ request }) => {
  const s = await login(request, credentials.standardA1); const rows = await (await request.get("/api/risks", { headers: auth(s.token) })).json() as Risk[];
  expect(rows).toHaveLength(5); expect(rows.every((r) => r.unitId === ids.unitA1)).toBe(true); expect(rows.some((r) => r.id === ids.riskB1)).toBe(false); expect(rows.flatMap((r) => r.notes).some((n) => n.content.includes("B1"))).toBe(false);
});
test("RISK-02 standard A2 sees only A2", async ({ request }) => { const s = await login(request, credentials.standardA2); const rows = await (await request.get("/api/risks", { headers: auth(s.token) })).json() as Risk[]; expect(rows.map((r) => r.id)).toEqual([ids.riskA2]); });
test("RISK-03 null-unit standard gets empty list", async ({ request }) => { const s = await login(request, credentials.nullUnit); expect(await (await request.get("/api/risks", { headers: auth(s.token) })).json()).toEqual([]); });
test("RISK-04 admin sees Tenant A", async ({ request }) => { const s = await login(request, credentials.adminA); const rows = await (await request.get("/api/risks", { headers: auth(s.token) })).json() as Risk[]; expect(rows).toHaveLength(6); expect(rows.some((r) => r.id === ids.riskB1)).toBe(false); });
test("RISK-05 kontrol_admin matches admin", async ({ request }) => { const a = await login(request, credentials.adminA); const k = await login(request, credentials.kontrolAdminA); const ar = await (await request.get("/api/risks", { headers: auth(a.token) })).json() as Risk[]; const kr = await (await request.get("/api/risks", { headers: auth(k.token) })).json() as Risk[]; expect(kr.map((r) => r.id)).toEqual(ar.map((r) => r.id)); });
test("RISK-06 company query cannot move admin", async ({ request }) => { const s = await login(request, credentials.adminA); const rows = await (await request.get(`/api/risks?companyId=${ids.companyB}`, { headers: auth(s.token) })).json() as Risk[]; expect(rows.some((r) => r.id === ids.riskB1)).toBe(false); });
test("RISK-07 admin filters own unit", async ({ request }) => { const s = await login(request, credentials.adminA); const rows = await (await request.get(`/api/risks?unitId=${ids.unitA2}`, { headers: auth(s.token) })).json() as Risk[]; expect(rows.map((r) => r.id)).toEqual([ids.riskA2]); });
test("RISK-08 admin rejects foreign unit", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.get(`/api/risks?unitId=${ids.unitB1}`, { headers: auth(s.token) })).status()).toBe(403); });
test("RISK-09 superadmin filters Tenant B", async ({ request }) => { const s = await login(request, credentials.superadmin); const rows = await (await request.get(`/api/risks?companyId=${ids.companyB}`, { headers: auth(s.token) })).json() as Risk[]; expect(rows.map((r) => r.id)).toEqual([ids.riskB1]); });
test("RISK-10 superadmin rejects mismatched company/unit", async ({ request }) => { const s = await login(request, credentials.superadmin); expect((await request.get(`/api/risks?companyId=${ids.companyA}&unitId=${ids.unitB1}`, { headers: auth(s.token) })).status()).toBe(403); });

test("RISK-11 creates risk with server score", async ({ request }) => { const s = await login(request, credentials.standardA1); const made = await createRisk(request, s.token, { probability: 4, severity: 5, score: 1 }); try { expect(made.response.status()).toBe(201); expect(made.row?.score).toBe(20); expect(made.row?.unitId).toBe(ids.unitA1); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-12 creates opportunity", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { type: "firsat", probability: 5, severity: 5 }); try { expect(made.response.status()).toBe(201); expect(made.row?.type).toBe("firsat"); expect(made.row?.score).toBe(25); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-13 action requires mitigation plan", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { responseType: "aksiyon", mitigationPlan: "" }); try { expect(made.response.status()).toBe(400); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-14 target score is server calculated", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { responseType: "aksiyon", mitigationPlan: "plan", targetProbability: 2, targetSeverity: 3, targetScore: 99 }); try { expect(made.row?.targetScore).toBe(6); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-14A superadmin can target company B with matching unit", async ({ request }) => { const s = await login(request, credentials.superadmin); const made = await createRisk(request, s.token, { companyId: ids.companyB, unitId: ids.unitB1 }); try { expect(made.response.status()).toBe(201); const db = await pool.query<{ company_id: number }>("SELECT company_id FROM risks WHERE title=$1", [made.title]); expect(db.rows[0]?.company_id).toBe(ids.companyB); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-14B superadmin company/unit mismatch is rejected without insert", async ({ request }) => { const s = await login(request, credentials.superadmin); const made = await createRisk(request, s.token, { companyId: ids.companyA, unitId: ids.unitB1 }); try { expect([400, 403]).toContain(made.response.status()); const db = await pool.query("SELECT id FROM risks WHERE title=$1", [made.title]); expect(db.rowCount).toBe(0); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-14C superadmin create without company context fails closed", async ({ request }) => { const s = await login(request, credentials.superadmin); const made = await createRisk(request, s.token, { unitId: ids.unitA1 }); try { expect(made.response.status()).toBe(400); const db = await pool.query("SELECT id FROM risks WHERE title=$1", [made.title]); expect(db.rowCount).toBe(0); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-14D admin body companyId cannot change tenant", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { companyId: ids.companyB, unitId: ids.unitA1 }); try { expect(made.response.status()).toBe(201); const db = await pool.query<{ company_id: number }>("SELECT company_id FROM risks WHERE title=$1", [made.title]); expect(db.rows[0]?.company_id).toBe(ids.companyA); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-14E superadmin cannot move Tenant B record to Tenant A unit", async ({ request }) => { const s = await login(request, credentials.superadmin); const made = await createRisk(request, s.token, { companyId: ids.companyB, unitId: ids.unitB1 }); try { expect(made.response.status()).toBe(201); expect((await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { unitId: ids.unitA1 } })).status()).toBe(403); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-15 update both score inputs recalculates", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token); try { const r = await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { probability: 4, severity: 4 } }); expect((await r.json() as Risk).score).toBe(16); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-16 update probability alone recalculates score", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { probability: 2, severity: 3 }); try { const r = await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { probability: 5 } }); const row = await r.json() as Risk; expect(row.score).toBe(15); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-17 update target probability alone recalculates target score", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { responseType: "aksiyon", mitigationPlan: "plan", targetProbability: 2, targetSeverity: 3 }); try { const r = await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { targetProbability: 4 } }); expect((await r.json() as Risk).targetScore).toBe(12); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-17A update severity alone recalculates score", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { probability: 3, severity: 2 }); try { const r = await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { severity: 5 } }); expect((await r.json() as Risk).score).toBe(15); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-17B update target severity alone recalculates target score", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { responseType: "aksiyon", mitigationPlan: "plan", targetProbability: 3, targetSeverity: 2 }); try { const r = await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { targetSeverity: 5 } }); expect((await r.json() as Risk).targetScore).toBe(15); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-17C invalid PATCH probability preserves old record", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { probability: 2, severity: 3 }); try { const r = await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { title: "should not persist", probability: "2abc" } }); expect(r.status()).toBe(400); const db = await pool.query<{ title: string; probability: number; severity: number; score: number }>("SELECT title, probability, severity, score FROM risks WHERE id=$1", [made.row!.id]); expect(db.rows[0]).toMatchObject({ title: made.title, probability: 2, severity: 3, score: 6 }); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-17D PATCH client score fields are ignored", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { probability: 2, severity: 3, responseType: "aksiyon", mitigationPlan: "plan", targetProbability: 2, targetSeverity: 3 }); try { const r = await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { score: 25, targetScore: 25 } }); const row = await r.json() as Risk; expect(row.score).toBe(6); expect(row.targetScore).toBe(6); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-17E numeric strings are accepted and title is trimmed", async ({ request }) => { const s = await login(request, credentials.adminA); const title = marker("trimmed risk"); const made = await createRisk(request, s.token, { title: `  ${title}  `, probability: "1", severity: " 5 " }); try { expect(made.response.status()).toBe(201); expect(made.row?.title).toBe(title); expect(made.row?.score).toBe(5); } finally { await cleanupTitle("risks", title); } });
test("RISK-17F nullable target component clears target score", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { responseType: "aksiyon", mitigationPlan: "plan", targetProbability: 2, targetSeverity: 3 }); try { const r = await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { targetProbability: null } }); const row = await r.json() as Risk; expect(row.targetProbability).toBeNull(); expect(row.targetScore).toBeNull(); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-17G invalid PATCH enum preserves old record", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, { status: "acik" }); try { const r = await request.patch(`/api/risks/${made.row!.id}`, { headers: auth(s.token), data: { title: "should not persist", status: "unknown" } }); expect(r.status()).toBe(400); const db = await pool.query<{ title: string; status: string }>("SELECT title, status FROM risks WHERE id=$1", [made.row!.id]); expect(db.rows[0]).toMatchObject({ title: made.title, status: "acik" }); } finally { await cleanupTitle("risks", made.title); } });
test("RISK-18 standard cannot update A2", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.patch(`/api/risks/${ids.riskA2}`, { headers: auth(s.token), data: { title: "blocked" } })).status()).toBe(403); });
test("RISK-19 admin cannot update/delete Tenant B", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.patch(`/api/risks/${ids.riskB1}`, { headers: auth(s.token), data: { title: "blocked" } })).status()).toBe(404); expect((await request.delete(`/api/risks/${ids.riskB1}`, { headers: auth(s.token) })).status()).toBe(404); });
test("RISK-20 deleting risk cascades only its notes", async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token); await request.post(`/api/risks/${made.row!.id}/notes`, { headers: auth(s.token), data: { content: "temporary note" } }); expect((await request.delete(`/api/risks/${made.row!.id}`, { headers: auth(s.token) })).status()).toBe(204); const notes = await pool.query("SELECT id FROM risk_notes WHERE risk_id=$1", [made.row!.id]); expect(notes.rowCount).toBe(0); const fixture = await pool.query("SELECT id FROM risk_notes WHERE risk_id=$1", [ids.riskA1]); expect(fixture.rowCount).toBe(1); });
test("RISK-21 duplicate title is currently allowed in the same scope", async ({ request }) => { const s = await login(request, credentials.adminA); const title = marker("duplicate risk"); const first = await createRisk(request, s.token, { title }); const second = await createRisk(request, s.token, { title }); try { expect(first.response.status()).toBe(201); expect(second.response.status()).toBe(201); const db = await pool.query("SELECT id FROM risks WHERE title=$1", [title]); expect(db.rowCount).toBe(2); } finally { await cleanupTitle("risks", title); } });

for (const [label, body] of [
  ["blank title", { title: "   " }], ["unknown type", { type: "other" }], ["probability zero", { probability: "0" }], ["probability negative", { probability: "-1" }], ["probability decimal", { probability: "2.5" }], ["probability suffix", { probability: "2abc" }], ["severity zero", { severity: "0" }], ["severity negative", { severity: "-1" }], ["severity decimal", { severity: "2.5" }], ["severity suffix", { severity: "2abc" }], ["severity above five", { severity: "6" }], ["unknown response", { responseType: "other" }], ["unknown status", { status: "other" }], ["long title", { title: "X".repeat(1001) }],
] as const) {
  test(`RISK-VALIDATION ${label}`, async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, body); try { expect(made.response.status()).toBe(400); } finally { await cleanupTitle("risks", made.title); } });
}
for (const [label, body] of [["target zero", { targetProbability: "0" }], ["target above five", { targetSeverity: "6" }], ["target decimal", { targetProbability: "1.5" }], ["target suffix", { targetSeverity: "2abc" }]] as const) {
  test(`RISK-TARGET-VALIDATION ${label}`, async ({ request }) => { const s = await login(request, credentials.adminA); const made = await createRisk(request, s.token, body); try { expect(made.response.status()).toBe(400); } finally { await cleanupTitle("risks", made.title); } });
}
for (const [label, path] of [["risk suffix", "/api/risks/123abc"], ["risk zero", "/api/risks/0"], ["risk decimal", "/api/risks/1.5"]] as const) {
  test(`RISK-ID ${label}`, async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.patch(path, { headers: auth(s.token), data: { title: "x" } })).status()).toBe(400); });
}
test("RISK-ID invalid query is rejected", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.get("/api/risks?companyId=123abc", { headers: auth(s.token) })).status()).toBe(400); });

test("NOTE-01 standard adds note to own risk", async ({ request }) => { const s = await login(request, credentials.standardA1); const made = await createRisk(request, s.token); try { const r = await request.post(`/api/risks/${made.row!.id}/notes`, { headers: auth(s.token), data: { content: "  own progress  " } }); expect(r.status()).toBe(201); const note = await r.json() as Note; expect(note.content).toBe("own progress"); expect(note.userId).toBe(s.user.id); } finally { await cleanupTitle("risks", made.title); } });
test("NOTE-02 standard cannot note A2 risk", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.post(`/api/risks/${ids.riskA2}/notes`, { headers: auth(s.token), data: { content: "blocked" } })).status()).toBe(403); });
test("NOTE-03 admin cannot note Tenant B risk", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.post(`/api/risks/${ids.riskB1}/notes`, { headers: auth(s.token), data: { content: "blocked" } })).status()).toBe(404); });
test("NOTE-04 blank note rejected", async ({ request }) => { const s = await login(request, credentials.standardA1); expect((await request.post(`/api/risks/${ids.riskA1}/notes`, { headers: auth(s.token), data: { content: "   " } })).status()).toBe(400); });
test("NOTE-05 standard cannot edit or delete note", async ({ request }) => { const s = await login(request, credentials.standardA1); const list = await (await request.get("/api/risks", { headers: auth(s.token) })).json() as Risk[]; const note = list.find((r) => r.id === ids.riskA1)!.notes[0]!; expect((await request.patch(`/api/risks/${ids.riskA1}/notes/${note.id}`, { headers: auth(s.token), data: { content: "blocked" } })).status()).toBe(403); expect((await request.delete(`/api/risks/${ids.riskA1}/notes/${note.id}`, { headers: auth(s.token) })).status()).toBe(403); });
test("NOTE-06 kontrol_admin edits own-tenant note", async ({ request }) => { const s = await login(request, credentials.kontrolAdminA); const made = await createRisk(request, s.token); try { const created = await request.post(`/api/risks/${made.row!.id}/notes`, { headers: auth(s.token), data: { content: "before" } }); const note = await created.json() as Note; const updated = await request.patch(`/api/risks/${made.row!.id}/notes/${note.id}`, { headers: auth(s.token), data: { content: "after" } }); expect(updated.status()).toBe(200); expect((await updated.json() as Note).content).toBe("after"); } finally { await cleanupTitle("risks", made.title); } });
test("NOTE-07 parent-child mismatch is hidden", async ({ request }) => { const s = await login(request, credentials.adminA); const list = await (await request.get("/api/risks", { headers: auth(s.token) })).json() as Risk[]; const note = list.find((r) => r.id === ids.riskA1)!.notes[0]!; expect((await request.patch(`/api/risks/${ids.actionRiskA1}/notes/${note.id}`, { headers: auth(s.token), data: { content: "blocked" } })).status()).toBe(404); });
test("NOTE-08 invalid note ID is rejected", async ({ request }) => { const s = await login(request, credentials.adminA); expect((await request.patch(`/api/risks/${ids.riskA1}/notes/123abc`, { headers: auth(s.token), data: { content: "x" } })).status()).toBe(400); });

test("UI-SWOT-01 standard page shows A1 and hides A2/B", async ({ page }) => { await loginUi(page, credentials.standardA1); await page.goto("/swot"); await expect(page.getByText("[E2E] Manual Readings", { exact: true })).toBeVisible(); await expect(page.getByText("A2 strength", { exact: true })).toHaveCount(0); await expect(page.getByText("B1 strength", { exact: true })).toHaveCount(0); });
test("UI-SWOT-02 four quadrant headings render", async ({ page }) => { await loginUi(page, credentials.adminA); await page.goto("/swot"); for (const heading of ["Güçlü Yönler", "Zayıf Yönler", "Fırsatlar", "Tehditler"]) await expect(page.getByText(heading, { exact: true })).toBeVisible(); });
test("UI-SWOT-03 kontrol_admin create action is visible", async ({ page }) => { await loginUi(page, credentials.kontrolAdminA); await page.goto("/swot"); await expect(page.getByRole("button", { name: /Ekle/ }).first()).toBeVisible(); });
test("UI-RISK-01 standard sees own risk and no Tenant B note", async ({ page }) => { await loginUi(page, credentials.standardA1); await page.goto("/riskler"); await expect(page.getByText("[E2E] Medium Equipment Risk", { exact: true })).toBeVisible(); await expect(page.getByText("[E2E] B1 progress note", { exact: true })).toHaveCount(0); });
test("UI-RISK-02 risk and opportunity matrices render", async ({ page }) => { await loginUi(page, credentials.adminA); await page.goto("/riskler"); await expect(page.getByText("Risk Değerlendirme Matrisi", { exact: true })).toBeVisible(); await expect(page.getByText("Fırsat Değerlendirme Matrisi", { exact: true })).toBeVisible(); });
test("UI-RISK-03 kontrol_admin create actions are visible", async ({ page }) => { await loginUi(page, credentials.kontrolAdminA); await page.goto("/riskler"); await expect(page.getByRole("button", { name: "Risk Ekle" })).toBeVisible(); await expect(page.getByRole("button", { name: "Fırsat Ekle" })).toBeVisible(); });
test("UI-RISK-04 kontrol_admin can edit and delete an own-company note", async ({ page }) => { await loginUi(page, credentials.kontrolAdminA); await page.goto("/riskler"); const title = page.getByText("[E2E] Medium Equipment Risk", { exact: true }); const cardBody = title.locator("xpath=ancestor::div[contains(@class,'p-4')][1]"); await cardBody.getByRole("button").first().click(); const note = page.getByText("[E2E] A1 progress note", { exact: true }); await expect(note).toBeVisible(); const noteRow = note.locator("xpath=ancestor::div[contains(@class,'space-y-1')][1]"); await expect(noteRow.getByRole("button")).toHaveCount(2); });
