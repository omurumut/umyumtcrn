import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";

type LoginBody = { token?: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDisposableDatabase(): void {
  assert(process.env.NODE_ENV === "test", "Unit technical profile test NODE_ENV=test gerektirir.");
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Unit technical profile test disposable DB gerektirir.");
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

async function api(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...auth(token),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

async function patchProfile(baseUrl: string, token: string, unitId: number, body: Record<string, unknown>, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/unit-technical-profiles/${unitId}${query}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function main() {
  assertDisposableDatabase();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = await startServer();
  let assertions = 0;
  try {
    const userRows = await pool.query<{
      username: string;
      company_id: number;
      unit_id: number | null;
    }>(
      `SELECT username, company_id, unit_id FROM users
       WHERE username = ANY($1::text[])`,
      [[
        process.env.E2E_ADMIN_USERNAME,
        process.env.E2E_KONTROL_ADMIN_USERNAME,
        process.env.E2E_STANDARD_USERNAME,
        process.env.E2E_STANDARD_B_USERNAME,
        process.env.E2E_SUPERADMIN_USERNAME,
        process.env.E2E_ADMIN_USERNAME?.replace("_a", "_b"),
      ].filter(Boolean)],
    );
    const users = new Map(userRows.rows.map((row) => [row.username, row]));
    const adminUser = users.get(process.env.E2E_ADMIN_USERNAME!);
    const kontrolUser = users.get(process.env.E2E_KONTROL_ADMIN_USERNAME!);
    const standardUser = users.get(process.env.E2E_STANDARD_USERNAME!);
    const standardBUser = users.get(process.env.E2E_STANDARD_B_USERNAME!);
    const superadminUser = users.get(process.env.E2E_SUPERADMIN_USERNAME!);
    assert(adminUser && kontrolUser && standardUser && standardBUser && superadminUser, "Fixture kullanicilari eksik.");
    assert(standardUser.unit_id !== null && standardBUser.unit_id !== null, "Standard fixture unit eksik.");

    const unitRows = await pool.query<{ id: number; company_id: number; name: string }>(
      "SELECT id, company_id, name FROM units WHERE name LIKE '[E2E] Unit%' ORDER BY company_id, id",
    );
    const tenantAUnits = unitRows.rows.filter((unit) => unit.company_id === adminUser.company_id);
    const unitA1 = tenantAUnits.find((unit) => unit.id === standardUser.unit_id);
    const unitA2 = tenantAUnits.find((unit) => unit.id !== standardUser.unit_id);
    const unitB1 = unitRows.rows.find((unit) => unit.company_id === standardBUser.company_id);
    assert(unitA1 && unitA2 && unitB1, "Fixture unitleri eksik.");

    const adminToken = await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!);
    const kontrolToken = await login(server.baseUrl, process.env.E2E_KONTROL_ADMIN_USERNAME!);
    const standardToken = await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!);
    const standardBToken = await login(server.baseUrl, process.env.E2E_STANDARD_B_USERNAME!);
    const superadminToken = await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);

    const emptyGet = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}`);
    assert(emptyGet.status === 200, `Bos GET 200 yerine ${emptyGet.status}`);
    const emptyBody = await json(emptyGet);
    assert(emptyBody.profile.exists === false && emptyBody.profile.profileVersion === 0, "Virtual profil sozlesmesi bozuk.");
    const noWrite = await pool.query("SELECT id FROM unit_technical_profiles WHERE unit_id=$1", [unitA1.id]);
    assert(noWrite.rowCount === 0, "GET virtual profil DB kaydi olusturdu.");
    assertions += 3;

    const createdRes = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 0,
      facilityUseType: "production",
      mainActivity: "Assembly",
      dailyOperatingHours: 16,
      weeklyOperatingDays: 6,
      profileStatus: "draft",
    });
    assert(createdRes.status === 200, `Admin create 200 yerine ${createdRes.status}`);
    const created = await json(createdRes);
    assert(created.profile.exists === true && created.profile.profileVersion === 1, "Create version 1 donmedi.");
    assertions += 2;

    const updatedRes = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 1,
      mainActivity: "Assembly and packaging",
      profileStatus: "published",
    });
    assert(updatedRes.status === 200, `Admin update 200 yerine ${updatedRes.status}`);
    const updated = await json(updatedRes);
    assert(updated.profile.profileVersion === 2 && updated.profile.profileStatus === "published", "Update version/status sozlesmesi bozuk.");
    assertions += 2;

    const staleRes = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 1,
      mainActivity: "Stale write",
    });
    assert(staleRes.status === 409, `Stale update 409 yerine ${staleRes.status}`);
    const stale = await json(staleRes);
    assert(stale.profile.profileVersion === 2, "Conflict response mevcut version icermiyor.");
    assertions += 2;

    const duplicateCreates = await Promise.all([
      patchProfile(server.baseUrl, adminToken, unitA2.id, { expectedProfileVersion: 0, mainActivity: "A2 first" }),
      patchProfile(server.baseUrl, adminToken, unitA2.id, { expectedProfileVersion: 0, mainActivity: "A2 second" }),
    ]);
    const duplicateStatuses = duplicateCreates.map((response) => response.status).sort();
    assert(JSON.stringify(duplicateStatuses) === "[200,409]", `Duplicate create beklenmedik: ${duplicateStatuses}`);
    const duplicateCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM unit_technical_profiles WHERE unit_id=$1",
      [unitA2.id],
    );
    assert(Number(duplicateCount.rows[0]?.count) === 1, "Duplicate profile kaydi olustu.");
    assertions += 2;

    const standardGet = await api(server.baseUrl, standardToken, `/api/unit-technical-profiles/${unitA1.id}`);
    assert(standardGet.status === 200, "Standard kendi unit GET basarisiz.");
    const standardPatch = await patchProfile(server.baseUrl, standardToken, unitA1.id, {
      expectedProfileVersion: 2,
      knownEnergyIssues: "Compressed air leakage",
    });
    assert(standardPatch.status === 200, `Standard kendi unit PATCH basarisiz: ${standardPatch.status}`);
    const standardUpdated = await json(standardPatch);
    assert(standardUpdated.profile.profileVersion === 3, "Standard patch version artirmadi.");
    const standardOtherGet = await api(server.baseUrl, standardToken, `/api/unit-technical-profiles/${unitA2.id}`);
    assert(standardOtherGet.status === 403, "Standard baska unit GET reddedilmedi.");
    const standardOtherPatch = await patchProfile(server.baseUrl, standardToken, unitA2.id, { expectedProfileVersion: 1, mainActivity: "Forbidden" });
    assert(standardOtherPatch.status === 403, "Standard baska unit PATCH reddedilmedi.");
    const standardPublish = await patchProfile(server.baseUrl, standardToken, unitA1.id, { expectedProfileVersion: 3, profileStatus: "published" });
    assert(standardPublish.status === 403, "Standard published status yazabildi.");
    assertions += 6;

    const adminOtherGet = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA2.id}`);
    assert(adminOtherGet.status === 200, "Admin kendi sirketindeki diger unit GET basarisiz.");
    const adminCrossTenant = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitB1.id}`);
    assert(adminCrossTenant.status === 404, "Admin baska tenant unitine erisebildi.");
    assertions += 2;

    const kontrolUpdate = await patchProfile(server.baseUrl, kontrolToken, unitA2.id, {
      expectedProfileVersion: 1,
      mainActivity: "Kontrol admin update",
      profileStatus: "published",
    });
    assert(kontrolUpdate.status === 200, `kontrol_admin write/publish basarisiz: ${kontrolUpdate.status}`);
    const kontrolBody = await json(kontrolUpdate);
    assert(kontrolBody.profile.profileVersion === 2 && kontrolBody.profile.profileStatus === "published", "kontrol_admin version/status bozuk.");
    assertions += 2;

    const superNoContext = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitA1.id}`);
    assert(superNoContext.status === 400, "Superadmin context olmadan basarili oldu.");
    const superWithContext = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitA1.id}?companyId=${adminUser.company_id}`);
    assert(superWithContext.status === 200, "Superadmin explicit company context ile basarisiz.");
    const superWrongContext = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitB1.id}?companyId=${adminUser.company_id}`);
    assert(superWrongContext.status === 403, "Superadmin yanlis company-unit eslesmesi reddedilmedi.");
    const superTenantB = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitB1.id}?companyId=${standardBUser.company_id}`);
    assert(superTenantB.status === 200, "Superadmin tenant B explicit context basarisiz.");
    assertions += 4;

    for (const forbiddenField of ["companyId", "unitId", "profileVersion", "createdBy", "updatedBy"]) {
      const massAssignment = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
        expectedProfileVersion: 3,
        [forbiddenField]: 999,
      });
      assert(massAssignment.status === 400, `Mass assignment ${forbiddenField} reddedilmedi.`);
      assertions += 1;
    }

    for (const [field, value] of [
      ["buildingCount", -1],
      ["dailyOperatingHours", 25],
      ["weeklyOperatingDays", 8],
      ["mainProcessDescription", "x".repeat(2001)],
      ["generatorStatus", "maybe"],
    ] as const) {
      const validation = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
        expectedProfileVersion: 3,
        [field]: value,
      });
      assert(validation.status === 400, `Validation ${field} reddedilmedi.`);
      assertions += 1;
    }

    const standardBGet = await api(server.baseUrl, standardBToken, `/api/unit-technical-profiles/${unitB1.id}`);
    assert(standardBGet.status === 200, "Tenant B kendi unit GET basarisiz.");
    const tenantLeak = await api(server.baseUrl, standardBToken, `/api/unit-technical-profiles/${unitA1.id}`);
    assert(tenantLeak.status === 403, "Tenant izolasyonu standard B -> A reddedilmedi.");
    assertions += 2;

    const audits = await pool.query<{
      action: string;
      changes_text: string | null;
    }>(
      `SELECT action, changes_json::text AS changes_text
       FROM audit_events
       WHERE entity_type='unit_technical_profile' AND unit_id=$1
       ORDER BY occurred_at, id`,
      [unitA1.id],
    );
    const auditRows = audits.rows.map((row) => ({
      action: row.action,
      changes: row.changes_text ? JSON.parse(row.changes_text) as { changedFields?: string[]; previousVersion?: number; newVersion?: number } : null,
    }));
    assert(audits.rows.some((row) => row.action === "unit_technical_profile.created"), "Create audit yok.");
    assert(audits.rows.some((row) => row.action === "unit_technical_profile.published"), "Publish audit yok.");
    assert(auditRows.some((row) => row.changes?.changedFields?.includes("knownEnergyIssues")), `Changed fields audit yok: ${JSON.stringify(auditRows)}`);
    assert(
      auditRows.some((row) => Number.isInteger(row.changes?.previousVersion) && Number.isInteger(row.changes?.newVersion)),
      `Audit version metadata yok: ${JSON.stringify(auditRows)}`,
    );
    assertions += 4;

    console.log(JSON.stringify({ ok: true, assertions }, null, 2));
  } finally {
    await server.close().catch(() => undefined);
    await pool.end();
  }
}

await main();
