import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Targets/actions/VAP E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const raw = requiredEnv("DATABASE_URL");
  const url = new URL(raw);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Targets/actions/VAP E2E bağlantısı disposable localhost DB ile eşleşmiyor.");
  }
  return raw;
}

type QueryResult<Row> = { rows: Row[]; rowCount: number | null };
type TestPool = { query<Row>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>; end(): Promise<void> };
const scriptsRequire = createRequire(resolve(process.cwd(), "scripts/package.json"));
const { Pool } = scriptsRequire("pg") as { Pool: new (options: { connectionString: string }) => TestPool };
const pool = new Pool({ connectionString: disposableDatabaseUrl() });

const credentials = {
  standardA1: requiredEnv("E2E_STANDARD_USERNAME"), standardA2: "e2e_user_a2",
  standardB1: requiredEnv("E2E_STANDARD_B_USERNAME"), adminA: requiredEnv("E2E_ADMIN_USERNAME"),
  kontrolAdminA: requiredEnv("E2E_KONTROL_ADMIN_USERNAME"), nullUnit: requiredEnv("E2E_NULL_UNIT_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"), password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type Login = { token: string; user: { companyId: number; unitId: number | null; role: string } };
type Ids = {
  companyA: number; companyB: number; unitA1: number; unitA2: number; unitB1: number;
  subA1: number; subA2: number; subB1: number; sourceA1: number; sourceA2: number; sourceB1: number;
  officialA1: number; draftA1: number; officialA2: number; officialB1: number;
  acceptedA1: number; acceptedA2: number; rejectedA1: number; monitorA1: number; acceptedB1: number;
  baselineA1: number; baselineA2: number; baselineB1: number;
  targetA1: number; targetA1Gas: number; targetA1Delete: number; targetA2: number; targetB1: number;
  actionA1: number; overdueA1: number; completedA1: number; deleteActionA1: number; actionA2: number; actionB1: number;
  vapA1: number; vapA2: number; vapB1: number; userB1: number;
};
type Target = { id: number; companyId: number; unitId: number | null; name: string; status: string; targetReductionPercent: number; actualValue: number | null; seuAssessmentId: number | null; seuAssessmentItemId: number | null; baselineId: number | null };
type Action = { id: number; companyId: number; targetId: number; title: string; progressPercent: number; status: string; isVap: boolean; targetUnitId: number | null };
type Vap = { id: number; companyId: number; actionPlanId: number; projectTitle: string; investmentCost: number | null; annualCostSaving: number | null; paybackMonths: number | null; status: string; targetUnitId: number | null };

let ids: Ids;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(request: APIRequestContext, username: string): Promise<Login> {
  const response = await request.post("/api/auth/login", { data: { username, password: credentials.password } });
  expect(response.status()).toBe(200);
  return response.json() as Promise<Login>;
}

async function resolveIds(): Promise<Ids> {
  const result = await pool.query<Record<string, number>>(`
    SELECT
      (SELECT id FROM companies WHERE subdomain='e2e-tenant-a') company_a,
      (SELECT id FROM companies WHERE subdomain='e2e-tenant-b') company_b,
      (SELECT id FROM units WHERE name='[E2E] Unit A1') unit_a1,
      (SELECT id FROM units WHERE name='[E2E] Unit A2') unit_a2,
      (SELECT id FROM units WHERE name='[E2E] Unit B1') unit_b1,
      (SELECT id FROM sub_units WHERE name='[E2E] Campus A1' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a')) sub_a1,
      (SELECT id FROM sub_units WHERE name='[E2E] Campus A2' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a')) sub_a2,
      (SELECT id FROM sub_units WHERE name='[E2E] Campus A1' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b')) sub_b1,
      (SELECT id FROM energy_sources WHERE name='[E2E] Electricity A1' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a')) source_a1,
      (SELECT id FROM energy_sources WHERE name='[E2E] Electricity A2') source_a2,
      (SELECT id FROM energy_sources WHERE name='[E2E] Electricity A1' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b')) source_b1,
      (SELECT id FROM seu_assessments WHERE company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a') AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND is_official=true) official_a1,
      (SELECT id FROM seu_assessments WHERE company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a') AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND is_official=false) draft_a1,
      (SELECT id FROM seu_assessments WHERE unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A2')) official_a2,
      (SELECT id FROM seu_assessments WHERE unit_id=(SELECT id FROM units WHERE name='[E2E] Unit B1')) official_b1,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] SEU Electricity A1' AND assessment_id=(SELECT id FROM seu_assessments WHERE company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a') AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1') AND is_official=true)) accepted_a1,
      (SELECT id FROM seu_assessment_items WHERE assessment_id=(SELECT id FROM seu_assessments WHERE unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A2')) AND user_decision='accepted_as_seu') accepted_a2,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] SEU Natural Gas A1') rejected_a1,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] SEU Monitoring A1') monitor_a1,
      (SELECT id FROM seu_assessment_items WHERE name='[E2E] SEU Electricity A1' AND assessment_id=(SELECT id FROM seu_assessments WHERE company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b') AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit B1'))) accepted_b1,
      (SELECT id FROM energy_baselines WHERE notes='[E2E] target parent fixture' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a') AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A1')) baseline_a1,
      (SELECT id FROM energy_baselines WHERE notes='[E2E] target parent fixture' AND unit_id=(SELECT id FROM units WHERE name='[E2E] Unit A2')) baseline_a2,
      (SELECT id FROM energy_baselines WHERE notes='[E2E] target parent fixture' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b')) baseline_b1,
      (SELECT id FROM energy_targets WHERE name='[E2E] Electricity Reduction Target' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a')) target_a1,
      (SELECT id FROM energy_targets WHERE name='[E2E] Natural Gas Monitoring Target') target_a1_gas,
      (SELECT id FROM energy_targets WHERE name='[E2E] Independent Delete Target') target_a1_delete,
      (SELECT id FROM energy_targets WHERE name='[E2E] Unit A2 Target') target_a2,
      (SELECT id FROM energy_targets WHERE name='[E2E] Electricity Reduction Target' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b')) target_b1,
      (SELECT id FROM energy_action_plans WHERE title='[E2E] Replace inefficient motors' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a')) action_a1,
      (SELECT id FROM energy_action_plans WHERE title='[E2E] Optimize operating schedule') overdue_a1,
      (SELECT id FROM energy_action_plans WHERE title='[E2E] Completed lighting retrofit') completed_a1,
      (SELECT id FROM energy_action_plans WHERE title='[E2E] Independent Delete Action') delete_action_a1,
      (SELECT id FROM energy_action_plans WHERE title='[E2E] Unit A2 Action') action_a2,
      (SELECT id FROM energy_action_plans WHERE title='[E2E] Replace inefficient motors' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b')) action_b1,
      (SELECT id FROM vap_projects WHERE project_title='[E2E] Heat Recovery VAP' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-a')) vap_a1,
      (SELECT id FROM vap_projects WHERE project_title='[E2E] Unit A2 VAP') vap_a2,
      (SELECT id FROM vap_projects WHERE project_title='[E2E] Heat Recovery VAP' AND company_id=(SELECT id FROM companies WHERE subdomain='e2e-tenant-b')) vap_b1,
      (SELECT id FROM users WHERE username='e2e_user_b1') user_b1
  `);
  const r = result.rows[0]!;
  return {
    companyA:r.company_a, companyB:r.company_b, unitA1:r.unit_a1, unitA2:r.unit_a2, unitB1:r.unit_b1,
    subA1:r.sub_a1, subA2:r.sub_a2, subB1:r.sub_b1, sourceA1:r.source_a1, sourceA2:r.source_a2, sourceB1:r.source_b1,
    officialA1:r.official_a1, draftA1:r.draft_a1, officialA2:r.official_a2, officialB1:r.official_b1,
    acceptedA1:r.accepted_a1, acceptedA2:r.accepted_a2, rejectedA1:r.rejected_a1, monitorA1:r.monitor_a1, acceptedB1:r.accepted_b1,
    baselineA1:r.baseline_a1, baselineA2:r.baseline_a2, baselineB1:r.baseline_b1,
    targetA1:r.target_a1, targetA1Gas:r.target_a1_gas, targetA1Delete:r.target_a1_delete, targetA2:r.target_a2, targetB1:r.target_b1,
    actionA1:r.action_a1, overdueA1:r.overdue_a1, completedA1:r.completed_a1, deleteActionA1:r.delete_action_a1, actionA2:r.action_a2, actionB1:r.action_b1,
    vapA1:r.vap_a1, vapA2:r.vap_a2, vapB1:r.vap_b1, userB1:r.user_b1,
  };
}

function validTarget(overrides: Record<string, unknown> = {}) {
  return { name: `[F3A7] Target ${Date.now()}-${Math.random()}`, unitId: ids.unitA1, subUnitId: ids.subA1, energySourceId: ids.sourceA1, seuAssessmentId: ids.officialA1, seuAssessmentItemId: ids.acceptedA1, baselineId: ids.baselineA1, baselineYear: 2025, targetYear: 2026, targetReductionPercent: 10, baselineValue: 1000, targetValue: 900, targetType: "consumption_reduction", status: "active", ...overrides };
}
function validAction(targetId = ids.targetA1, overrides: Record<string, unknown> = {}) {
  return { targetId, title: `[F3A7] Action ${Date.now()}-${Math.random()}`, priority: "medium", startDate: "2025-01-01", dueDate: "2026-12-31", progressPercent: 25, status: "in_progress", ...overrides };
}
async function rawVapAction(companyId = ids.companyA, targetId = ids.targetA1): Promise<number> {
  const result = await pool.query<{ id: number }>("INSERT INTO energy_action_plans(company_id,target_id,title,status,is_vap) VALUES($1,$2,$3,'planned',true) RETURNING id", [companyId, targetId, `[F3A7] VAP Action ${Date.now()}-${Math.random()}`]);
  return result.rows[0]!.id;
}
async function rawBaseline(companyId: number, unitId: number, seuItemId: number, status = "active", isValid = true): Promise<number> {
  const result = await pool.query<{ id: number }>("INSERT INTO energy_baselines(company_id,unit_id,seu_assessment_item_id,baseline_year,period_start,period_end,model_type,status,is_valid,notes) VALUES($1,$2,$3,2025,'2025-01-01','2025-12-31','linear',$4,$5,'[F3A7] target parent') RETURNING id", [companyId, unitId, seuItemId, status, isValid]);
  return result.rows[0]!.id;
}
function validVap(actionPlanId: number, overrides: Record<string, unknown> = {}) {
  return { actionPlanId, projectTitle: `[F3A7] VAP ${Date.now()}-${Math.random()}`, projectCode: `F3A7-${Date.now()}`, annualEnergySavingValue: 100, annualEnergySavingUnit: "MWh", annualCostSaving: 50000, investmentCost: 100000, paybackMonths: 24, status: "active", ...overrides };
}

async function cleanupDynamic(): Promise<void> {
  await pool.query("DELETE FROM energy_target_progress WHERE comment LIKE '[F3A7]%'");
  await pool.query("DELETE FROM vap_projects WHERE project_title LIKE '[F3A7]%'");
  await pool.query("DELETE FROM energy_action_plans WHERE title LIKE '[F3A7]%'");
  await pool.query("DELETE FROM energy_targets WHERE name LIKE '[F3A7]%'");
  await pool.query("DELETE FROM energy_baselines WHERE notes='[F3A7] target parent'");
}

async function uiLogin(page: Page, username: string): Promise<void> {
  await page.goto("/"); await page.locator("#username").fill(username); await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click(); await expect(page.getByText("Enerji Yönetimi", { exact: true }).first()).toBeVisible();
}

test.beforeAll(async () => { ids = await resolveIds(); });
test.afterEach(async () => { await cleanupDynamic(); });
test.afterAll(async () => { await cleanupDynamic(); await pool.end(); });

test("TARGET-01 standard A1 sees only Unit A1 targets", async ({ request }) => { const s=await login(request,credentials.standardA1); const rows=await (await request.get("/api/targets",{headers:auth(s.token)})).json() as Target[]; expect(rows.some(r=>r.id===ids.targetA1)).toBe(true); expect(rows.some(r=>r.id===ids.targetA2||r.id===ids.targetB1)).toBe(false); });
test("TARGET-02 standard A2 sees only Unit A2 targets", async ({ request }) => { const s=await login(request,credentials.standardA2); const rows=await (await request.get("/api/targets",{headers:auth(s.token)})).json() as Target[]; expect(rows.map(r=>r.id)).toEqual([ids.targetA2]); });
test("TARGET-03 null-unit standard list is empty", async ({ request }) => { const s=await login(request,credentials.nullUnit); expect(await (await request.get("/api/targets",{headers:auth(s.token)})).json()).toEqual([]); });
test("TARGET-04 null-unit standard mutation is forbidden", async ({ request }) => { const s=await login(request,credentials.nullUnit); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget()})).status()).toBe(403); });
test("TARGET-05 admin sees Tenant A targets only", async ({ request }) => { const s=await login(request,credentials.adminA); const rows=await (await request.get("/api/targets",{headers:auth(s.token)})).json() as Target[]; expect(rows.some(r=>r.id===ids.targetA2)).toBe(true); expect(rows.some(r=>r.id===ids.targetB1)).toBe(false); });
test("TARGET-06 kontrol_admin matches admin", async ({ request }) => { const a=await login(request,credentials.adminA),k=await login(request,credentials.kontrolAdminA); const ar=await (await request.get("/api/targets",{headers:auth(a.token)})).json() as Target[]; const kr=await (await request.get("/api/targets",{headers:auth(k.token)})).json() as Target[]; expect(kr.map(r=>r.id)).toEqual(ar.map(r=>r.id)); });
test("TARGET-07 admin company query cannot escape tenant", async ({ request }) => { const s=await login(request,credentials.adminA); const rows=await (await request.get(`/api/targets?companyId=${ids.companyB}`,{headers:auth(s.token)})).json() as Target[]; expect(rows.some(r=>r.id===ids.targetB1)).toBe(false); });
test("TARGET-08 superadmin explicit company filters Tenant B", async ({ request }) => { const s=await login(request,credentials.superadmin); const rows=await (await request.get(`/api/targets?companyId=${ids.companyB}`,{headers:auth(s.token)})).json() as Target[]; expect(rows.map(r=>r.id)).toEqual([ids.targetB1]); });

test("ACTION-01 standard A1 action scope", async ({ request }) => { const s=await login(request,credentials.standardA1); const rows=await (await request.get("/api/energy-action-plans",{headers:auth(s.token)})).json() as Action[]; expect(rows.some(r=>r.id===ids.actionA1)).toBe(true); expect(rows.some(r=>r.id===ids.actionA2||r.id===ids.actionB1)).toBe(false); });
test("ACTION-02 standard A2 action scope", async ({ request }) => { const s=await login(request,credentials.standardA2); const rows=await (await request.get("/api/energy-action-plans",{headers:auth(s.token)})).json() as Action[]; expect(rows.map(r=>r.id)).toEqual([ids.actionA2]); });
test("ACTION-03 null-unit list is empty", async ({ request }) => { const s=await login(request,credentials.nullUnit); expect(await (await request.get("/api/energy-action-plans",{headers:auth(s.token)})).json()).toEqual([]); });
test("ACTION-04 admin and kontrol_admin company parity", async ({ request }) => { const a=await login(request,credentials.adminA),k=await login(request,credentials.kontrolAdminA); const ar=await (await request.get("/api/energy-action-plans",{headers:auth(a.token)})).json() as Action[]; const kr=await (await request.get("/api/energy-action-plans",{headers:auth(k.token)})).json() as Action[]; expect(kr.map(r=>r.id)).toEqual(ar.map(r=>r.id)); expect(ar.some(r=>r.id===ids.actionB1)).toBe(false); });
test("ACTION-05 target filter remains tenant scoped", async ({ request }) => { const s=await login(request,credentials.adminA); const rows=await (await request.get(`/api/energy-action-plans?targetId=${ids.targetB1}`,{headers:auth(s.token)})).json() as Action[]; expect(rows).toEqual([]); });
test("ACTION-06 superadmin explicit company exposes Tenant B actions", async ({ request }) => { const s=await login(request,credentials.superadmin); const rows=await (await request.get(`/api/energy-action-plans?companyId=${ids.companyB}`,{headers:auth(s.token)})).json() as Action[]; expect(rows.map(r=>r.id)).toContain(ids.actionB1); expect(rows.some(r=>r.companyId===ids.companyA)).toBe(false); });

test("VAP-01 standard A1 scope", async ({ request }) => { const s=await login(request,credentials.standardA1); const rows=await (await request.get("/api/vap-projects",{headers:auth(s.token)})).json() as Vap[]; expect(rows.some(r=>r.id===ids.vapA1)).toBe(true); expect(rows.some(r=>r.id===ids.vapA2||r.id===ids.vapB1)).toBe(false); });
test("VAP-02 standard A2 scope", async ({ request }) => { const s=await login(request,credentials.standardA2); const rows=await (await request.get("/api/vap-projects",{headers:auth(s.token)})).json() as Vap[]; expect(rows.map(r=>r.id)).toEqual([ids.vapA2]); });
test("VAP-03 null-unit list is empty", async ({ request }) => { const s=await login(request,credentials.nullUnit); expect(await (await request.get("/api/vap-projects",{headers:auth(s.token)})).json()).toEqual([]); });
test("VAP-04 null-unit mutation is forbidden", async ({ request }) => { const s=await login(request,credentials.nullUnit); expect((await request.post("/api/vap-projects",{headers:auth(s.token),data:{actionPlanId:ids.actionA1,projectTitle:"[F3A7] forbidden"}})).status()).toBe(403); });
test("VAP-05 admin and kontrol_admin parity", async ({ request }) => { const a=await login(request,credentials.adminA),k=await login(request,credentials.kontrolAdminA); const ar=await (await request.get("/api/vap-projects",{headers:auth(a.token)})).json() as Vap[]; const kr=await (await request.get("/api/vap-projects",{headers:auth(k.token)})).json() as Vap[]; expect(kr.map(r=>r.id)).toEqual(ar.map(r=>r.id)); expect(ar.some(r=>r.id===ids.vapB1)).toBe(false); });
test("VAP-06 superadmin explicit company exposes Tenant B VAP", async ({ request }) => { const s=await login(request,credentials.superadmin); const rows=await (await request.get(`/api/vap-projects?companyId=${ids.companyB}`,{headers:auth(s.token)})).json() as Vap[]; expect(rows.map(r=>r.id)).toEqual([ids.vapB1]); });

for (const [label,path,method] of [
  ["target suffix","/api/targets/123abc","patch"],["target zero","/api/targets/0","patch"],["target decimal","/api/targets/1.5","patch"],
  ["action suffix","/api/energy-action-plans/123abc","put"],["action zero","/api/energy-action-plans/0","put"],["action decimal","/api/energy-action-plans/1.5","put"],
  ["vap suffix","/api/vap-projects/123abc","put"],["vap zero","/api/vap-projects/0","put"],["vap decimal","/api/vap-projects/1.5","put"],
] as const) test(`STRICT-ID ${label}`,async({request})=>{const s=await login(request,credentials.adminA); const response=await request[method](path,{headers:auth(s.token),data:{}}); expect(response.status()).toBe(400);});

test("TARGET-CREATE valid official assessment target persists the complete parent chain",async({request})=>{const s=await login(request,credentials.adminA); const r=await request.post("/api/targets",{headers:auth(s.token),data:validTarget()}); expect(r.status()).toBe(201); const body=await r.json() as Target; expect(body).toMatchObject({companyId:ids.companyA,unitId:ids.unitA1,targetReductionPercent:10,seuAssessmentId:ids.officialA1,seuAssessmentItemId:ids.acceptedA1,baselineId:ids.baselineA1}); const stored=await pool.query<{seu_assessment_id:number;seu_assessment_item_id:number;baseline_id:number}>("SELECT seu_assessment_id,seu_assessment_item_id,baseline_id FROM energy_targets WHERE id=$1",[body.id]); expect(stored.rows[0]).toEqual({seu_assessment_id:ids.officialA1,seu_assessment_item_id:ids.acceptedA1,baseline_id:ids.baselineA1});});
for(const [label,field] of [["assessment","seuAssessmentId"],["assessment item","seuAssessmentItemId"],["baseline","baselineId"]] as const) test(`TARGET-PARENT missing ${label} is rejected`,async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({[field]:undefined})})).status()).toBe(400);});
test("TARGET-CREATE standard cannot override own unit",async({request})=>{const s=await login(request,credentials.standardA1); const r=await request.post("/api/targets",{headers:auth(s.token),data:validTarget({unitId:ids.unitA2,subUnitId:null,energySourceId:null})}); expect(r.status()).toBe(201); expect((await r.json() as Target).unitId).toBe(ids.unitA1);});
test("TARGET-PARENT cross-unit sub-unit is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({subUnitId:ids.subA2})})).status()).toBe(400);});
test("TARGET-PARENT cross-tenant source is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({energySourceId:ids.sourceB1})})).status()).toBe(400);});
test("TARGET-PARENT draft assessment is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({seuAssessmentId:ids.draftA1})})).status()).toBe(400);});
test("TARGET-PARENT invalid baseline is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({baselineId:999999})})).status()).toBe(400);});
test("TARGET-PARENT assessment and item mismatch is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({seuAssessmentItemId:ids.acceptedA2,baselineId:ids.baselineA2})})).status()).toBe(400);});
test("TARGET-PARENT baseline and item mismatch is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({baselineId:ids.baselineA2})})).status()).toBe(400);});
test("TARGET-PARENT cross-unit complete chain is rejected",async({request})=>{const s=await login(request,credentials.standardA1); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({seuAssessmentId:ids.officialA2,seuAssessmentItemId:ids.acceptedA2,baselineId:ids.baselineA2})})).status()).toBe(400);});
test("TARGET-PARENT superadmin explicit Tenant B context",async({request})=>{const s=await login(request,credentials.superadmin); const r=await request.post("/api/targets",{headers:auth(s.token),data:validTarget({companyId:ids.companyB,unitId:ids.unitB1,subUnitId:ids.subB1,energySourceId:ids.sourceB1,seuAssessmentId:ids.officialB1,seuAssessmentItemId:ids.acceptedB1,baselineId:ids.baselineB1})}); expect(r.status()).toBe(201); expect((await r.json() as Target).companyId).toBe(ids.companyB);});
test("TARGET-PARENT active valid accepted baseline is allowed",async({request})=>{const baselineId=await rawBaseline(ids.companyA,ids.unitA1,ids.acceptedA1); const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({baselineId})})).status()).toBe(201);});
for(const [label,itemId,status,isValid] of [["archived baseline",0,"archived",true],["isValid false baseline",0,"active",false],["not_seu baseline",1,"active",true],["monitor baseline",2,"active",true]] as const) test(`TARGET-PARENT ${label} is rejected`,async({request})=>{const selectedItem=itemId===0?ids.acceptedA1:itemId===1?ids.rejectedA1:ids.monitorA1; const baselineId=await rawBaseline(ids.companyA,ids.unitA1,selectedItem,status,isValid); const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({seuAssessmentItemId:selectedItem,baselineId})})).status()).toBe(400);});
test("TARGET-PARENT cross-tenant baseline is rejected",async({request})=>{const baselineId=await rawBaseline(ids.companyB,ids.unitB1,ids.acceptedB1); const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({baselineId})})).status()).toBe(400);});
test("TARGET-PARENT cross-tenant complete chain is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({seuAssessmentId:ids.officialB1,seuAssessmentItemId:ids.acceptedB1,baselineId:ids.baselineB1})})).status()).toBe(400);});
test("TARGET-PARENT superadmin mutation requires company context",async({request})=>{const s=await login(request,credentials.superadmin); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget()})).status()).toBe(400);});
test("TARGET-PARENT update accepts an active valid baseline for the same item",async({request})=>{const s=await login(request,credentials.adminA); const made=await request.post("/api/targets",{headers:auth(s.token),data:validTarget()}); const target=await made.json() as Target; const baselineId=await rawBaseline(ids.companyA,ids.unitA1,ids.acceptedA1); const updated=await request.patch(`/api/targets/${target.id}`,{headers:auth(s.token),data:{seuAssessmentId:ids.officialA1,seuAssessmentItemId:ids.acceptedA1,baselineId}}); expect(updated.status()).toBe(200); expect(await updated.json()).toMatchObject({seuAssessmentId:ids.officialA1,seuAssessmentItemId:ids.acceptedA1,baselineId});});
test("TARGET-PARENT failed update preserves the existing parent chain atomically",async({request})=>{const s=await login(request,credentials.adminA); const made=await request.post("/api/targets",{headers:auth(s.token),data:validTarget()}); const target=await made.json() as Target; const rejected=await request.patch(`/api/targets/${target.id}`,{headers:auth(s.token),data:{seuAssessmentId:ids.officialB1,seuAssessmentItemId:ids.acceptedB1,baselineId:ids.baselineB1}}); expect(rejected.status()).toBe(400); const stored=await pool.query<{seu_assessment_id:number;seu_assessment_item_id:number;baseline_id:number}>("SELECT seu_assessment_id,seu_assessment_item_id,baseline_id FROM energy_targets WHERE id=$1",[target.id]); expect(stored.rows[0]).toEqual({seu_assessment_id:ids.officialA1,seu_assessment_item_id:ids.acceptedA1,baseline_id:ids.baselineA1});});
test("TARGET-PARENT linked assessment deletion is blocked",async({request})=>{const s=await login(request,credentials.standardA1); const response=await request.delete(`/api/seu/assessments/${ids.officialA1}`,{headers:auth(s.token)}); expect(response.status()).toBe(409); expect((await pool.query("SELECT id FROM seu_assessments WHERE id=$1",[ids.officialA1])).rowCount).toBe(1); expect((await pool.query("SELECT id FROM energy_targets WHERE id=$1",[ids.targetA1])).rowCount).toBe(1);});

for(const [label,overrides] of [
  ["missing name",{name:undefined}],["blank name",{name:"   "}],["unknown type",{targetType:"unknown"}],["unknown status",{status:"unknown"}],
  ["partial baseline year",{baselineYear:"2025abc"}],["decimal target year",{targetYear:"2026.5"}],["negative reduction",{targetReductionPercent:-1}],
  ["partial reduction",{targetReductionPercent:"10abc"}],["comma reduction",{targetReductionPercent:"10,5"}],["NaN reduction",{targetReductionPercent:"NaN"}],
  ["Infinity reduction",{targetReductionPercent:"Infinity"}],["negative baseline",{baselineValue:-1}],["negative target",{targetValue:-1}],
  ["end before start year",{baselineYear:2027,targetYear:2026}],["object reduction",{targetReductionPercent:{value:10}}],["array year",{targetYear:[2026]}],
] as const) test(`TARGET-VALIDATION ${label}`,async({request})=>{const s=await login(request,credentials.adminA); const r=await request.post("/api/targets",{headers:auth(s.token),data:validTarget(overrides as Record<string,unknown>)}); expect(r.status()).toBe(400);});
test("TARGET-VALIDATION trims title and accepts complete numeric strings",async({request})=>{const s=await login(request,credentials.adminA); const r=await request.post("/api/targets",{headers:auth(s.token),data:validTarget({name:"  [F3A7] Trimmed target  ",baselineYear:" 2025 ",targetYear:" 2026 ",targetReductionPercent:"12.5",baselineValue:"1000.5"})}); expect(r.status()).toBe(201); expect(await r.json()).toMatchObject({name:"[F3A7] Trimmed target",baselineYear:2025,targetYear:2026,targetReductionPercent:12.5,baselineValue:1000.5});});
test("TARGET-VALIDATION title longer than 255 is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({name:`[F3A7] ${"x".repeat(256)}`})})).status()).toBe(400);});
test("TARGET-VALIDATION invalid PATCH is atomic",async({request})=>{const s=await login(request,credentials.adminA); const made=await request.post("/api/targets",{headers:auth(s.token),data:validTarget()}); const target=await made.json() as Target; const rejected=await request.patch(`/api/targets/${target.id}`,{headers:auth(s.token),data:{name:"[F3A7] should not persist",status:"cancelled",targetYear:"2027abc"}}); expect(rejected.status()).toBe(400); const stored=await pool.query<{name:string;status:string;target_year:number}>("SELECT name,status,target_year FROM energy_targets WHERE id=$1",[target.id]); expect(stored.rows[0]).toMatchObject({name:target.name,status:target.status,target_year:2026});});

test("TARGET duplicate same SEU/year is rejected",async({request})=>{const s=await login(request,credentials.adminA); const data=validTarget({name:"[F3A7] Duplicate one"}); expect((await request.post("/api/targets",{headers:auth(s.token),data})).status()).toBe(201); expect((await request.post("/api/targets",{headers:auth(s.token),data:{...data,name:"[F3A7] Duplicate two"}})).status()).toBe(409);});
test("TARGET duplicate key allows the same item in a different year",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({targetYear:2031})})).status()).toBe(201); expect((await request.post("/api/targets",{headers:auth(s.token),data:validTarget({targetYear:2032})})).status()).toBe(201);});
test("TARGET duplicate PATCH is rejected and preserves the old state",async({request})=>{const s=await login(request,credentials.adminA); const first=await request.post("/api/targets",{headers:auth(s.token),data:validTarget({targetYear:2031})}); const second=await request.post("/api/targets",{headers:auth(s.token),data:validTarget({targetYear:2032})}); expect(first.status()).toBe(201); expect(second.status()).toBe(201); const target=await second.json() as Target & {targetYear:number}; const rejected=await request.patch(`/api/targets/${target.id}`,{headers:auth(s.token),data:{name:"[F3A7] duplicate patch must not persist",targetYear:2031}}); expect(rejected.status()).toBe(409); const stored=await pool.query<{name:string;target_year:number;seu_assessment_item_id:number}>("SELECT name,target_year,seu_assessment_item_id FROM energy_targets WHERE id=$1",[target.id]); expect(stored.rows[0]).toEqual({name:target.name,target_year:2032,seu_assessment_item_id:ids.acceptedA1});});
test("TARGET duplicate key remains tenant scoped",async({request})=>{const s=await login(request,credentials.superadmin); const tenantA=await request.post("/api/targets",{headers:auth(s.token),data:validTarget({companyId:ids.companyA,targetYear:2033})}); const tenantB=await request.post("/api/targets",{headers:auth(s.token),data:validTarget({companyId:ids.companyB,unitId:ids.unitB1,subUnitId:ids.subB1,energySourceId:ids.sourceB1,seuAssessmentId:ids.officialB1,seuAssessmentItemId:ids.acceptedB1,baselineId:ids.baselineB1,targetYear:2033})}); expect(tenantA.status()).toBe(201); expect(tenantB.status()).toBe(201);});
test("TARGET client actual value cannot forge achievement",async({request})=>{const s=await login(request,credentials.adminA); const r=await request.post("/api/targets",{headers:auth(s.token),data:validTarget({actualValue:1})}); expect(r.status()).toBe(201); expect((await r.json() as Target).actualValue).toBeNull();});
test("TARGET progress updates actual value transactionally",async({request})=>{const s=await login(request,credentials.adminA); const made=await request.post("/api/targets",{headers:auth(s.token),data:validTarget()}); const target=await made.json() as Target; const p=await request.post("/api/energy-target-progress",{headers:auth(s.token),data:{targetId:target.id,periodYear:2026,periodMonth:1,actualValue:850,comment:"[F3A7] progress"}}); expect(p.status()).toBe(201); const db=await pool.query<{actual_value:number}>("SELECT actual_value FROM energy_targets WHERE id=$1",[target.id]); expect(db.rows[0]?.actual_value).toBe(850);});
test("TARGET PATCH cannot overwrite authoritative progress actual value",async({request})=>{const s=await login(request,credentials.adminA); const made=await request.post("/api/targets",{headers:auth(s.token),data:validTarget()}); const target=await made.json() as Target; expect((await request.post("/api/energy-target-progress",{headers:auth(s.token),data:{targetId:target.id,periodYear:2026,periodMonth:1,actualValue:850}})).status()).toBe(201); const updated=await request.patch(`/api/targets/${target.id}`,{headers:auth(s.token),data:{actualValue:1,name:"[F3A7] Authoritative actual"}}); expect(updated.status()).toBe(200); expect(await updated.json()).toMatchObject({actualValue:850,name:"[F3A7] Authoritative actual"}); const db=await pool.query<{actual_value:number}>("SELECT actual_value FROM energy_targets WHERE id=$1",[target.id]); expect(db.rows[0]?.actual_value).toBe(850);});
test("TARGET progress deletion refreshes authoritative actual snapshot",async({request})=>{const s=await login(request,credentials.adminA); const made=await request.post("/api/targets",{headers:auth(s.token),data:validTarget()}); const target=await made.json() as Target; await request.post("/api/energy-target-progress",{headers:auth(s.token),data:{targetId:target.id,periodYear:2026,periodMonth:1,actualValue:850}}); const latest=await request.post("/api/energy-target-progress",{headers:auth(s.token),data:{targetId:target.id,periodYear:2026,periodMonth:2,actualValue:800}}); const latestProgress=await latest.json() as {id:number}; expect((await request.delete(`/api/energy-target-progress/${latestProgress.id}`,{headers:auth(s.token)})).status()).toBe(204); const db=await pool.query<{actual_value:number}>("SELECT actual_value FROM energy_targets WHERE id=$1",[target.id]); expect(db.rows[0]?.actual_value).toBe(850);});

test("ACTION-CREATE valid action",async({request})=>{const s=await login(request,credentials.standardA1); const r=await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction()}); expect(r.status()).toBe(201); expect((await r.json() as Action).companyId).toBe(ids.companyA);});
test("ACTION-PARENT standard cross-unit target rejected",async({request})=>{const s=await login(request,credentials.standardA1); expect((await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetA2)})).status()).toBe(403);});
test("ACTION-PARENT admin cross-tenant target rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetB1)})).status()).toBe(403);});
test("ACTION-PARENT cross-company owner rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetA1,{responsibleUserId:ids.userB1})})).status()).toBe(400);});
test("ACTION-PARENT superadmin explicit Tenant B context",async({request})=>{const s=await login(request,credentials.superadmin); const r=await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetB1,{companyId:ids.companyB})}); expect(r.status()).toBe(201); expect((await r.json() as Action).companyId).toBe(ids.companyB);});
test("ACTION-PARENT superadmin missing company context is rejected",async({request})=>{const s=await login(request,credentials.superadmin); expect((await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetB1)})).status()).toBe(400);});
test("ACTION-PARENT superadmin cross-company target is rejected",async({request})=>{const s=await login(request,credentials.superadmin); expect((await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetB1,{companyId:ids.companyA})})).status()).toBe(403);});

for(const [label,overrides] of [
  ["blank title",{title:"   "}],["unknown status",{status:"unknown"}],["unknown priority",{priority:"urgent"}],
  ["negative progress",{progressPercent:-1}],["progress over 100",{progressPercent:101}],["partial progress",{progressPercent:"25abc"}],
  ["comma progress",{progressPercent:"25,5"}],["NaN progress",{progressPercent:"NaN"}],["Infinity progress",{progressPercent:"Infinity"}],
  ["invalid start date",{startDate:"not-a-date"}],["invalid due date",{dueDate:"2026-99-99"}],["due before start",{startDate:"2026-12-31",dueDate:"2026-01-01"}],
  ["completed below 100",{status:"completed",progressPercent:50}],
] as const) test(`ACTION-VALIDATION ${label}`,async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetA1,overrides as Record<string,unknown>)})).status()).toBe(400);});
test("ACTION-VALIDATION trims title and accepts decimal numeric strings",async({request})=>{const s=await login(request,credentials.adminA); const r=await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetA1,{title:"  [F3A7] Trimmed action  ",progressPercent:"12.5",investmentCost:"1000.5"})}); expect(r.status()).toBe(201); expect(await r.json()).toMatchObject({title:"[F3A7] Trimmed action",progressPercent:12.5,investmentCost:1000.5});});
test("ACTION-VALIDATION title longer than 255 is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetA1,{title:`[F3A7] ${"x".repeat(256)}`})})).status()).toBe(400);});
test("ACTION-VALIDATION invalid calendar date is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetA1,{startDate:"2026-02-31"})})).status()).toBe(400);});
test("ACTION-VALIDATION invalid PATCH does not clamp or persist siblings",async({request})=>{const s=await login(request,credentials.adminA); const made=await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction()}); const action=await made.json() as Action; const rejected=await request.put(`/api/energy-action-plans/${action.id}`,{headers:auth(s.token),data:{title:"[F3A7] should not persist",progressPercent:101}}); expect(rejected.status()).toBe(400); const stored=await pool.query<{title:string;progress_percent:number}>("SELECT title,progress_percent FROM energy_action_plans WHERE id=$1",[action.id]); expect(stored.rows[0]).toMatchObject({title:action.title,progress_percent:25});});

test("ACTION progress 100 normalizes completed status",async({request})=>{const s=await login(request,credentials.adminA); const r=await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction(ids.targetA1,{progressPercent:100,status:"in_progress"})}); expect(r.status()).toBe(201); expect((await r.json() as Action).status).toBe("completed");});
test("ACTION completed is not overdue pending work",async({request})=>{const s=await login(request,credentials.standardA1); const rows=await (await request.get("/api/pending-work-items",{headers:auth(s.token)})).json() as Array<{sourceRecordId:number;type:string}>; expect(rows.some(r=>r.sourceRecordId===ids.completedA1&&r.type==="energy_action_plan_overdue")).toBe(false);});
test("ACTION overdue unfinished creates pending work",async({request})=>{const s=await login(request,credentials.standardA1); const rows=await (await request.get("/api/pending-work-items",{headers:auth(s.token)})).json() as Array<{sourceRecordId:number;type:string;actionUrl:string}>; const item=rows.find(r=>r.sourceRecordId===ids.overdueA1&&r.type==="energy_action_plan_overdue"); expect(item?.actionUrl).toContain(`actionPlanId=${ids.overdueA1}`);});
test("ACTION delete does not delete parent target",async({request})=>{const s=await login(request,credentials.adminA); const made=await request.post("/api/energy-action-plans",{headers:auth(s.token),data:validAction()}); const action=await made.json() as Action; expect((await request.delete(`/api/energy-action-plans/${action.id}`,{headers:auth(s.token)})).status()).toBe(204); const target=await pool.query("SELECT id FROM energy_targets WHERE id=$1",[ids.targetA1]); expect(target.rowCount).toBe(1);});

test("VAP-CREATE valid project",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const r=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId)}); expect(r.status()).toBe(201);});
test("VAP-PARENT non-VAP action rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(ids.deleteActionA1)})).status()).toBe(400);});
test("VAP-PARENT cross-tenant action rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(ids.actionB1)})).status()).toBe(403);});
test("VAP-PARENT superadmin explicit Tenant B context",async({request})=>{const actionId=await rawVapAction(ids.companyB,ids.targetB1); const s=await login(request,credentials.superadmin); const r=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId,{companyId:ids.companyB})}); expect(r.status()).toBe(201); expect((await r.json() as Vap).companyId).toBe(ids.companyB);});
test("VAP-PARENT superadmin missing company context is rejected",async({request})=>{const actionId=await rawVapAction(ids.companyB,ids.targetB1); const s=await login(request,credentials.superadmin); expect((await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId)})).status()).toBe(400);});
test("VAP-PARENT superadmin cross-company action is rejected",async({request})=>{const actionId=await rawVapAction(ids.companyB,ids.targetB1); const s=await login(request,credentials.superadmin); expect((await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId,{companyId:ids.companyA})})).status()).toBe(403);});
test("VAP duplicate action is rejected",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(ids.actionA1)})).status()).toBe(409);});

for(const [label,overrides] of [
  ["blank title",{projectTitle:"   "}],["unknown status",{status:"unknown"}],["invalid start",{startDate:"not-a-date"}],
  ["end before start",{startDate:"2026-12-31",endDate:"2026-01-01"}],["negative investment",{investmentCost:-1}],
  ["negative saving",{annualCostSaving:-1}],["partial investment",{investmentCost:"100abc"}],["comma saving",{annualCostSaving:"50,5"}],
  ["NaN energy",{annualEnergySavingValue:"NaN"}],["Infinity cost",{investmentCost:"Infinity"}],["object cost",{investmentCost:{value:1}}],
  ["array saving",{annualCostSaving:[50]}],["negative payback",{paybackMonths:-1}],
] as const) test(`VAP-VALIDATION ${label}`,async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); expect((await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId,overrides as Record<string,unknown>)})).status()).toBe(400);});
test("VAP-VALIDATION trims title and accepts decimal numeric strings",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const r=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId,{projectTitle:"  [F3A7] Trimmed VAP  ",investmentCost:"1000.5",annualCostSaving:"500.25"})}); expect(r.status()).toBe(201); expect(await r.json()).toMatchObject({projectTitle:"[F3A7] Trimmed VAP",investmentCost:1000.5,annualCostSaving:500.25});});
test("VAP-VALIDATION title longer than 255 is rejected",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); expect((await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId,{projectTitle:`[F3A7] ${"x".repeat(256)}`})})).status()).toBe(400);});
test("VAP-VALIDATION invalid calendar date is rejected",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); expect((await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId,{startDate:"2026-02-31"})})).status()).toBe(400);});
test("VAP-VALIDATION invalid PATCH preserves all existing fields",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const made=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId)}); const vap=await made.json() as Vap; const rejected=await request.put(`/api/vap-projects/${vap.id}`,{headers:auth(s.token),data:{projectTitle:"[F3A7] should not persist",investmentCost:"100abc"}}); expect(rejected.status()).toBe(400); const stored=await pool.query<{project_title:string;investment_cost:number}>("SELECT project_title,investment_cost FROM vap_projects WHERE id=$1",[vap.id]); expect(stored.rows[0]).toMatchObject({project_title:vap.projectTitle,investment_cost:100000});});

test("VAP payback is server-authoritative",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const r=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId,{investmentCost:100000,annualCostSaving:50000,paybackMonths:999})}); expect(r.status()).toBe(201); expect((await r.json() as Vap).paybackMonths).toBe(24);});
test("VAP partial update recalculates payback",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const made=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId)}); const vap=await made.json() as Vap; const updated=await request.put(`/api/vap-projects/${vap.id}`,{headers:auth(s.token),data:{investmentCost:200000}}); expect(updated.status()).toBe(200); expect((await updated.json() as Vap).paybackMonths).toBe(48);});
test("VAP zero saving has null payback",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const r=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId,{annualCostSaving:0,paybackMonths:99})}); expect(r.status()).toBe(201); expect((await r.json() as Vap).paybackMonths).toBeNull();});
test("VAP saving-only PATCH recalculates payback",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const made=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId)}); const vap=await made.json() as Vap; const updated=await request.put(`/api/vap-projects/${vap.id}`,{headers:auth(s.token),data:{annualCostSaving:100000}}); expect(updated.status()).toBe(200); expect((await updated.json() as Vap).paybackMonths).toBe(12);});
test("VAP client payback PATCH is ignored",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const made=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId)}); const vap=await made.json() as Vap; const updated=await request.put(`/api/vap-projects/${vap.id}`,{headers:auth(s.token),data:{paybackMonths:999,projectTitle:"[F3A7] Payback ignored"}}); expect(updated.status()).toBe(200); expect(await updated.json()).toMatchObject({paybackMonths:24,projectTitle:"[F3A7] Payback ignored"});});
test("VAP unrelated PATCH preserves calculated payback",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const made=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId)}); const vap=await made.json() as Vap; const updated=await request.put(`/api/vap-projects/${vap.id}`,{headers:auth(s.token),data:{status:"planned"}}); expect(updated.status()).toBe(200); expect((await updated.json() as Vap).paybackMonths).toBe(24);});
test("VAP zero investment has zero payback",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const made=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId,{investmentCost:0,annualCostSaving:50000,paybackMonths:99})}); expect(made.status()).toBe(201); expect((await made.json() as Vap).paybackMonths).toBe(0);});
test("VAP delete does not delete action or target",async({request})=>{const s=await login(request,credentials.adminA); const actionId=await rawVapAction(); const made=await request.post("/api/vap-projects",{headers:auth(s.token),data:validVap(actionId)}); const vap=await made.json() as Vap; expect((await request.delete(`/api/vap-projects/${vap.id}`,{headers:auth(s.token)})).status()).toBe(204); expect((await pool.query("SELECT id FROM energy_action_plans WHERE id=$1",[actionId])).rowCount).toBe(1); expect((await pool.query("SELECT id FROM energy_targets WHERE id=$1",[ids.targetA1])).rowCount).toBe(1);});

test("DELETE target with actions returns 409",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.delete(`/api/targets/${ids.targetA1}`,{headers:auth(s.token)})).status()).toBe(409);});
test("DELETE independent target succeeds",async({request})=>{const s=await login(request,credentials.adminA); const made=await request.post("/api/targets",{headers:auth(s.token),data:validTarget({name:"[F3A7] Deletable"})}); const target=await made.json() as Target; expect((await request.delete(`/api/targets/${target.id}`,{headers:auth(s.token)})).status()).toBe(204);});
test("DELETE other tenant target is isolated",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.delete(`/api/targets/${ids.targetB1}`,{headers:auth(s.token)})).status()).toBe(404); expect((await pool.query("SELECT id FROM energy_targets WHERE id=$1",[ids.targetB1])).rowCount).toBe(1);});
test("DELETE other unit action is isolated for standard",async({request})=>{const s=await login(request,credentials.standardA1); expect((await request.delete(`/api/energy-action-plans/${ids.actionA2}`,{headers:auth(s.token)})).status()).toBe(403); expect((await pool.query("SELECT id FROM energy_action_plans WHERE id=$1",[ids.actionA2])).rowCount).toBe(1);});

for(const [label,path] of [["TARGET-EXPORT-CSV","/api/targets/export?format=csv"],["VAP-EXPORT-CSV","/api/vap-projects/export?format=csv"]] as const) test(label,async({request})=>{const s=await login(request,credentials.standardA1); const r=await request.get(path,{headers:auth(s.token)}); expect(r.status()).toBe(200); expect(r.headers()["content-type"]).toContain("text/csv"); const text=await r.text(); expect(text).toContain("[E2E]"); expect(text).not.toContain("Unit A2"); expect(text).not.toContain("Tenant B");});
for(const [label,path] of [["TARGET-EXPORT-XLSX","/api/targets/export?format=xlsx"],["VAP-EXPORT-XLSX","/api/vap-projects/export?format=xlsx"]] as const) test(label,async({request})=>{const s=await login(request,credentials.adminA); const r=await request.get(path,{headers:auth(s.token)}); expect(r.status()).toBe(200); expect(r.headers()["content-type"]).toContain("spreadsheetml"); const body=await r.body(); expect([...body.subarray(0,4)]).toEqual([0x50,0x4b,0x03,0x04]); expect(body.toString("utf8")).not.toContain("e2e-tenant-b");});
test("TARGET export rejects partial year",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.get("/api/targets/export?year=2026abc",{headers:auth(s.token)})).status()).toBe(400);});
test("VAP export rejects foreign unit filter",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.get(`/api/vap-projects/export?unitId=${ids.unitB1}`,{headers:auth(s.token)})).status()).toBe(403);});
test("TARGET export accepts a complete numeric year and rejects decimals atomically",async({request})=>{const s=await login(request,credentials.adminA); expect((await request.get("/api/targets/export?year=%202028%20",{headers:auth(s.token)})).status()).toBe(200); const rejected=await request.get("/api/targets/export?year=2028.5",{headers:auth(s.token)}); expect(rejected.status()).toBe(400); expect(rejected.headers()["content-disposition"]).toBeUndefined();});
test("VAP export strictly rejects partial unit IDs",async({request})=>{const s=await login(request,credentials.adminA); const rejected=await request.get(`/api/vap-projects/export?unitId=${ids.unitA1}abc`,{headers:auth(s.token)}); expect(rejected.status()).toBe(400); expect(rejected.headers()["content-disposition"]).toBeUndefined();});
test("VAP export accepts an own-company unit and remains tenant scoped",async({request})=>{const s=await login(request,credentials.adminA); const response=await request.get(`/api/vap-projects/export?unitId=${ids.unitA1}`,{headers:auth(s.token)}); expect(response.status()).toBe(200); const csv=await response.text(); expect(csv).toContain("[E2E] Heat Recovery VAP"); expect(csv).not.toContain("Unit A2"); expect(csv).not.toContain("Tenant B");});
test("VAP export rejects a superadmin company and unit mismatch",async({request})=>{const s=await login(request,credentials.superadmin); expect((await request.get(`/api/vap-projects/export?companyId=${ids.companyA}&unitId=${ids.unitB1}`,{headers:auth(s.token)})).status()).toBe(403);});

test("UI-TARGET-01 standard sees only own target markers",async({page})=>{await uiLogin(page,credentials.standardA1); await page.goto("/hedefler"); await expect(page.getByText("[E2E] Electricity Reduction Target").first()).toBeVisible(); await expect(page.getByText("[E2E] Unit A2 Target")).toHaveCount(0);});
test("UI-TARGET-02 kontrol_admin sees target create and action tabs",async({page})=>{await uiLogin(page,credentials.kontrolAdminA); await page.goto("/hedefler"); await expect(page.getByText("Yeni Hedef",{exact:false}).first()).toBeVisible(); await expect(page.getByText("Eylem Planları",{exact:false}).first()).toBeVisible();});
test("UI-TARGET-03 admin sees unit filter",async({page})=>{await uiLogin(page,credentials.adminA); await page.goto("/hedefler"); await expect(page.getByRole("combobox").filter({hasText:/Tüm Birimler/}).first()).toBeVisible();});
test("UI-VAP-01 standard sees own VAP only",async({page})=>{await uiLogin(page,credentials.standardA1); await page.goto("/vap-projeler"); await expect(page.getByText("[E2E] Heat Recovery VAP").first()).toBeVisible(); await expect(page.getByText("[E2E] Unit A2 VAP")).toHaveCount(0);});
test("UI-VAP-02 kontrol_admin has create and export actions",async({page})=>{await uiLogin(page,credentials.kontrolAdminA); await page.goto("/vap-projeler"); await expect(page.getByRole("button",{name:/Yeni VAP/}).first()).toBeVisible(); await expect(page.getByRole("button",{name:/Dışa Aktar|CSV|Excel/}).first()).toBeVisible();});
