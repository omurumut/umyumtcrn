import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";

type LoginBody = { token?: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDisposableDatabase(): void {
  assert(process.env.NODE_ENV === "test", "Equipment context test NODE_ENV=test gerektirir.");
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Equipment context test disposable DB gerektirir.");
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

    const otherUnit = await pool.query<{ id: number }>(
      "SELECT id FROM units WHERE company_id=$1 AND id<>$2 LIMIT 1",
      [admin.company_id, standard.unit_id],
    );
    assert(otherUnit.rows[0], "Standart kullanici unit scope testi icin ikinci unit eksik.");

    const superNoCompany = await fetch(`${server.baseUrl}/api/dashboard/equipment-context?year=2026`, { headers: auth(superadminToken) });
    await expectStatus(superNoCompany, 400, "Superadmin companyId olmadan dashboard equipment context alamamali");
    assertions += 1;

    const adminDashboard = await fetch(`${server.baseUrl}/api/dashboard/equipment-context?year=2026&companyId=${admin.company_id}`, { headers: auth(adminToken) });
    await expectStatus(adminDashboard, 200, "Admin dashboard equipment context");
    const adminDashboardBody = await json(adminDashboard);
    assert(adminDashboardBody.source.contextType === "equipment_inventory", "Dashboard context source type bozuk");
    assert(adminDashboardBody.source.sourcePolicy === "current_inventory", "Dashboard source policy bozuk");
    assert(Array.isArray(adminDashboardBody.highlights), "Dashboard highlights array olmali");
    assertions += 3;

    const serializedDashboard = JSON.stringify(adminDashboardBody).toLowerCase();
    for (const forbidden of ["serialnumber", "serial_number", "assetcode", "asset_code", "technicalnotes", "maintenance_notes"]) {
      assert(!serializedDashboard.includes(forbidden), `Dashboard context hassas alan sizdirdi: ${forbidden}`);
      assertions += 1;
    }

    const standardForbiddenUnit = await fetch(`${server.baseUrl}/api/dashboard/equipment-context?unitId=${otherUnit.rows[0].id}`, { headers: auth(standardToken) });
    await expectStatus(standardForbiddenUnit, 403, "Standart kullanici baska unit equipment context alamamali");
    assertions += 1;

    const review = await fetch(`${server.baseUrl}/api/energy-review/overview?year=2026&companyId=${admin.company_id}`, { headers: auth(adminToken) });
    await expectStatus(review, 200, "Energy Review overview equipment context");
    const reviewBody = await json(review);
    assert(reviewBody.equipmentInventoryContext?.source?.contextType === "equipment_inventory", "Energy Review equipment context yok");
    assert(reviewBody.equipmentInventoryContext?.readiness?.status, "Energy Review readiness yok");
    assertions += 2;

    const ai = await fetch(`${server.baseUrl}/api/ai/suggestions`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ focus: "genel", year: 2026, companyId: admin.company_id }),
    });
    await expectStatus(ai, 200, "AI suggestions equipment readiness");
    const aiBody = await json(ai);
    assert(aiBody.equipmentInventoryReadiness?.source?.contextType === "equipment_inventory", "AI equipment readiness source yok");
    assert(aiBody.equipmentInventoryReadiness?.source?.includedCount === 0, "AI readiness item listesi tasimamali");
    assert(!JSON.stringify(aiBody.equipmentInventoryReadiness).includes('"items"'), "AI readiness items sizdirmemeli");
    assertions += 3;

    console.log(`Equipment context integration smoke passed (${assertions} assertions).`);
  } finally {
    await pool.end();
    await server.close().catch((error) => {
      throw new Error(`API kapatilamadi: ${error instanceof Error ? error.message : String(error)}\n${server.logs().slice(-1_000)}`);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
