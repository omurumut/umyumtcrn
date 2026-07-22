import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { AiAnalysisResult } from "@workspace/api-zod";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function reservePort() {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Port alinamadi.")));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

async function startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const port = await reservePort();
  const repoRoot = resolve(import.meta.dirname, "../..");
  let output = "";
  const child: ChildProcess = spawn(process.execPath, ["--enable-source-maps", resolve(repoRoot, "artifacts/api-server/dist/index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      ENABLE_DEMO_SEED: "false",
      ENABLE_DEMO_SEED_USERS: "false",
      ENABLE_SUPERADMIN_BOOTSTRAP: "false",
      ENABLE_MGM_BOOTSTRAP: "false",
      ENABLE_MGM_SCHEDULER: "false",
      AI_ENABLED: "true",
      AI_PROVIDER: "mock",
      AI_ALLOW_MOCK_PROVIDER: "true",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API erken kapandi: ${output.slice(-1000)}`);
    try {
      if ((await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(500) })).status === 200) {
        return {
          baseUrl,
          close: async () => {
            child.kill("SIGTERM");
            await Promise.race([
              new Promise<void>((resolveClose) => child.once("close", () => resolveClose())),
              delay(20_000).then(() => {
                child.kill("SIGKILL");
                throw new Error("API shutdown zaman asimi.");
              }),
            ]);
          },
        };
      }
    } catch {}
    await delay(250);
  }
  child.kill("SIGKILL");
  throw new Error(`API readiness zaman asimi: ${output.slice(-1000)}`);
}

async function login(baseUrl: string, username: string) {
  const password = process.env.E2E_TEST_PASSWORD;
  assert(password, "E2E_TEST_PASSWORD yok.");
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert(response.status === 200, `${username} login ${response.status}`);
  const body = await response.json() as { token?: unknown };
  assert(typeof body.token === "string", "Token donmedi.");
  return body.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function json(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : null;
}

async function expectStatus(response: Response, expected: number, label: string) {
  const text = await response.clone().text();
  assert(response.status === expected, `${label}: beklenen ${expected}, alinan ${response.status}: ${text.slice(0, 1000)}`);
}

function result(companyId: number, unitId: number | null, findingId: string, eligible: boolean, evidenceSource = "ev:test:0001"): AiAnalysisResult {
  return {
    schemaVersion: "1.0",
    analysisType: "energy_performance_overview",
    summary: "Sentetik AI analiz sonucu eylem plani donusum testi icin.",
    dataSufficiency: "partial",
    findings: [{
      id: findingId,
      findingType: "operational_practice",
      title: "Basinc kaybi izleme aksiyonu",
      observation: "Sentetik veride basinc kaybi izleme uygulamasinin duzenli olmadigi goruldu.",
      reasoning: "Duzenli izleme enerji performansi sapmalarinin erken gorulmesini destekler.",
      evidence: [{ source: evidenceSource, description: "Sentetik evidence referansi", value: "test" }],
      scope: { companyId, unitId, year: 2026 },
      energySourceRefs: [],
      equipmentRefs: [],
      recommendedAction: "Basinc kaybi icin haftalik kontrol ve aksiyon takibi baslatilmasi.",
      priority: "high",
      estimatedImpact: { type: "qualitative_estimate", description: "Nitel iyilestirme potansiyeli vardir." },
      confidence: "medium",
      dataSufficiency: "partial",
      missingData: ["Olcum serisi eksik"],
      limitations: ["Sentetik test verisidir"],
      moduleTarget: "action_plan",
      draftActionEligibility: { eligible, reason: eligible ? "Aksiyon taslagina uygundur" : "Insan incelemesi gerekli" },
    }],
    overallLimitations: ["Sentetik test sonucu"],
    disclaimer: "Bu sonuc karar destegi icindir; muhendislik fizibilitesi veya tasarruf garantisi degildir.",
  };
}

async function insertAnalysis(pool: Pool, input: { companyId: number; unitId: number | null; userId: number; findingId: string; eligible?: boolean; status?: string; evidenceSource?: string; fallbackUsed?: boolean }) {
  const analysisResult = result(input.companyId, input.unitId, input.findingId, input.eligible ?? true, input.evidenceSource);
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO ai_analyses
      (company_id, unit_id, requested_by_user_id, analysis_type, period_start, period_end, status, provider, model,
       context_schema_version, output_schema_version, prompt_policy_version, builder_version, redaction_policy_version,
       limit_policy_version, data_version, cache_key, cache_hit, fallback_used, data_sufficiency, context_truncated,
       result_json, started_at, completed_at)
     VALUES ($1, $2, $3, 'energy_performance_overview', '2026-01-01', '2026-12-31', $4, 'mock', 'mock-v1',
       '1', 'ai-analysis-output-v1', 'test', 'test', 'test', 'test', $5, $6, false, $7,
       'partial', false, $8::jsonb, now(), CASE WHEN $4='completed' THEN now() ELSE NULL END)
     RETURNING id`,
    [
      input.companyId,
      input.unitId,
      input.userId,
      input.status ?? "completed",
      `draft-action-${input.findingId}`,
      `draft-action-${input.findingId}-${Date.now()}-${Math.random()}`,
      input.fallbackUsed ?? false,
      JSON.stringify(analysisResult),
    ],
  );
  return inserted.rows[0]!.id;
}

async function main() {
  assert(process.env.NODE_ENV === "test" && process.env.TEST_DB_DISPOSABLE === "true", "Disposable test DB gerekli.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = await startServer();
  let assertions = 0;
  try {
    const users = await pool.query<{ username: string; id: number; company_id: number; unit_id: number | null }>(
      "SELECT username, id, company_id, unit_id FROM users WHERE username = ANY($1::text[])",
      [[process.env.E2E_ADMIN_USERNAME, process.env.E2E_STANDARD_USERNAME, process.env.E2E_SUPERADMIN_USERNAME].filter(Boolean)],
    );
    const admin = users.rows.find((row) => row.username === process.env.E2E_ADMIN_USERNAME);
    const standard = users.rows.find((row) => row.username === process.env.E2E_STANDARD_USERNAME);
    const superadmin = users.rows.find((row) => row.username === process.env.E2E_SUPERADMIN_USERNAME);
    assert(admin && standard?.unit_id && superadmin, "Fixture kullanicilari eksik.");
    const target = await pool.query<{ id: number }>(
      "SELECT id FROM energy_targets WHERE company_id=$1 AND unit_id=$2 ORDER BY id LIMIT 1",
      [admin.company_id, standard.unit_id],
    );
    assert(target.rows[0], "Unit target fixture eksik.");

    const adminToken = await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!);
    const standardToken = await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!);
    const superToken = await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);

    const analysisId = await insertAnalysis(pool, { companyId: admin.company_id, unitId: standard.unit_id, userId: admin.id, findingId: "finding-ok" });
    const noApproval = await fetch(`${server.baseUrl}/api/ai/analyses/${analysisId}/findings/finding-ok/draft-action?companyId=${admin.company_id}&unitId=${standard.unit_id}&year=2026`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.rows[0].id, title: "No approval" }),
    });
    await expectStatus(noApproval, 400, "Human approval required");
    assertions += 1;

    const created = await fetch(`${server.baseUrl}/api/ai/analyses/${analysisId}/findings/finding-ok/draft-action?companyId=${admin.company_id}&unitId=${standard.unit_id}&year=2026`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.rows[0].id, title: "AI kaynakli taslak", priority: "medium", humanApproval: true, estimatedSavingKwh: 999 }),
    });
    await expectStatus(created, 201, "Eligible conversion");
    const createdBody = await json(created) as { action?: { id?: number; status?: string }; created?: boolean };
    assert(createdBody.created === true && typeof createdBody.action?.id === "number" && createdBody.action.status === "planned", "Aksiyon planned olusmali.");
    const createdAction = await pool.query<{ expected_saving_value: number | null; responsible_user_id: number | null; due_date: string | null }>(
      "SELECT expected_saving_value, responsible_user_id, due_date FROM energy_action_plans WHERE id=$1",
      [createdBody.action.id],
    );
    assert(createdAction.rows[0]?.expected_saving_value === null && createdAction.rows[0]?.responsible_user_id === null && createdAction.rows[0]?.due_date === null, "AI otomatik sorumlu/tarih/tasarruf yazmamali.");
    assertions += 2;

    const duplicate = await fetch(`${server.baseUrl}/api/ai/analyses/${analysisId}/findings/finding-ok/draft-action?companyId=${admin.company_id}&unitId=${standard.unit_id}&year=2026`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.rows[0].id, title: "Duplicate", humanApproval: true }),
    });
    await expectStatus(duplicate, 200, "Duplicate conversion");
    const duplicateBody = await json(duplicate) as { action?: { id?: number }; created?: boolean };
    assert(duplicateBody.created === false && duplicateBody.action?.id === createdBody.action.id, "Duplicate mevcut aksiyonu donmeli.");
    assertions += 1;

    const concurrentId = await insertAnalysis(pool, { companyId: admin.company_id, unitId: standard.unit_id, userId: admin.id, findingId: "finding-concurrent" });
    const concurrentUrl = `${server.baseUrl}/api/ai/analyses/${concurrentId}/findings/finding-concurrent/draft-action?companyId=${admin.company_id}&unitId=${standard.unit_id}&year=2026`;
    const concurrentBody = JSON.stringify({ targetId: target.rows[0].id, title: "Concurrent draft", humanApproval: true });
    const [concurrentA, concurrentB] = await Promise.all([
      fetch(concurrentUrl, { method: "POST", headers: { ...auth(adminToken), "Content-Type": "application/json" }, body: concurrentBody }),
      fetch(concurrentUrl, { method: "POST", headers: { ...auth(adminToken), "Content-Type": "application/json" }, body: concurrentBody }),
    ]);
    assert([200, 201].includes(concurrentA.status) && [200, 201].includes(concurrentB.status), "Concurrent istekler guvenli response donmeli.");
    const concurrentCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ai_finding_action_links WHERE company_id=$1 AND analysis_id=$2 AND finding_id='finding-concurrent'",
      [admin.company_id, concurrentId],
    );
    assert(Number(concurrentCount.rows[0]?.count) === 1, "Concurrent istekler tek link/aksiyon uretmeli.");
    assertions += 1;

    const reviewRequiredId = await insertAnalysis(pool, { companyId: admin.company_id, unitId: standard.unit_id, userId: admin.id, findingId: "finding-review", eligible: false });
    const reviewRequired = await fetch(`${server.baseUrl}/api/ai/analyses/${reviewRequiredId}/findings/finding-review/draft-action?companyId=${admin.company_id}&unitId=${standard.unit_id}&year=2026`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.rows[0].id, humanApproval: true }),
    });
    await expectStatus(reviewRequired, 409, "Not eligible rejected");
    assertions += 1;

    const invalidEvidenceId = await insertAnalysis(pool, { companyId: admin.company_id, unitId: standard.unit_id, userId: admin.id, findingId: "finding-evidence", evidenceSource: "fabricated" });
    const invalidEvidence = await fetch(`${server.baseUrl}/api/ai/analyses/${invalidEvidenceId}/findings/finding-evidence/draft-action?companyId=${admin.company_id}&unitId=${standard.unit_id}&year=2026`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.rows[0].id, humanApproval: true }),
    });
    await expectStatus(invalidEvidence, 409, "Invalid evidence rejected");
    assertions += 1;

    const processingId = await insertAnalysis(pool, { companyId: admin.company_id, unitId: standard.unit_id, userId: admin.id, findingId: "finding-processing", status: "processing" });
    const processing = await fetch(`${server.baseUrl}/api/ai/analyses/${processingId}/findings/finding-processing/draft-action?companyId=${admin.company_id}&unitId=${standard.unit_id}&year=2026`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.rows[0].id, humanApproval: true }),
    });
    await expectStatus(processing, 409, "Non completed rejected");
    assertions += 1;

    const standardCompanyScopeId = await insertAnalysis(pool, { companyId: admin.company_id, unitId: null, userId: admin.id, findingId: "finding-company" });
    const standardCompanyScope = await fetch(`${server.baseUrl}/api/ai/analyses/${standardCompanyScopeId}/findings/finding-company/draft-action?companyId=${admin.company_id}&year=2026`, {
      method: "POST",
      headers: { ...auth(standardToken), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.rows[0].id, humanApproval: true }),
    });
    await expectStatus(standardCompanyScope, 404, "Standard company scope rejected");
    assertions += 1;

    const superNoCompany = await fetch(`${server.baseUrl}/api/ai/analyses/${analysisId}/findings/finding-ok/draft-action?year=2026`, {
      method: "POST",
      headers: { ...auth(superToken), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.rows[0].id, humanApproval: true }),
    });
    await expectStatus(superNoCompany, 400, "Superadmin explicit company required");
    assertions += 1;

    const audit = await pool.query<{ serialized: string }>(
      "SELECT coalesce(metadata_json::text,'') || coalesce(changes_json::text,'') AS serialized FROM audit_events WHERE action='AI_FINDING_CONVERTED_TO_DRAFT_ACTION'",
    );
    const auditText = audit.rows.map((row) => row.serialized).join("\n").toLowerCase();
    assert(auditText.includes("finding-ok") && auditText.includes("actionid"), "Donusum audit metadata olusmali.");
    for (const forbidden of ["prompt", "context", "result_json", "api_key", "authorization", "basinc kaybi izleme uygulamasinin"]) {
      assert(!auditText.includes(forbidden), `Audit hassas/tam metin sizdirdi: ${forbidden}`);
    }
    assertions += 1;

    console.log(JSON.stringify({ aiDraftActionAssertions: assertions }));
  } finally {
    await server.close();
    await pool.end();
  }
}

await main();
