import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";

type LoginBody = { token?: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDisposableDatabase(): void {
  assert(process.env.NODE_ENV === "test", "Equipment inventory test NODE_ENV=test gerektirir.");
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Equipment inventory test disposable DB gerektirir.");
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
  if (!text) return "<empty>";
  return text.length > 2_000 ? `${text.slice(0, 2_000)}...` : text;
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

async function expectStatus(response: Response, expected: number, message: string) {
  assert(response.status === expected, `${message} beklenen ${expected}, alinan ${response.status}: ${await responseSummary(response)}`);
}

async function expectStatusIn(response: Response, allowed: number[], message: string) {
  assert(allowed.includes(response.status), `${message} beklenen ${allowed.join("/")}, alinan ${response.status}: ${await responseSummary(response)}`);
}

async function postEquipment(baseUrl: string, token: string, body: Record<string, unknown>, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/equipment${query}`, { method: "POST", body: JSON.stringify(body) });
}

async function patchEquipment(baseUrl: string, token: string, id: number, body: Record<string, unknown>, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/equipment/${id}${query}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function archiveEquipment(baseUrl: string, token: string, id: number, expectedEquipmentVersion: number, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/equipment/${id}/archive${query}`, {
    method: "POST",
    body: JSON.stringify({ expectedEquipmentVersion, reason: "E2E archive" }),
  });
}

async function archiveEquipmentWithBody(baseUrl: string, token: string, id: number, body: Record<string, unknown>, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/equipment/${id}/archive${query}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function reactivateEquipment(baseUrl: string, token: string, id: number, expectedEquipmentVersion: number, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/equipment/${id}/reactivate${query}`, {
    method: "POST",
    body: JSON.stringify({ expectedEquipmentVersion, status: "active" }),
  });
}

async function main() {
  assertDisposableDatabase();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = await startServer();
  let assertions = 0;
  try {
    const userRows = await pool.query<{ username: string; company_id: number; unit_id: number | null }>(
      `SELECT username, company_id, unit_id FROM users WHERE username = ANY($1::text[])`,
      [[
        process.env.E2E_ADMIN_USERNAME,
        process.env.E2E_KONTROL_ADMIN_USERNAME,
        process.env.E2E_STANDARD_USERNAME,
        process.env.E2E_STANDARD_B_USERNAME,
        process.env.E2E_SUPERADMIN_USERNAME,
      ].filter(Boolean)],
    );
    const users = new Map(userRows.rows.map((row) => [row.username, row]));
    const adminUser = users.get(process.env.E2E_ADMIN_USERNAME!);
    const standardUser = users.get(process.env.E2E_STANDARD_USERNAME!);
    const standardBUser = users.get(process.env.E2E_STANDARD_B_USERNAME!);
    const superadminUser = users.get(process.env.E2E_SUPERADMIN_USERNAME!);
    assert(adminUser && standardUser && standardBUser && superadminUser, "Fixture kullanicilari eksik.");
    assert(standardUser.unit_id !== null && standardBUser.unit_id !== null, "Standard fixture unit eksik.");

    const unitRows = await pool.query<{ id: number; company_id: number; name: string }>(
      "SELECT id, company_id, name FROM units WHERE name LIKE '[E2E] Unit%' ORDER BY company_id, id",
    );
    const tenantAUnits = unitRows.rows.filter((unit) => unit.company_id === adminUser.company_id);
    const unitA1 = tenantAUnits.find((unit) => unit.id === standardUser.unit_id);
    const unitA2 = tenantAUnits.find((unit) => unit.id !== standardUser.unit_id);
    const unitB1 = unitRows.rows.find((unit) => unit.company_id === standardBUser.company_id);
    assert(unitA1 && unitA2 && unitB1, "Fixture unitleri eksik.");

    const subUnitA = await pool.query<{ id: number }>("SELECT id FROM sub_units WHERE company_id=$1 AND unit_id=$2 LIMIT 1", [adminUser.company_id, unitA1.id]);
    const subUnitB = await pool.query<{ id: number }>("SELECT id FROM sub_units WHERE company_id=$1 AND unit_id=$2 LIMIT 1", [standardBUser.company_id, unitB1.id]);
    const meterA = await pool.query<{ id: number }>("SELECT id FROM meters WHERE company_id=$1 AND unit_id=$2 LIMIT 1", [adminUser.company_id, unitA1.id]);
    const meterB = await pool.query<{ id: number }>("SELECT id FROM meters WHERE company_id=$1 AND unit_id=$2 LIMIT 1", [standardBUser.company_id, unitB1.id]);
    const sourceA = await pool.query<{ id: number }>("SELECT id FROM energy_sources WHERE company_id=$1 AND unit_id=$2 LIMIT 1", [adminUser.company_id, unitA1.id]);
    const sourceB = await pool.query<{ id: number }>("SELECT id FROM energy_sources WHERE company_id=$1 AND unit_id=$2 LIMIT 1", [standardBUser.company_id, unitB1.id]);
    const groupA = await pool.query<{ id: number }>(
      `SELECT id FROM energy_use_groups
       WHERE company_id=$1
         AND (unit_id=$2 OR unit_id IS NULL)
         AND (sub_unit_id=$3 OR sub_unit_id IS NULL)
       ORDER BY
         CASE WHEN unit_id=$2 THEN 0 ELSE 1 END,
         CASE WHEN sub_unit_id=$3 THEN 0 ELSE 1 END
       LIMIT 1`,
      [adminUser.company_id, unitA1.id, subUnitA.rows[0]?.id],
    );
    assert(subUnitA.rows[0] && subUnitB.rows[0] && meterA.rows[0] && meterB.rows[0] && sourceA.rows[0] && sourceB.rows[0], "Ekipman fixture iliskileri eksik.");

    const extraSourceA = await pool.query<{ id: number }>(
      `INSERT INTO energy_sources (company_id, unit_id, type, name, unit, active)
       VALUES ($1, $2, 'elektrik', $3, 'kWh', true)
       RETURNING id`,
      [adminUser.company_id, unitA1.id, `[E2E] Equipment relation source ${Date.now()}`],
    );
    const extraMeterA = await pool.query<{ id: number }>(
      `INSERT INTO meters (company_id, unit_id, sub_unit_id, energy_source_id, name, type, record_type, location, city, unit)
       VALUES ($1, $2, $3, $4, $5, 'elektrik', 'physical_meter', 'E2E relation', 'Istanbul', 'kWh')
       RETURNING id`,
      [adminUser.company_id, unitA1.id, subUnitA.rows[0].id, extraSourceA.rows[0].id, `[E2E] Equipment relation meter ${Date.now()}`],
    );
    const unitA2Source = await pool.query<{ id: number }>(
      `INSERT INTO energy_sources (company_id, unit_id, type, name, unit, active)
       VALUES ($1, $2, 'dogalgaz', $3, 'm3', true)
       RETURNING id`,
      [adminUser.company_id, unitA2.id, `[E2E] Cross unit relation source ${Date.now()}`],
    );
    const unitA2Meter = await pool.query<{ id: number }>(
      `INSERT INTO meters (company_id, unit_id, energy_source_id, name, type, record_type, location, city, unit)
       VALUES ($1, $2, $3, $4, 'dogalgaz', 'physical_meter', 'E2E relation', 'Istanbul', 'm3')
       RETURNING id`,
      [adminUser.company_id, unitA2.id, unitA2Source.rows[0].id, `[E2E] Cross unit relation meter ${Date.now()}`],
    );
    const generalGroup = await pool.query<{ id: number }>(
      `INSERT INTO energy_use_groups (company_id, name, code, group_type, unit_id, sub_unit_id, is_active)
       VALUES ($1, $2, $3, 'process', $4, NULL, true)
       RETURNING id`,
      [adminUser.company_id, `[E2E] Equipment general group ${Date.now()}`, `EQ-GEN-${Date.now()}`, unitA1.id],
    );
    const sameSubUnitGroup = await pool.query<{ id: number }>(
      `INSERT INTO energy_use_groups (company_id, name, code, group_type, unit_id, sub_unit_id, is_active)
       VALUES ($1, $2, $3, 'process', $4, $5, true)
       RETURNING id`,
      [adminUser.company_id, `[E2E] Equipment sub group ${Date.now()}`, `EQ-SUB-${Date.now()}`, unitA1.id, subUnitA.rows[0].id],
    );
    const otherSubUnit = await pool.query<{ id: number }>(
      `INSERT INTO sub_units (company_id, unit_id, name, description)
       VALUES ($1, $2, $3, 'Equipment relation test')
       RETURNING id`,
      [adminUser.company_id, unitA1.id, `[E2E] Other SubUnit ${Date.now()}`],
    );
    const otherSubUnitGroup = await pool.query<{ id: number }>(
      `INSERT INTO energy_use_groups (company_id, name, code, group_type, unit_id, sub_unit_id, is_active)
       VALUES ($1, $2, $3, 'process', $4, $5, true)
       RETURNING id`,
      [adminUser.company_id, `[E2E] Equipment other sub group ${Date.now()}`, `EQ-OSUB-${Date.now()}`, unitA1.id, otherSubUnit.rows[0].id],
    );

    const adminToken = await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!);
    const standardToken = await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!);
    const standardBToken = await login(server.baseUrl, process.env.E2E_STANDARD_B_USERNAME!);
    const superadminToken = await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);

    const suffix = Date.now();
    const baseCreate = {
      unitId: unitA1.id,
      subUnitId: subUnitA.rows[0].id,
      equipmentCode: `EQ3D1-${suffix}`,
      name: "[E2E] Main pump",
      equipmentKind: "physical",
      category: "pump",
      status: "active",
      locationText: "Boiler room",
      energyUseGroupId: groupA.rows[0]?.id,
      measurementMethod: "direct",
      measurementConfidence: "high",
      installedPowerKw: 0,
      operationalStatus: "unknown",
      seasonalOperationStatus: "not_applicable",
      isEnergyIntensive: true,
      isCritical: false,
      meterLinks: [{ meterId: meterA.rows[0].id, relationRole: "direct", isPrimary: true }],
      energySourceLinks: [{ energySourceId: sourceA.rows[0].id, relationRole: "primary", isPrimary: true }],
    };

    const superNoContext = await api(server.baseUrl, superadminToken, "/api/equipment");
    await expectStatus(superNoContext, 400, "Superadmin company context olmadan listeleyememeli");
    const superWithContext = await api(server.baseUrl, superadminToken, `/api/equipment?companyId=${adminUser.company_id}`);
    await expectStatus(superWithContext, 200, "Superadmin company context ile listeleyebilmeli");
    assertions += 2;

    for (const forbiddenField of ["companyId", "equipmentVersion", "createdBy", "permissions"]) {
      const response = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D1-MASS-${forbiddenField}-${suffix}`, [forbiddenField]: 999 });
      await expectStatus(response, 400, `Mass assignment ${forbiddenField} reddedilmeli`);
      assertions += 1;
    }

    const createdRes = await postEquipment(server.baseUrl, adminToken, baseCreate);
    if (createdRes.status !== 201) {
      throw new Error(`Admin ekipman create beklenen 201, alinan ${createdRes.status}: ${await responseSummary(createdRes)}`);
    }
    await expectStatus(createdRes, 201, "Admin ekipman create");
    const created = await json(createdRes);
    const equipmentId = created.equipment.id as number;
    assert(created.equipment.equipmentVersion === 1, "Create version 1 donmedi.");
    assert(created.equipment.installedPowerKw === 0 && created.equipment.operationalStatus === "unknown", "0/unknown alanlari korunmadi.");
    assert(created.meterLinks.length === 1 && created.energySourceLinks.length === 1, "Linkler olusmadi.");
    assertions += 4;

    const validLifecycle = await postEquipment(server.baseUrl, adminToken, {
      ...baseCreate,
      equipmentCode: `EQ3D5-LIFE-OK-${suffix}`,
      purchaseDate: "2020-02-29",
      commissioningDate: "2030-01-15",
      manufactureYear: 2020,
      expectedLifeYears: 0,
      plannedReplacementYear: 2031,
    });
    await expectStatus(validLifecycle, 201, "Valid lifecycle dates ve future commissioning desteklenmeli");
    const validLifecycleBody = await json(validLifecycle);
    assert(validLifecycleBody.equipment.purchaseDate === "2020-02-29" && validLifecycleBody.equipment.commissioningDate === "2030-01-15", "Date-only degerler korunmadi.");
    const invalidManufactureYear = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D5-LIFE-MFG-${suffix}`, manufactureYear: 3000 });
    await expectStatus(invalidManufactureYear, 400, "Makul olmayan uretim yili reddedilmeli");
    const replacementBeforeManufacture = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D5-LIFE-REPL-MFG-${suffix}`, manufactureYear: 2020, plannedReplacementYear: 2019 });
    await expectStatus(replacementBeforeManufacture, 400, "Yenileme yili uretim yilindan once olamaz");
    const replacementBeforeCommissioning = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D5-LIFE-REPL-COM-${suffix}`, commissioningDate: "2025-01-01", plannedReplacementYear: 2024 });
    await expectStatus(replacementBeforeCommissioning, 400, "Yenileme yili devreye alma yilindan once olamaz");
    assertions += 5;

    const relationCreateRes = await postEquipment(server.baseUrl, adminToken, {
      ...baseCreate,
      equipmentCode: `EQ3D3-REL-${suffix}`,
      energyUseGroupId: sameSubUnitGroup.rows[0].id,
      meterLinks: [
        { meterId: meterA.rows[0].id, relationRole: "direct", isPrimary: true, sharePercent: 0, measurementConfidence: "high" },
        { meterId: extraMeterA.rows[0].id, relationRole: "shared", isPrimary: false, sharePercent: 100, measurementConfidence: "low" },
      ],
      energySourceLinks: [
        { energySourceId: sourceA.rows[0].id, relationRole: "primary", isPrimary: true, sharePercent: 0, measurementConfidence: "medium" },
        { energySourceId: extraSourceA.rows[0].id, relationRole: "backup", isPrimary: false, sharePercent: 100, measurementConfidence: "unknown" },
      ],
    });
    await expectStatus(relationCreateRes, 201, "Iki meter/source link ile create");
    const relationCreated = await json(relationCreateRes);
    const relationEquipmentId = relationCreated.equipment.id as number;
    assert(relationCreated.meterLinks.length === 2 && relationCreated.energySourceLinks.length === 2, "Coklu relation create donmedi.");
    assert(relationCreated.meterLinks.some((link: any) => link.sharePercent === 0) && relationCreated.meterLinks.some((link: any) => link.sharePercent === 100), "Meter share 0/100 korunmadi.");
    assert(relationCreated.energySourceLinks.some((link: any) => link.sharePercent === 0) && relationCreated.energySourceLinks.some((link: any) => link.sharePercent === 100), "Source share 0/100 korunmadi.");
    assert(relationCreated.meterLinks.filter((link: any) => link.isPrimary).length === 1 && relationCreated.energySourceLinks.filter((link: any) => link.isPrimary).length === 1, "Primary tekilligi bozuk.");
    assert(relationCreated.meterLinks.every((link: any) => link.meterName), "Detail meter label donmedi.");
    assertions += 6;

    const duplicateSource = await postEquipment(server.baseUrl, adminToken, {
      ...baseCreate,
      equipmentCode: `EQ3D3-DUP-SRC-${suffix}`,
      energySourceLinks: [{ energySourceId: sourceA.rows[0].id }, { energySourceId: sourceA.rows[0].id }],
    });
    await expectStatus(duplicateSource, 400, "Duplicate source link reddedilmeli");
    const twoPrimaryMeters = await postEquipment(server.baseUrl, adminToken, {
      ...baseCreate,
      equipmentCode: `EQ3D3-2PM-${suffix}`,
      meterLinks: [{ meterId: meterA.rows[0].id, isPrimary: true }, { meterId: extraMeterA.rows[0].id, isPrimary: true }],
    });
    await expectStatus(twoPrimaryMeters, 400, "Iki primary meter reddedilmeli");
    const twoPrimarySources = await postEquipment(server.baseUrl, adminToken, {
      ...baseCreate,
      equipmentCode: `EQ3D3-2PS-${suffix}`,
      energySourceLinks: [{ energySourceId: sourceA.rows[0].id, isPrimary: true }, { energySourceId: extraSourceA.rows[0].id, isPrimary: true }],
    });
    await expectStatus(twoPrimarySources, 400, "Iki primary source reddedilmeli");
    const badShare = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D3-BAD-SHARE-${suffix}`, meterLinks: [{ meterId: meterA.rows[0].id, sharePercent: 101 }] });
    await expectStatus(badShare, 400, "Share >100 reddedilmeli");
    const badRole = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D3-BAD-ROLE-${suffix}`, meterLinks: [{ meterId: meterA.rows[0].id, relationRole: "invalid" }] });
    await expectStatus(badRole, 400, "Invalid role reddedilmeli");
    const badConfidence = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D3-BAD-CONF-${suffix}`, energySourceLinks: [{ energySourceId: sourceA.rows[0].id, measurementConfidence: "certain" }] });
    await expectStatus(badConfidence, 400, "Invalid confidence reddedilmeli");
    const crossUnitMeter = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D3-CROSS-UNIT-M-${suffix}`, meterLinks: [{ meterId: unitA2Meter.rows[0].id }] });
    await expectStatus(crossUnitMeter, 400, "Baska unit meter reddedilmeli");
    const crossUnitSource = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D3-CROSS-UNIT-S-${suffix}`, energySourceLinks: [{ energySourceId: unitA2Source.rows[0].id }] });
    await expectStatus(crossUnitSource, 400, "Baska unit source reddedilmeli");
    const sameSubUnitGroupRes = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D3-GROUP-SUB-${suffix}`, energyUseGroupId: sameSubUnitGroup.rows[0].id });
    await expectStatus(sameSubUnitGroupRes, 201, "Ayni subUnit group basarili olmali");
    const generalGroupRes = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D3-GROUP-GEN-${suffix}`, energyUseGroupId: generalGroup.rows[0].id });
    await expectStatus(generalGroupRes, 201, "Genel group basarili olmali");
    const otherSubGroupRes = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D3-GROUP-BAD-${suffix}`, energyUseGroupId: otherSubUnitGroup.rows[0].id });
    await expectStatus(otherSubGroupRes, 400, "Baska subUnit group reddedilmeli");
    assertions += 11;

    const relationPatchRes = await patchEquipment(server.baseUrl, adminToken, relationEquipmentId, {
      expectedEquipmentVersion: 1,
      meterLinks: [{ meterId: extraMeterA.rows[0].id, relationRole: "sub_meter", isPrimary: true, sharePercent: 25, measurementConfidence: "medium" }],
      energySourceLinks: [{ energySourceId: extraSourceA.rows[0].id, relationRole: "secondary", isPrimary: true, sharePercent: 75, measurementConfidence: "high" }],
    });
    await expectStatus(relationPatchRes, 200, "Relation-only patch");
    const relationPatched = await json(relationPatchRes);
    assert(relationPatched.equipment.equipmentVersion === 2, "Relation-only patch version artirmadi.");
    assert(relationPatched.meterLinks.length === 1 && relationPatched.meterLinks[0].meterId === extraMeterA.rows[0].id, "Relation removal/primary degisimi calismadi.");
    const staleRelation = await patchEquipment(server.baseUrl, adminToken, relationEquipmentId, { expectedEquipmentVersion: 1, meterLinks: [] });
    await expectStatus(staleRelation, 409, "Stale relation patch 409 olmali");
    assertions += 4;

    const duplicateRes = await postEquipment(server.baseUrl, adminToken, baseCreate);
    await expectStatus(duplicateRes, 409, "Ayni firma icinde equipmentCode unique olmali");
    assertions += 1;

    const listRes = await api(server.baseUrl, adminToken, `/api/equipment?unitId=${unitA1.id}&meterId=${meterA.rows[0].id}&search=Main`);
    await expectStatus(listRes, 200, "Admin liste");
    const listed = await json(listRes);
    assert(listed.items.some((item: any) => item.id === equipmentId && item.primaryMeterId === meterA.rows[0].id), "Liste primary meter ile ekipmani donmedi.");
    assertions += 2;

    const detailRes = await api(server.baseUrl, standardToken, `/api/equipment/${equipmentId}`);
    await expectStatus(detailRes, 200, "Standard kendi unit detail");
    const standardOtherList = await api(server.baseUrl, standardToken, `/api/equipment?unitId=${unitA2.id}`);
    await expectStatus(standardOtherList, 403, "Standard baska unit listeleyememeli");
    const standardBDetail = await api(server.baseUrl, standardBToken, `/api/equipment/${equipmentId}`);
    await expectStatus(standardBDetail, 404, "Baska tenant standard ekipmani gorememeli");
    assertions += 3;

    const standardRelationUpdate = await patchEquipment(server.baseUrl, standardToken, relationEquipmentId, {
      expectedEquipmentVersion: 2,
      meterLinks: [{ meterId: meterA.rows[0].id, relationRole: "estimated_reference", isPrimary: false, sharePercent: 10, measurementConfidence: "low" }],
      energySourceLinks: [],
    });
    await expectStatus(standardRelationUpdate, 200, "Standard kendi unit relation update yapabilmeli");
    const standardOtherRelationUpdate = await patchEquipment(server.baseUrl, standardBToken, relationEquipmentId, { expectedEquipmentVersion: 3, meterLinks: [] });
    await expectStatus(standardOtherRelationUpdate, 404, "Standard baska unit/tenant relation update yapamamali");
    const superNoContextMutation = await patchEquipment(server.baseUrl, superadminToken, relationEquipmentId, { expectedEquipmentVersion: 3, meterLinks: [] });
    await expectStatus(superNoContextMutation, 400, "Superadmin context olmadan relation mutation yapamamali");
    assertions += 3;

    const adminCrossTenantCreate = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, unitId: unitB1.id, equipmentCode: `EQ3D1-CROSS-${suffix}` });
    await expectStatusIn(adminCrossTenantCreate, [403, 404], "Admin baska tenant unitine ekipman yazamamali");
    const badSubUnit = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D1-BAD-SUB-${suffix}`, subUnitId: subUnitB.rows[0].id });
    await expectStatus(badSubUnit, 400, "Baska tenant subUnit reddedilmeli");
    const badMeter = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D1-BAD-METER-${suffix}`, meterLinks: [{ meterId: meterB.rows[0].id, isPrimary: true }] });
    await expectStatus(badMeter, 400, "Baska tenant meter reddedilmeli");
    const badSource = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D1-BAD-SOURCE-${suffix}`, energySourceLinks: [{ energySourceId: sourceB.rows[0].id, isPrimary: true }] });
    await expectStatus(badSource, 400, "Baska tenant enerji kaynagi reddedilmeli");
    const duplicateLink = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D1-DUP-LINK-${suffix}`, meterLinks: [{ meterId: meterA.rows[0].id }, { meterId: meterA.rows[0].id }] });
    await expectStatus(duplicateLink, 400, "Duplicate meter link reddedilmeli");
    assertions += 5;

    const updateRes = await patchEquipment(server.baseUrl, adminToken, equipmentId, { expectedEquipmentVersion: 1, name: "[E2E] Main pump updated" });
    await expectStatus(updateRes, 200, "Optimistic update");
    const updated = await json(updateRes);
    assert(updated.equipment.equipmentVersion === 2 && updated.equipment.name.endsWith("updated"), "Update version/name bozuk.");
    const staleRes = await patchEquipment(server.baseUrl, adminToken, equipmentId, { expectedEquipmentVersion: 1, name: "stale" });
    await expectStatus(staleRes, 409, "Stale update conflict olmali");
    const noChangeRes = await patchEquipment(server.baseUrl, adminToken, equipmentId, { expectedEquipmentVersion: 2, name: "[E2E] Main pump updated" });
    await expectStatus(noChangeRes, 200, "No-change patch basarili olmali");
    const noChange = await json(noChangeRes);
    assert(noChange.equipment.equipmentVersion === 2, "No-change version artirmamali.");
    assertions += 5;

    const concurrent = await Promise.all([
      patchEquipment(server.baseUrl, adminToken, equipmentId, { expectedEquipmentVersion: 2, model: "A" }),
      patchEquipment(server.baseUrl, adminToken, equipmentId, { expectedEquipmentVersion: 2, model: "B" }),
    ]);
    const concurrentStatuses = concurrent.map((response) => response.status).sort();
    assert(JSON.stringify(concurrentStatuses) === "[200,409]", `Concurrent update beklenmedik: ${concurrentStatuses}`);
    const latestDetailRes = await api(server.baseUrl, adminToken, `/api/equipment/${equipmentId}`);
    const latestDetail = await json(latestDetailRes);
    assertions += 2;

    const parentRes = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D1-PARENT-${suffix}`, name: "[E2E] Parent" });
    await expectStatus(parentRes, 201, "Parent create");
    const parent = await json(parentRes);
    const childRes = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D1-CHILD-${suffix}`, name: "[E2E] Child", parentEquipmentId: parent.equipment.id });
    await expectStatus(childRes, 201, "Child create");
    const child = await json(childRes);
    const cycleRes = await patchEquipment(server.baseUrl, adminToken, parent.equipment.id, { expectedEquipmentVersion: 1, parentEquipmentId: child.equipment.id });
    await expectStatus(cycleRes, 400, "Parent cycle reddedilmeli");
    const selfParent = await patchEquipment(server.baseUrl, adminToken, child.equipment.id, { expectedEquipmentVersion: 1, parentEquipmentId: child.equipment.id });
    await expectStatus(selfParent, 400, "Self parent reddedilmeli");
    const parentArchiveWithActiveChild = await archiveEquipment(server.baseUrl, adminToken, parent.equipment.id, 1);
    await expectStatus(parentArchiveWithActiveChild, 409, "Aktif child varken parent archive reddedilmeli");
    const parentArchiveBody = await json(parentArchiveWithActiveChild);
    assert(parentArchiveBody.code === "EQUIPMENT_HAS_ACTIVE_CHILDREN" && parentArchiveBody.activeChildCount >= 1, "Child dependency response guvenli ozet donmeli.");
    const childArchive = await archiveEquipment(server.baseUrl, adminToken, child.equipment.id, 1);
    await expectStatus(childArchive, 200, "Child archive basarili olmali");
    const parentArchiveAfterChild = await archiveEquipment(server.baseUrl, adminToken, parent.equipment.id, 1);
    await expectStatus(parentArchiveAfterChild, 200, "Child arsivlendikten sonra parent archive basarili olmali");
    const parentReactivate = await reactivateEquipment(server.baseUrl, adminToken, parent.equipment.id, (await json(parentArchiveAfterChild)).equipment.equipmentVersion);
    await expectStatus(parentReactivate, 200, "Parent reactivate child kaydini degistirmemeli");
    assertions += 9;

    const archivedParentRes = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D1-ARCH-PARENT-${suffix}`, name: "[E2E] Archived parent" });
    await expectStatus(archivedParentRes, 201, "Archived parent create");
    const archivedParent = await json(archivedParentRes);
    const archivedParentArchive = await archiveEquipment(server.baseUrl, adminToken, archivedParent.equipment.id, 1);
    await expectStatus(archivedParentArchive, 200, "Parent archive");
    const archivedChild = await postEquipment(server.baseUrl, adminToken, { ...baseCreate, equipmentCode: `EQ3D1-ARCH-CHILD-${suffix}`, parentEquipmentId: archivedParent.equipment.id });
    await expectStatus(archivedChild, 409, "Arsivli parent ile child olusmamali");
    assertions += 3;

    const standardArchive = await archiveEquipment(server.baseUrl, standardToken, equipmentId, latestDetail.equipment.equipmentVersion);
    await expectStatus(standardArchive, 403, "Standard arsivleyememeli");
    const archiveWithoutReason = await archiveEquipmentWithBody(server.baseUrl, adminToken, equipmentId, { expectedEquipmentVersion: latestDetail.equipment.equipmentVersion });
    await expectStatus(archiveWithoutReason, 400, "Archive reason zorunlu olmali");
    const archiveRes = await archiveEquipment(server.baseUrl, adminToken, equipmentId, latestDetail.equipment.equipmentVersion);
    await expectStatus(archiveRes, 200, "Admin archive");
    const archived = await json(archiveRes);
    assert(archived.equipment.status === "archived" && archived.equipment.archivedAt, "Archive metadata donmedi.");
    const hiddenList = await api(server.baseUrl, adminToken, `/api/equipment?unitId=${unitA1.id}&search=${baseCreate.equipmentCode}`);
    const hidden = await json(hiddenList);
    assert(hidden.items.every((item: any) => item.id !== equipmentId), "Default liste arsivli ekipmani gizlemedi.");
    const visibleList = await api(server.baseUrl, adminToken, `/api/equipment?unitId=${unitA1.id}&includeArchived=true&search=${baseCreate.equipmentCode}`);
    const visible = await json(visibleList);
    assert(visible.items.some((item: any) => item.id === equipmentId), "includeArchived arsivli ekipmani getirmedi.");
    const reactivateRes = await reactivateEquipment(server.baseUrl, adminToken, equipmentId, archived.equipment.equipmentVersion);
    await expectStatus(reactivateRes, 200, "Admin reactivate");
    const reactivated = await json(reactivateRes);
    assert(reactivated.equipment.status === "active" && reactivated.equipment.archivedAt === null, "Reactivate metadata temizlenmedi.");
    assertions += 8;

    const deleteEquipment = await api(server.baseUrl, adminToken, `/api/equipment/${equipmentId}`, { method: "DELETE" });
    await expectStatus(deleteEquipment, 404, "Equipment hard delete endpoint olmamali");
    const meterDelete = await api(server.baseUrl, adminToken, `/api/meters/${meterA.rows[0].id}`, { method: "DELETE" });
    await expectStatus(meterDelete, 409, "Ekipman linkli meter silinmemeli");
    const sourceDelete = await api(server.baseUrl, adminToken, `/api/energy-sources/${sourceA.rows[0].id}`, { method: "DELETE" });
    await expectStatus(sourceDelete, 409, "Ekipman linkli enerji kaynagi silinmemeli");
    assertions += 3;

    const auditRows = await pool.query<{ action: string; count: string }>(
      `SELECT action, count(*)::text AS count FROM audit_events
       WHERE entity_type='equipment' AND entity_id=$1
       GROUP BY action`,
      [String(equipmentId)],
    );
    const auditActions = new Map(auditRows.rows.map((row) => [row.action, Number(row.count)]));
    for (const action of ["equipment.created", "equipment.updated", "equipment.archived", "equipment.reactivated"]) {
      assert((auditActions.get(action) ?? 0) >= 1, `${action} audit yok.`);
      assertions += 1;
    }
    const standardAudit = await api(server.baseUrl, standardToken, `/api/audit-events?entityType=equipment&entityId=${equipmentId}&pageSize=5`);
    await expectStatus(standardAudit, 200, "Standard kendi ekipman audit gecmisini gorebilmeli");
    const standardBAudit = await api(server.baseUrl, standardBToken, `/api/audit-events?entityType=equipment&entityId=${equipmentId}&pageSize=5`);
    await expectStatus(standardBAudit, 404, "Standard baska tenant equipment audit gorememeli");
    const failedAuditRows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_events
       WHERE entity_type='equipment' AND entity_id=$1 AND metadata_json::text LIKE '%stale%'`,
      [String(equipmentId)],
    );
    assert(Number(failedAuditRows.rows[0]?.count ?? 0) === 0, "Basarisiz mutation audit uretmemeli.");
    const sensitiveAudit = await pool.query<{ payload: string }>(
      `SELECT coalesce(changes_json::text, '') || coalesce(metadata_json::text, '') AS payload
       FROM audit_events
       WHERE entity_type='equipment' AND entity_id=$1`,
      [String(equipmentId)],
    );
    assert(sensitiveAudit.rows.every((row) => !row.payload.includes("Main pump updated") && !row.payload.includes("serialNumber")), "Audit hassas serbest metin veya serial raw deger sizdirmemeli.");
    assertions += 4;

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
