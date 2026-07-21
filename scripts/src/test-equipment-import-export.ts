import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { Pool } from "pg";

type LoginBody = { token?: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDisposableDatabase(): void {
  assert(process.env.NODE_ENV === "test", "Equipment import/export test NODE_ENV=test gerektirir.");
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Equipment import/export test disposable DB gerektirir.");
  const rawUrl = process.env.DATABASE_URL;
  assert(rawUrl, "DATABASE_URL yok.");
  const url = new URL(rawUrl);
  assert(url.hostname === "127.0.0.1", "Test yalniz localhost disposable DB kullanir.");
  assert(url.pathname === "/iso50001_test", "Test DB adi gecersiz.");
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function startServer(): Promise<{ baseUrl: string; logs: () => string; close: () => Promise<void> }> {
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
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API erken kapandi: ${output.slice(-500)}`);
    try {
      if ((await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(500) })).status === 200) {
        return {
          baseUrl,
          logs: () => output,
          close: async () => {
            if (child.exitCode !== null || child.signalCode !== null) return;
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
  throw new Error(`API readiness zaman asimi: ${output.slice(-1_000)}`);
}

async function login(baseUrl: string, username: string): Promise<string> {
  const password = process.env.E2E_TEST_PASSWORD;
  assert(password, "E2E_TEST_PASSWORD yok.");
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert(response.status === 200, `${username} login 200 yerine ${response.status}`);
  const body = await response.json() as LoginBody;
  assert(typeof body.token === "string", `${username} token alamadi.`);
  return body.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function json(response: Response): Promise<any> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function responseSummary(response: Response): Promise<string> {
  const text = await response.clone().text();
  return text.length > 2_000 ? `${text.slice(0, 2_000)}...` : text || "<empty>";
}

async function expectStatus(response: Response, expected: number, message: string) {
  assert(response.status === expected, `${message} beklenen ${expected}, alinan ${response.status}: ${await responseSummary(response)}`);
}

async function workbookBuffer(rows: Array<Record<string, unknown>>) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Ekipmanlar");
  const headers = [
    "equipment_code",
    "name",
    "equipment_kind",
    "category",
    "status",
    "unit_code",
    "measurement_method",
    "measurement_confidence",
    "installed_power_kw",
    "is_energy_intensive",
    "is_critical",
    "equipment_version",
  ];
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((header) => row[header] ?? null));
  workbook.addWorksheet("Ekipman-Sayac").addRow(["equipment_code", "meter_code", "relation_role", "is_primary", "share_percent", "measurement_confidence"]);
  workbook.addWorksheet("Ekipman-Enerji").addRow(["equipment_code", "energy_source_code", "relation_role", "is_primary", "share_percent", "measurement_confidence"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function uploadWorkbook(baseUrl: string, token: string, endpoint: "preview" | "apply", buffer: Buffer, previewHash?: string) {
  const formData = new FormData();
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  formData.append("file", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "equipment.xlsx");
  if (previewHash) formData.append("previewHash", previewHash);
  return fetch(`${baseUrl}/api/equipment/import/${endpoint}`, {
    method: "POST",
    headers: auth(token),
    body: formData,
  });
}

async function main() {
  assertDisposableDatabase();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = await startServer();
  let assertions = 0;
  try {
    const adminToken = await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!);
    const standardToken = await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!);
    const superadminToken = await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);
    const users = await pool.query<{ username: string; company_id: number; unit_id: number | null }>(
      `SELECT username, company_id, unit_id FROM users WHERE username = ANY($1::text[])`,
      [[process.env.E2E_ADMIN_USERNAME, process.env.E2E_STANDARD_USERNAME].filter(Boolean)],
    );
    const admin = users.rows.find((row) => row.username === process.env.E2E_ADMIN_USERNAME);
    const standard = users.rows.find((row) => row.username === process.env.E2E_STANDARD_USERNAME);
    assert(admin && standard?.unit_id, "Fixture kullanicilari eksik.");

    const template = await fetch(`${server.baseUrl}/api/equipment/import/template`, { headers: auth(adminToken) });
    await expectStatus(template, 200, "Admin template");
    assert((template.headers.get("content-type") ?? "").includes("spreadsheetml"), "Template XLSX content-type donmeli");
    assertions += 2;

    const superNoContext = await fetch(`${server.baseUrl}/api/equipment/import/template`, { headers: auth(superadminToken) });
    await expectStatus(superNoContext, 400, "Superadmin context olmadan template alamamali");
    assertions += 1;

    const suffix = Date.now();
    const equipmentCode = `EQ3D6-${suffix}`;
    const createBuffer = await workbookBuffer([{
      equipment_code: equipmentCode,
      name: "[E2E] Import pump",
      equipment_kind: "physical",
      category: "pump",
      status: "active",
      unit_code: `unit:${standard.unit_id}`,
      measurement_method: "direct",
      measurement_confidence: "high",
      installed_power_kw: 0,
      is_energy_intensive: "no",
      is_critical: "no",
    }]);
    const previewRes = await uploadWorkbook(server.baseUrl, adminToken, "preview", createBuffer);
    await expectStatus(previewRes, 200, "Create preview");
    const preview = await json(previewRes);
    assert(preview.canApply === true && preview.createCount === 1 && preview.previewHash, "Preview create sayaci/hash bozuk");
    assertions += 2;

    const changedBuffer = await workbookBuffer([{ equipment_code: `${equipmentCode}-MUT`, name: "changed", category: "pump", unit_code: `unit:${standard.unit_id}` }]);
    const hashMismatch = await uploadWorkbook(server.baseUrl, adminToken, "apply", changedBuffer, preview.previewHash);
    await expectStatus(hashMismatch, 409, "Hash mismatch apply reddedilmeli");
    assertions += 1;

    const applyRes = await uploadWorkbook(server.baseUrl, adminToken, "apply", createBuffer, preview.previewHash);
    await expectStatus(applyRes, 200, "Create apply");
    const applyBody = await json(applyRes);
    assert(applyBody.createCount === 1, "Apply create count bozuk");
    const dbRow = await pool.query<{ id: number; equipment_version: number; installed_power_kw: number | null }>(
      "SELECT id, equipment_version, installed_power_kw FROM equipment WHERE company_id=$1 AND equipment_code=$2",
      [admin.company_id, equipmentCode],
    );
    assert(dbRow.rows[0]?.equipment_version === 1 && dbRow.rows[0].installed_power_kw === 0, "Import create DB sonucu bozuk");
    assertions += 3;

    const exportRes = await fetch(`${server.baseUrl}/api/equipment/export?unitId=${standard.unit_id}&search=${equipmentCode}`, { headers: auth(adminToken) });
    await expectStatus(exportRes, 200, "Export");
    const exportBook = new ExcelJS.Workbook();
    await exportBook.xlsx.load(await exportRes.arrayBuffer());
    const exportSheet = exportBook.getWorksheet("Ekipmanlar");
    assert(exportSheet?.getRow(2).values.toString().includes(equipmentCode), "Export ekipman kodunu icermeli");
    assertions += 2;

    const updateBuffer = await workbookBuffer([{
      equipment_code: equipmentCode,
      name: "[E2E] Import pump updated",
      equipment_kind: "physical",
      category: "pump",
      status: "active",
      unit_code: `unit:${standard.unit_id}`,
      installed_power_kw: 0,
      is_energy_intensive: "yes",
      is_critical: "no",
      equipment_version: 1,
    }]);
    const updatePreviewRes = await uploadWorkbook(server.baseUrl, adminToken, "preview", updateBuffer);
    await expectStatus(updatePreviewRes, 200, "Update preview");
    const updatePreview = await json(updatePreviewRes);
    assert(updatePreview.updateCount === 1 && updatePreview.canApply, "Update preview bozuk");
    const updateApplyRes = await uploadWorkbook(server.baseUrl, adminToken, "apply", updateBuffer, updatePreview.previewHash);
    await expectStatus(updateApplyRes, 200, "Update apply");
    const updated = await pool.query<{ equipment_version: number; is_energy_intensive: boolean }>(
      "SELECT equipment_version, is_energy_intensive FROM equipment WHERE company_id=$1 AND equipment_code=$2",
      [admin.company_id, equipmentCode],
    );
    assert(updated.rows[0]?.equipment_version === 2 && updated.rows[0].is_energy_intensive === true, "Import update DB sonucu bozuk");
    assertions += 4;

    const stalePreviewRes = await uploadWorkbook(server.baseUrl, adminToken, "preview", updateBuffer);
    const stalePreview = await json(stalePreviewRes);
    assert(stalePreview.errorCount > 0 && stalePreview.issues.some((item: any) => item.code === "version_conflict"), "Stale version preview conflict uretmeli");
    assertions += 1;

    const formulaBuffer = await workbookBuffer([{
      equipment_code: `EQ3D6-FORMULA-${suffix}`,
      name: "=HYPERLINK(\"http://example.test\")",
      category: "pump",
      unit_code: `unit:${standard.unit_id}`,
    }]);
    const formulaPreview = await uploadWorkbook(server.baseUrl, adminToken, "preview", formulaBuffer);
    await expectStatus(formulaPreview, 200, "Formula preview response");
    const formulaBody = await json(formulaPreview);
    assert(formulaBody.errorCount > 0 && formulaBody.issues.some((item: any) => item.code === "formula_not_allowed"), "Formula injection reddedilmeli");
    assertions += 2;

    const standardCrossUnit = await workbookBuffer([{
      equipment_code: `EQ3D6-CROSS-${suffix}`,
      name: "Cross",
      category: "pump",
      unit_code: `unit:${standard.unit_id + 999999}`,
    }]);
    const crossPreview = await uploadWorkbook(server.baseUrl, standardToken, "preview", standardCrossUnit);
    await expectStatus(crossPreview, 200, "Standard cross preview");
    const crossBody = await json(crossPreview);
    assert(crossBody.errorCount > 0, "Standard baska unit preview reddedilmeli");
    assertions += 2;

    const audit = await pool.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE action IN ('equipment.imported','equipment.exported') AND company_id=$1",
      [admin.company_id],
    );
    assert(audit.rows.some((row) => row.action === "equipment.imported"), "Import audit yok");
    assert(audit.rows.some((row) => row.action === "equipment.exported"), "Export audit yok");
    assertions += 2;

    console.log(JSON.stringify({ ok: true, assertions }, null, 2));
  } finally {
    await server.close().catch((error) => {
      console.error(`API shutdown hatasi: ${String(error)}`);
      console.error(server.logs().slice(-1_000));
    });
    await pool.end();
  }
}

await main();
