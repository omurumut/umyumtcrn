import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import ExcelJS from "exceljs";
import {
  calculateUnitTechnicalProfileCompletion,
  validateUnitTechnicalProfilePublishMinimum,
} from "@workspace/api-zod";

type LoginBody = { token?: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertRejects(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
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

async function publishProfile(baseUrl: string, token: string, unitId: number, body: Record<string, unknown>, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/unit-technical-profiles/${unitId}/publish${query}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function workbookBuffer(headers: string[], rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Teknik Profil");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function uploadProfileImport(baseUrl: string, token: string, path: string, buffer: Buffer, fields: Record<string, string> = {}) {
  const form = new FormData();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  form.set("file", new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "technical-profiles.xlsx");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: auth(token),
    body: form,
  });
}

function definitionPath(companyId?: number) {
  const query = companyId === undefined ? "?includeInactive=true" : `?companyId=${companyId}&includeInactive=true`;
  return `/api/unit-technical-profile-field-definitions${query}`;
}

async function createDefinition(baseUrl: string, token: string, body: Record<string, unknown>, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/unit-technical-profile-field-definitions${query}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function patchDefinition(baseUrl: string, token: string, id: number, body: Record<string, unknown>, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/unit-technical-profile-field-definitions/${id}${query}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function archiveDefinition(baseUrl: string, token: string, id: number, expectedDefinitionVersion: number, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/unit-technical-profile-field-definitions/${id}/archive${query}`, {
    method: "POST",
    body: JSON.stringify({ expectedDefinitionVersion }),
  });
}

function expectStatusIn(response: Response, allowed: number[], message: string) {
  assert(allowed.includes(response.status), `${message}: ${response.status}`);
}

async function main() {
  assertDisposableDatabase();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = await startServer();
  let assertions = 0;
  try {
    const emptyCompletion = calculateUnitTechnicalProfileCompletion({});
    assert(emptyCompletion.ratio === 0 && emptyCompletion.nextIncompleteSectionId === "general", "Bos profil doluluk hesabi bozuk.");
    const zeroCompletion = calculateUnitTechnicalProfileCompletion({ personnelCount: 0 });
    assert(zeroCompletion.completedFields === 1, "0 degeri dolu sayilmadi.");
    const unknownCompletion = calculateUnitTechnicalProfileCompletion({ generatorStatus: "unknown" });
    assert(unknownCompletion.completedFields === 1, "unknown bilincli secim sayilmadi.");
    const notApplicableCompletion = calculateUnitTechnicalProfileCompletion({ steamSystemStatus: "not_applicable" });
    assert(notApplicableCompletion.completedFields === 1, "not_applicable bilincli secim sayilmadi.");
    const whitespaceCompletion = calculateUnitTechnicalProfileCompletion({ mainActivity: "   " });
    assert(whitespaceCompletion.completedFields === 0, "Whitespace metin eksik sayilmadi.");
    const partialOperation = calculateUnitTechnicalProfileCompletion({ dailyOperatingHours: 8 });
    assert(partialOperation.sections.find((section) => section.id === "operation")?.status === "partial", "Kismi bolum durumu bozuk.");
    const fullEnergySystems = calculateUnitTechnicalProfileCompletion({
      compressedAirStatus: "yes",
      steamSystemStatus: "no",
      generatorStatus: "unknown",
      renewableEnergyStatus: "not_applicable",
    });
    assert(fullEnergySystems.sections.find((section) => section.id === "energySystems")?.status === "completed", "Tam bolum durumu bozuk.");
    assert(calculateUnitTechnicalProfileCompletion({ facilityUseType: "Uretim", mainActivity: "Montaj", mainProcessDescription: "Hat" }).nextIncompleteSectionId === "physical", "Sonraki eksik bolum hesabi bozuk.");
    assert(validateUnitTechnicalProfilePublishMinimum({}).includes("operation"), "Publish minimum operasyon sentinel yok.");
    assertions += 9;

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
    assert(updatedRes.status === 422, `Eksik minimum publish 422 yerine ${updatedRes.status}`);
    const missingPublish = await json(updatedRes);
    assert(Array.isArray(missingPublish.missingFields) && missingPublish.missingFields.includes("totalEnclosedAreaM2") && missingPublish.missingFields.includes("heatingSystemType"), "Publish eksik alan response bozuk.");
    assertions += 2;

    const minimumPublishRes = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 1,
      mainActivity: "Assembly and packaging",
      totalEnclosedAreaM2: 0,
      heatingSystemType: "Natural gas boiler",
      coolingSystemType: "Rooftop unit",
      profileStatus: "published",
    });
    assert(minimumPublishRes.status === 200, `Admin publish 200 yerine ${minimumPublishRes.status}`);
    const updated = await json(minimumPublishRes);
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
      facilityUseType: "Office",
      mainActivity: "Kontrol admin update",
      totalEnclosedAreaM2: 100,
      dailyOperatingHours: 8,
      heatingSystemType: "Heat pump",
      coolingSystemType: "Split system",
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

    for (const forbiddenField of ["snapshotNumber", "validFrom", "validTo", "publishedAt", "publishedBy", "permissions", "auditMetadata"]) {
      const massAssignment = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
        expectedProfileVersion: 3,
        [forbiddenField]: forbiddenField === "permissions" ? { canPublish: true } : 999,
      });
      assert(massAssignment.status === 400, `Mass assignment ${forbiddenField} reddedilmedi.`);
      assertions += 1;
    }

    const bodyCompanySpoof = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 3,
      mainActivity: "Spoof attempt",
      companyId: standardBUser.company_id,
    });
    assert(bodyCompanySpoof.status === 400, "Request body sahte companyId strict schema tarafindan reddedilmedi.");
    const bodyUnitSpoof = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 3,
      mainActivity: "Spoof attempt",
      unitId: unitB1.id,
    });
    assert(bodyUnitSpoof.status === 400, "Request body sahte unitId strict schema tarafindan reddedilmedi.");
    assertions += 2;

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

    const standardDefinitions = await api(server.baseUrl, standardToken, definitionPath());
    assert(standardDefinitions.status === 403, "Standard alan tanimlarini gorebildi.");
    const kontrolDefinitions = await api(server.baseUrl, kontrolToken, definitionPath());
    assert(kontrolDefinitions.status === 200, "kontrol_admin alan tanimlarini okuyamadi.");
    const kontrolDefinitionsBody = await json(kontrolDefinitions);
    assert(kontrolDefinitionsBody.permissions.canEdit === false, "kontrol_admin alan tanimlarini duzenleyebilir gorundu.");
    const kontrolCreate = await createDefinition(server.baseUrl, kontrolToken, { code: "kontrol_field", label: "Kontrol Field", fieldType: "short_text" });
    assert(kontrolCreate.status === 403, "kontrol_admin alan tanimi olusturabildi.");
    const superDefinitionNoContext = await api(server.baseUrl, superadminToken, definitionPath());
    assert(superDefinitionNoContext.status === 400, "Superadmin alan taniminda context olmadan basarili oldu.");
    assertions += 5;

    const reservedDefinition = await createDefinition(server.baseUrl, adminToken, {
      code: "mainActivity",
      label: "Reserved",
      fieldType: "short_text",
    });
    assert(reservedDefinition.status === 400, "Standart alan kodu ozel alan olarak kabul edildi.");
    const invalidOptions = await createDefinition(server.baseUrl, adminToken, {
      code: "phase3c3_bad_options",
      label: "Bad options",
      fieldType: "single_select",
      options: [
        { code: "a1", label: "A", isActive: true },
        { code: "a1", label: "A duplicate", isActive: true },
      ],
    });
    assert(invalidOptions.status === 400, "Duplicate option kodu kabul edildi.");
    const invalidRange = await createDefinition(server.baseUrl, adminToken, {
      code: "phase3c3_bad_range",
      label: "Bad range",
      fieldType: "decimal",
      validationConfig: { min: 10, max: 1 },
    });
    assert(invalidRange.status === 400, "min > max validationConfig kabul edildi.");
    assertions += 3;

    const numericDefinitionRes = await createDefinition(server.baseUrl, adminToken, {
      code: "phase3c3_process_temperature",
      label: "Process temperature",
      fieldType: "unit_number",
      unitLabel: "C",
      sortOrder: 10,
      validationConfig: { min: 0, max: 120 },
    });
    assert(numericDefinitionRes.status === 201, `Numeric definition 201 yerine ${numericDefinitionRes.status}`);
    const numericDefinitionBody = await json(numericDefinitionRes);
    const numericDefinition = numericDefinitionBody.definition;
    assert(numericDefinition.definitionVersion === 1 && numericDefinition.hasValues === false, "Definition create response bozuk.");
    const duplicateDefinition = await createDefinition(server.baseUrl, adminToken, {
      code: "phase3c3_process_temperature",
      label: "Duplicate",
      fieldType: "unit_number",
    });
    assert(duplicateDefinition.status === 409, "Duplicate definition code reddedilmedi.");
    const staleDefinition = await patchDefinition(server.baseUrl, adminToken, numericDefinition.id, {
      expectedDefinitionVersion: 99,
      label: "Stale",
    });
    assert(staleDefinition.status === 409, "Stale definition version 409 donmedi.");
    assertions += 4;

    const definitionMassAssignment = await patchDefinition(server.baseUrl, adminToken, numericDefinition.id, {
      expectedDefinitionVersion: numericDefinition.definitionVersion,
      label: "Mass assignment attempt",
      companyId: standardBUser.company_id,
    });
    assert(definitionMassAssignment.status === 400, "Definition companyId mass assignment reddedilmedi.");
    const definitionUsageSpoof = await patchDefinition(server.baseUrl, adminToken, numericDefinition.id, {
      expectedDefinitionVersion: numericDefinition.definitionVersion,
      label: "Usage spoof attempt",
      usageCount: 999,
    });
    assert(definitionUsageSpoof.status === 400, "Definition usageCount mass assignment reddedilmedi.");
    const definitionPermissionsSpoof = await patchDefinition(server.baseUrl, adminToken, numericDefinition.id, {
      expectedDefinitionVersion: numericDefinition.definitionVersion,
      label: "Permissions spoof attempt",
      permissions: { canEdit: true },
    });
    assert(definitionPermissionsSpoof.status === 400, "Definition permissions mass assignment reddedilmedi.");
    assertions += 3;

    const selectDefinitionRes = await createDefinition(server.baseUrl, adminToken, {
      code: "phase3c3_line_type",
      label: "Line type",
      fieldType: "single_select",
      options: [
        { code: "assembly", label: "Assembly", isActive: true },
        { code: "packaging", label: "Packaging", isActive: true },
      ],
    });
    assert(selectDefinitionRes.status === 201, "Select definition olusturulamadi.");
    const selectDefinition = (await json(selectDefinitionRes)).definition;
    const longTextDefinitionRes = await createDefinition(server.baseUrl, adminToken, {
      code: "phase3c7_ai_private_note",
      label: "AI private note",
      fieldType: "long_text",
      sortOrder: 30,
    });
    assert(longTextDefinitionRes.status === 201, "3C.7 long_text custom definition olusturulamadi.");
    assertions += 2;

    const invalidCustomValue = await patchProfile(server.baseUrl, standardToken, unitA1.id, {
      expectedProfileVersion: 3,
      customFieldValues: { phase3c3_process_temperature: 500 },
    });
    assert(invalidCustomValue.status === 400, "Custom numeric max validation reddedilmedi.");
    const invalidSelectValue = await patchProfile(server.baseUrl, standardToken, unitA1.id, {
      expectedProfileVersion: 3,
      customFieldValues: { phase3c3_line_type: "unknown" },
    });
    assert(invalidSelectValue.status === 400, "Custom select invalid option reddedilmedi.");
    const validCustomValue = await patchProfile(server.baseUrl, standardToken, unitA1.id, {
      expectedProfileVersion: 3,
      customFieldValues: {
        phase3c3_process_temperature: 42.5,
        phase3c3_line_type: "assembly",
        phase3c7_ai_private_note: "Bu uzun not AI context icin varsayilan olarak haric tutulmalidir.",
      },
      buildingAutomationStatus: "unknown",
      renewableEnergyStatus: "not_applicable",
    });
    assert(validCustomValue.status === 200, `Custom value save 200 yerine ${validCustomValue.status}`);
    const validCustomBody = await json(validCustomValue);
    assert(validCustomBody.profile.profileVersion === 4, "Custom value profileVersion artirmadi.");
    assert(validCustomBody.customFieldValues.phase3c3_process_temperature === 42.5, "Custom numeric value donmedi.");
    assertions += 5;

    const usedTypePatch = await patchDefinition(server.baseUrl, adminToken, selectDefinition.id, {
      expectedDefinitionVersion: selectDefinition.definitionVersion,
      fieldType: "multi_select",
    });
    assert(usedTypePatch.status === 409, "Kullanilmis alan tipi degistirilebildi.");
    const archiveNumeric = await archiveDefinition(server.baseUrl, adminToken, numericDefinition.id, numericDefinition.definitionVersion);
    assert(archiveNumeric.status === 200, "Kullanilmis alan archive edilemedi.");
    const profileAfterArchive = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}`);
    assert(profileAfterArchive.status === 200, "Archive sonrasi profil okunamadi.");
    const profileAfterArchiveBody = await json(profileAfterArchive);
    assert(
      profileAfterArchiveBody.customFieldDefinitions.some((definition: any) => definition.code === "phase3c3_process_temperature" && definition.isActive === false),
      "Pasif kullanilmis definition profil GET icinde korunmadi.",
    );
    assert(profileAfterArchiveBody.customFieldValues.phase3c3_process_temperature === 42.5, "Pasif alan eski degeri korunmadi.");
    assertions += 5;

    const requiredBDefinitionRes = await createDefinition(server.baseUrl, superadminToken, {
      code: "phase3c3_required_metering",
      label: "Required metering",
      fieldType: "boolean",
      isRequiredForPublish: true,
    }, standardBUser.company_id);
    assert(requiredBDefinitionRes.status === 201, "Tenant B required custom definition olusturulamadi.");
    const publishMissingCustom = await patchProfile(server.baseUrl, superadminToken, unitB1.id, {
      expectedProfileVersion: 0,
      facilityUseType: "Office",
      mainActivity: "Tenant B",
      totalEnclosedAreaM2: 100,
      dailyOperatingHours: 8,
      heatingSystemType: "Heat pump",
      coolingSystemType: "Split",
      profileStatus: "published",
    }, standardBUser.company_id);
    assert(publishMissingCustom.status === 422, "Required custom publish eksigi 422 donmedi.");
    const publishMissingCustomBody = await json(publishMissingCustom);
    assert(publishMissingCustomBody.missingFields.includes("phase3c3_required_metering"), "Required custom missingFields icinde yok.");
    assert(publishMissingCustomBody.missingFieldDetails.some((field: any) => field.kind === "custom" && field.code === "phase3c3_required_metering"), "Required custom missingFieldDetails yok.");
    const publishWithCustom = await patchProfile(server.baseUrl, superadminToken, unitB1.id, {
      expectedProfileVersion: 0,
      facilityUseType: "Office",
      mainActivity: "Tenant B",
      totalEnclosedAreaM2: 100,
      dailyOperatingHours: 8,
      heatingSystemType: "Heat pump",
      coolingSystemType: "Split",
      profileStatus: "published",
      customFieldValues: { phase3c3_required_metering: "yes" },
    }, standardBUser.company_id);
    assert(publishWithCustom.status === 200, "Required custom tamamlaninca publish basarisiz.");
    const crossTenantCustomCode = await patchProfile(server.baseUrl, standardBToken, unitB1.id, {
      expectedProfileVersion: 1,
      customFieldValues: { phase3c3_process_temperature: 1 },
    });
    assert(crossTenantCustomCode.status === 400, "Tenant B, tenant A custom kodunu yazabildi.");
    const crossTenantDefinitionPatch = await patchDefinition(server.baseUrl, superadminToken, numericDefinition.id, {
      expectedDefinitionVersion: numericDefinition.definitionVersion,
      label: "Cross tenant definition attempt",
    }, standardBUser.company_id);
    assert(crossTenantDefinitionPatch.status === 404, "Superadmin yanlis tenant context ile definition guncelleyebildi.");
    assertions += 7;

    const draftSnapshotCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM unit_technical_profile_snapshots WHERE unit_id=$1",
      [unitA1.id],
    );
    assert(draftSnapshotCount.rows[0]?.count === "0", "Draft save snapshot olusturdu.");
    const firstPublish = await publishProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 4,
      validFrom: "2026-01-01",
      changeSummary: "Initial technical profile baseline",
    });
    assert(firstPublish.status === 200, `Explicit publish 200 yerine ${firstPublish.status}`);
    const firstPublishBody = await json(firstPublish);
    assert(firstPublishBody.snapshot.snapshotNumber === 1, "Ilk snapshot number 1 degil.");
    assert(firstPublishBody.snapshot.validFrom === "2026-01-01" && firstPublishBody.snapshot.validTo === null, "Ilk snapshot valid range bozuk.");
    assert(firstPublishBody.profile.profileVersion === 5 && firstPublishBody.profile.profileStatus === "published", "Publish profile version/status bozuk.");
    assertions += 4;

    const sameDatePublish = await publishProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 5,
      validFrom: "2026-01-01",
      changeSummary: "Duplicate date",
    });
    assert(sameDatePublish.status === 409, "Ayni validFrom reddedilmedi.");
    const stalePublish = await publishProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 4,
      validFrom: "2026-02-01",
    });
    assert(stalePublish.status === 409, "Stale publish version 409 donmedi.");
    const backdatedPublish = await publishProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: 5,
      validFrom: "2025-12-31",
    });
    assert(backdatedPublish.status === 409, "Backdated publish reddedilmedi.");
    assertions += 3;

    const unitA2BeforeConcurrentPublish = await json(await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA2.id}`));
    const concurrentPublishes = await Promise.all([
      publishProfile(server.baseUrl, adminToken, unitA2.id, {
        expectedProfileVersion: unitA2BeforeConcurrentPublish.profile.profileVersion,
        validFrom: "2026-03-01",
        changeSummary: "Concurrent publish A",
      }),
      publishProfile(server.baseUrl, adminToken, unitA2.id, {
        expectedProfileVersion: unitA2BeforeConcurrentPublish.profile.profileVersion,
        validFrom: "2026-03-01",
        changeSummary: "Concurrent publish B",
      }),
    ]);
    const concurrentPublishStatuses = concurrentPublishes.map((response) => response.status).sort();
    assert(JSON.stringify(concurrentPublishStatuses) === "[200,409]", `Concurrent publish beklenmedik: ${concurrentPublishStatuses}`);
    const concurrentSnapshotCount = await pool.query<{ count: string; max_snapshot_number: number | null }>(
      "SELECT count(*)::text AS count, max(snapshot_number) AS max_snapshot_number FROM unit_technical_profile_snapshots WHERE unit_id=$1",
      [unitA2.id],
    );
    assert(concurrentSnapshotCount.rows[0]?.count === "1" && concurrentSnapshotCount.rows[0]?.max_snapshot_number === 1, "Concurrent publish duplicate snapshot olusturdu.");
    assertions += 2;

    const firstSnapshotDetail = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}/history/${firstPublishBody.snapshot.id}`);
    assert(firstSnapshotDetail.status === 200, "Snapshot detail okunamadi.");
    const firstSnapshotBody = await json(firstSnapshotDetail);
    assert(firstSnapshotBody.snapshot.standardValues.mainActivity === "Assembly and packaging", "Standart snapshot degeri korunmadi.");
    assert(firstSnapshotBody.snapshot.customFieldValues.phase3c3_line_type === "assembly", "Custom snapshot degeri korunmadi.");
    assert(firstSnapshotBody.snapshot.customFieldDefinitions.some((definition: any) => definition.code === "phase3c3_line_type" && definition.label === "Line type"), "Custom definition snapshot label korunmadi.");
    assertions += 3;

    const definitionLabelUpdate = await patchDefinition(server.baseUrl, adminToken, selectDefinition.id, {
      expectedDefinitionVersion: selectDefinition.definitionVersion,
      label: "Line type changed later",
    });
    assert(definitionLabelUpdate.status === 200, "Definition label update basarisiz.");
    const firstSnapshotAfterDefinitionUpdate = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}/history/${firstPublishBody.snapshot.id}`);
    const firstSnapshotAfterDefinitionUpdateBody = await json(firstSnapshotAfterDefinitionUpdate);
    assert(firstSnapshotAfterDefinitionUpdateBody.snapshot.customFieldDefinitions.some((definition: any) => definition.code === "phase3c3_line_type" && definition.label === "Line type"), "Snapshot definition metadata sonradan degisti.");
    const importSelectDefinitionRes = await createDefinition(server.baseUrl, adminToken, {
      code: "phase3c5_import_line",
      label: "Import line",
      fieldType: "single_select",
      options: [
        { code: "assembly", label: "Assembly", isActive: true },
        { code: "packaging", label: "Packaging", isActive: true },
      ],
      sortOrder: 20,
    });
    assert(importSelectDefinitionRes.status === 201, "3C.5 import custom definition olusturulamadi.");
    assertions += 3;

    const profileBeforeSecondPublish = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}`);
    const profileBeforeSecondPublishBody = await json(profileBeforeSecondPublish);
    const secondDraft = await patchProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: profileBeforeSecondPublishBody.profile.profileVersion,
      mainActivity: "Assembly snapshot v2",
    });
    assert(secondDraft.status === 200, "Ikinci snapshot oncesi current profile guncellenemedi.");
    const secondDraftBody = await json(secondDraft);
    const secondPublish = await publishProfile(server.baseUrl, adminToken, unitA1.id, {
      expectedProfileVersion: secondDraftBody.profile.profileVersion,
      validFrom: "2026-06-01",
      changeSummary: "Second technical profile baseline",
    });
    assert(secondPublish.status === 200, `Ikinci publish 200 yerine ${secondPublish.status}`);
    const secondPublishBody = await json(secondPublish);
    assert(secondPublishBody.snapshot.snapshotNumber === 2, "Ikinci snapshot number 2 degil.");
    const history = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}/history`);
    assert(history.status === 200, "History list okunamadi.");
    const historyBody = await json(history);
    assert(historyBody.items.length >= 2 && historyBody.items[0].snapshotNumber === 2 && historyBody.items[1].snapshotNumber === 1, "History siralamasi bozuk.");
    assert(historyBody.items[1].validTo === "2026-06-01", "Onceki snapshot validTo kapanmadi.");
    assertions += 5;

    const effectiveBefore = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}/effective?date=2025-12-31`);
    assert(effectiveBefore.status === 404, "Ilk snapshot oncesi effective kayit dondu.");
    const effectiveFirst = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}/effective?date=2026-01-01`);
    assert(effectiveFirst.status === 200, "validFrom boundary effective snapshot donmedi.");
    const effectiveFirstBody = await json(effectiveFirst);
    assert(effectiveFirstBody.snapshot.snapshotNumber === 1, "[from,to) ilk boundary bozuk.");
    const effectiveSecondBoundary = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}/effective?date=2026-06-01`);
    const effectiveSecondBoundaryBody = await json(effectiveSecondBoundary);
    assert(effectiveSecondBoundary.status === 200 && effectiveSecondBoundaryBody.snapshot.snapshotNumber === 2, "[from,to) to boundary bozuk.");
    const invalidEffectiveDate = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}/effective?date=2026-13-01`);
    assert(invalidEffectiveDate.status === 400, "Gecersiz effective date reddedilmedi.");
    const crossTenantSnapshotDetail = await api(server.baseUrl, standardBToken, `/api/unit-technical-profiles/${unitB1.id}/history/${firstPublishBody.snapshot.id}`);
    assert(crossTenantSnapshotDetail.status === 404, "Baska tenant snapshot detail sizdi.");
    const crossTenantEffective = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitA1.id}/effective?companyId=${standardBUser.company_id}&date=2026-06-01`);
    assert(crossTenantEffective.status === 403, "Superadmin yanlis tenant context ile effective snapshot okuyabildi.");
    const crossTenantHistory = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitA1.id}/history?companyId=${standardBUser.company_id}`);
    assert(crossTenantHistory.status === 403, "Superadmin yanlis tenant context ile history okuyabildi.");
    const crossTenantSnapshot = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitA1.id}/history/${firstPublishBody.snapshot.id}?companyId=${standardBUser.company_id}`);
    assert(crossTenantSnapshot.status === 403, "Superadmin yanlis tenant context ile snapshot detail okuyabildi.");
    assertions += 9;

    const standardExplicitPublish = await publishProfile(server.baseUrl, standardToken, unitA1.id, {
      expectedProfileVersion: secondPublishBody.profile.profileVersion,
      validFrom: "2026-07-01",
    });
    assert(standardExplicitPublish.status === 403, "Standard explicit publish yapabildi.");
    const superHistoryNoContext = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitA1.id}/history`);
    assert(superHistoryNoContext.status === 400, "Superadmin history context olmadan basarili oldu.");
    const superEffectiveWithContext = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitA1.id}/effective?companyId=${adminUser.company_id}&date=2026-07-01`);
    assert(superEffectiveWithContext.status === 200, "Superadmin explicit context effective okuyamadi.");
    const superPublishWrongContext = await publishProfile(server.baseUrl, superadminToken, unitA1.id, {
      expectedProfileVersion: secondPublishBody.profile.profileVersion,
      validFrom: "2026-08-01",
    }, standardBUser.company_id);
    assert(superPublishWrongContext.status === 403, "Superadmin yanlis tenant context ile publish yapabildi.");
    assertions += 4;

    const templateRes = await api(server.baseUrl, adminToken, "/api/unit-technical-profiles/import/template?includeCustomFields=true");
    assert(templateRes.status === 200, `Template 200 yerine ${templateRes.status}`);
    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.load(await templateRes.arrayBuffer());
    const templateSheet = templateWorkbook.getWorksheet("Teknik Profil");
    const helpSheet = templateWorkbook.getWorksheet("Aciklamalar");
    const optionsSheet = templateWorkbook.getWorksheet("Secenekler");
    assert(templateSheet && helpSheet && optionsSheet, "Template sheet yapisi eksik.");
    const templateHeaders = (templateSheet!.getRow(1).values as unknown[]).map((value) => String(value ?? ""));
    assert(templateHeaders.some((header) => header.includes("[unitId]")), "Template unitId kolonu yok.");
    assert(templateHeaders.some((header) => header.includes("[mainActivity]")), "Template standart kolon yok.");
    assert(templateHeaders.some((header) => header.includes("[custom:phase3c5_import_line]")), "Template aktif custom kolon yok.");
    assert(!templateHeaders.some((header) => header.includes("[custom:phase3c3_process_temperature]")), "Template pasif custom kolonu yeni giris olarak iceriyor.");
    const standardTemplate = await api(server.baseUrl, standardToken, `/api/unit-technical-profiles/import/template?unitId=${unitA2.id}`);
    assert(standardTemplate.status === 403, "Standard baska unit template alabildi.");
    const superTemplateNoContext = await api(server.baseUrl, superadminToken, "/api/unit-technical-profiles/import/template");
    assert(superTemplateNoContext.status === 400, "Superadmin context olmadan template alabildi.");
    const superTemplateWrongContext = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/import/template?companyId=${standardBUser.company_id}&unitId=${unitA1.id}`);
    expectStatusIn(superTemplateWrongContext, [403, 404], "Superadmin yanlis tenant context ile template alabildi");
    assertions += 9;

    await pool.query("UPDATE units SET name='=Formula Unit' WHERE id=$1", [unitA2.id]);
    const exportRes = await api(server.baseUrl, adminToken, "/api/unit-technical-profiles/export");
    assert(exportRes.status === 200, `Export 200 yerine ${exportRes.status}`);
    const exportWorkbook = new ExcelJS.Workbook();
    await exportWorkbook.xlsx.load(await exportRes.arrayBuffer());
    const exportSheet = exportWorkbook.getWorksheet("Teknik Profil");
    assert(exportSheet, "Export Teknik Profil sheet yok.");
    const exportedUnitNames = exportSheet!.getColumn(2).values.map((value) => String(value ?? ""));
    assert(exportedUnitNames.some((value) => value === "'=Formula Unit"), "Formula injection exportta sanitize edilmedi.");
    const standardExportOther = await api(server.baseUrl, standardToken, `/api/unit-technical-profiles/export?unitId=${unitA2.id}`);
    assert(standardExportOther.status === 403, "Standard baska unit export alabildi.");
    const superExportNoContext = await api(server.baseUrl, superadminToken, "/api/unit-technical-profiles/export");
    assert(superExportNoContext.status === 400, "Superadmin context olmadan export alabildi.");
    const adminCrossTenantExport = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/export?unitId=${unitB1.id}`);
    expectStatusIn(adminCrossTenantExport, [403, 404], "Admin baska tenant unit export filtresi reddedilmedi");
    const superExportWrongContext = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/export?companyId=${standardBUser.company_id}&unitId=${unitA1.id}`);
    expectStatusIn(superExportWrongContext, [403, 404], "Superadmin yanlis tenant context ile export alabildi");
    assertions += 7;

    const importHeaders = [
      "Birim ID [unitId]",
      "Birim Adi [unitName]",
      "Beklenen Profil Versiyonu [expectedProfileVersion]",
      "Ana faaliyet [mainActivity]",
      "Toplam kapali alan [totalEnclosedAreaM2]",
      "Bina otomasyonu [buildingAutomationStatus]",
      "Import line [custom:phase3c5_import_line]",
    ];
    const validImportBuffer = await workbookBuffer(importHeaders, [[
      unitA1.id,
      "Wrong display name",
      secondPublishBody.profile.profileVersion,
      "Imported draft activity",
      2500.5,
      "no",
      "packaging",
    ]]);
    const previewRes = await uploadProfileImport(server.baseUrl, adminToken, "/api/unit-technical-profiles/import/preview", validImportBuffer, { mode: "update_non_empty" });
    assert(previewRes.status === 200, `Preview 200 yerine ${previewRes.status}`);
    const previewBody = await json(previewRes);
    assert(previewBody.totalRows === 1 && previewBody.updateCount === 1 && previewBody.errors.length === 0, `Preview update ozeti bozuk: ${JSON.stringify(previewBody)}`);
    assert(previewBody.warningCount === 1 && previewBody.warnings[0].code === "unit_name_mismatch", "Unit name mismatch uyarisi uretilmedi.");
    const snapshotCountBeforeImport = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM unit_technical_profile_snapshots WHERE unit_id=$1", [unitA1.id]);
    const applyRes = await uploadProfileImport(server.baseUrl, adminToken, "/api/unit-technical-profiles/import", validImportBuffer, { mode: "update_non_empty", confirm: "true" });
    assert(applyRes.status === 200, `Apply 200 yerine ${applyRes.status}`);
    const applyBody = await json(applyRes);
    assert(applyBody.updateCount === 1 && applyBody.message.includes("snapshot gecmisi degismedi"), "Apply sonucu mesaji/ozeti bozuk.");
    const profileAfterImportRes = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}`);
    const profileAfterImport = await json(profileAfterImportRes);
    assert(profileAfterImport.profile.profileVersion === secondPublishBody.profile.profileVersion + 1, "Import update version artirmadi.");
    assert(profileAfterImport.profile.profileStatus === "draft", "Import current profili draft'a cekmedi.");
    assert(profileAfterImport.profile.mainActivity === "Imported draft activity", "Import standart alan yazmadi.");
    assert(profileAfterImport.customFieldValues.phase3c5_import_line === "packaging", "Import custom select yazmadi.");
    const snapshotCountAfterImport = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM unit_technical_profile_snapshots WHERE unit_id=$1", [unitA1.id]);
    assert(snapshotCountAfterImport.rows[0]?.count === snapshotCountBeforeImport.rows[0]?.count, "Import snapshot olusturdu.");
    const effectiveAfterImport = await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}/effective?date=2026-07-01`);
    const effectiveAfterImportBody = await json(effectiveAfterImport);
    assert(effectiveAfterImportBody.snapshot.standardValues.mainActivity === "Assembly snapshot v2", "Import effective snapshot sonucunu degistirdi.");
    const energyReviewOverview = await api(server.baseUrl, adminToken, `/api/energy-review/overview?year=2026&unitId=${unitA1.id}`);
    assert(energyReviewOverview.status === 200, `Energy Review overview 200 yerine ${energyReviewOverview.status}`);
    const energyReviewOverviewBody = await json(energyReviewOverview);
    assert(energyReviewOverviewBody.technicalProfileContext.status === "resolved", "Energy Review teknik profil context resolved degil.");
    assert(energyReviewOverviewBody.technicalProfileContext.effectiveDate === "2026-12-31", "Energy Review teknik profil etki tarihi yil sonu degil.");
    assert(energyReviewOverviewBody.technicalProfileContext.snapshotNumber === 2, "Energy Review teknik profil yil sonu snapshot v2 secmedi.");
    assert(energyReviewOverviewBody.technicalProfileContext.standardSummary.some((field: any) => field.code === "mainActivity" && field.displayValue === "Assembly snapshot v2"), "Energy Review teknik profil published snapshot degerini gostermedi.");
    const superEnergyReviewNoContext = await api(server.baseUrl, superadminToken, `/api/energy-review/overview?year=2026&unitId=${unitA1.id}`);
    assert(superEnergyReviewNoContext.status === 400, "Superadmin Energy Review context olmadan basarili oldu.");
    const superEnergyReviewWithContext = await api(server.baseUrl, superadminToken, `/api/energy-review/overview?companyId=${adminUser.company_id}&year=2026&unitId=${unitA1.id}`);
    assert(superEnergyReviewWithContext.status === 200, "Superadmin Energy Review explicit context ile okuyamadi.");
    const technicalProfileEffectiveModule = await import(pathToFileURL(resolve(import.meta.dirname, "../../artifacts/api-server/src/lib/unit-technical-profile-effective.ts")).href) as any;
    const buildTechnicalProfileAiContext = technicalProfileEffectiveModule.buildTechnicalProfileAiContext as (input: {
      companyId: number;
      unitId: number;
      effectiveDate: string;
    }) => Promise<any>;
    const aiContext = await buildTechnicalProfileAiContext({
      companyId: adminUser.company_id,
      unitId: unitA1.id,
      effectiveDate: "2026-12-31",
    });
    const aiContextAgain = await buildTechnicalProfileAiContext({
      companyId: adminUser.company_id,
      unitId: unitA1.id,
      effectiveDate: "2026-12-31",
    });
    assert(aiContext.status === "resolved" && aiContext.source.snapshotNumber === 2, "AI context resolved snapshot v2 secmedi.");
    assert(aiContext.facility.mainActivity === "Assembly snapshot v2", "AI context draft current profile'a dustu.");
    assert(aiContext.facility.totalEnclosedAreaM2 === 0, "AI context anlamli 0 degerini korumadi.");
    assert((aiContext.systems.buildingAutomationStatus as any)?.code === "unknown", "AI context unknown statusunu korumadi.");
    assert((aiContext.systems.renewableEnergyStatus as any)?.code === "not_applicable", "AI context not_applicable statusunu korumadi.");
    assert(aiContext.customFacts.some((field: any) => field.code === "phase3c3_line_type" && field.displayValue === "assembly"), "AI context guvenli custom select degeri icermiyor.");
    assert(!aiContext.customFacts.some((field: any) => field.code === "phase3c7_ai_private_note"), "AI context long_text custom alani dahil etti.");
    assert(aiContext.observations.some((item: any) => item.code === "knownEnergyIssues" && item.contentKind === "user_supplied_profile_text"), "AI context serbest metin veri kaynagini isaretlemedi.");
    assert(JSON.stringify(aiContext) === JSON.stringify(aiContextAgain), "AI context deterministik uretilmedi.");
    const aiBeforeSnapshot = await buildTechnicalProfileAiContext({
      companyId: adminUser.company_id,
      unitId: unitA1.id,
      effectiveDate: "2025-12-31",
    });
    assert(aiBeforeSnapshot.status === "no_snapshot_for_date", "AI context effective date oncesi durumu dogru degil.");
    await assertRejects(
      () => buildTechnicalProfileAiContext({ companyId: standardBUser.company_id, unitId: unitA1.id, effectiveDate: "2026-12-31" }),
      "AI context cross-tenant unit reddedilmedi.",
    );

    const aiSuggestionsRes = await api(server.baseUrl, adminToken, `/api/ai/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: 2026, focus: "genel", unitId: unitA1.id }),
    });
    assert(aiSuggestionsRes.status === 200, `AI suggestions 200 yerine ${aiSuggestionsRes.status}`);
    const aiSuggestionsBody = await json(aiSuggestionsRes);
    assert(aiSuggestionsBody.technicalProfileReadiness?.status === "resolved", "AI suggestions teknik profil readiness status yok.");
    assert(aiSuggestionsBody.technicalProfileReadiness?.source?.snapshotNumber === 2, "AI suggestions teknik profil source snapshot v2 degil.");
    assert(aiSuggestionsBody.technicalProfileReadiness?.note?.includes("dis AI servisine gonderilmedi"), "AI suggestions dis provider gonderilmedi notu yok.");

    const dashboardUnitContext = await api(server.baseUrl, adminToken, `/api/dashboard/technical-profile-context?year=2026&unitId=${unitA1.id}`);
    assert(dashboardUnitContext.status === 200, "Dashboard unit teknik profil context okunamadi.");
    const dashboardUnitBody = await json(dashboardUnitContext);
    assert(dashboardUnitBody.mode === "unit" && dashboardUnitBody.status === "resolved" && dashboardUnitBody.snapshotNumber === 2, "Dashboard unit teknik profil context bozuk.");
    const dashboardAggregate = await api(server.baseUrl, adminToken, `/api/dashboard/technical-profile-context?year=2026`);
    assert(dashboardAggregate.status === 200, "Dashboard aggregate teknik profil context okunamadi.");
    const dashboardAggregateBody = await json(dashboardAggregate);
    assert(dashboardAggregateBody.mode === "company" && dashboardAggregateBody.totalUnits >= 2, "Dashboard aggregate unit sayisi bozuk.");
    assert(dashboardAggregateBody.unitsWithResolvedProfile >= 1, "Dashboard aggregate resolved profil sayisi bozuk.");
    const superDashboardNoContext = await api(server.baseUrl, superadminToken, `/api/dashboard/technical-profile-context?year=2026`);
    assert(superDashboardNoContext.status === 400, "Superadmin dashboard teknik profil context olmadan basarili oldu.");
    assertions += 40;

    const staleImportBuffer = await workbookBuffer(importHeaders, [[unitA1.id, unitA1.name, secondPublishBody.profile.profileVersion, "Stale import", "", "", ""]]);
    const stalePreview = await uploadProfileImport(server.baseUrl, adminToken, "/api/unit-technical-profiles/import/preview", staleImportBuffer);
    const stalePreviewBody = await json(stalePreview);
    assert(stalePreview.status === 200 && stalePreviewBody.errors.some((issue: any) => issue.code === "version_conflict"), "Stale import preview conflict uretmedi.");
    const duplicatePreview = await uploadProfileImport(server.baseUrl, adminToken, "/api/unit-technical-profiles/import/preview", await workbookBuffer(importHeaders, [
      [unitA1.id, unitA1.name, profileAfterImport.profile.profileVersion, "Duplicate A", "", "", ""],
      [unitA1.id, unitA1.name, profileAfterImport.profile.profileVersion, "Duplicate B", "", "", ""],
    ]));
    const duplicatePreviewBody = await json(duplicatePreview);
    assert(duplicatePreviewBody.errors.some((issue: any) => issue.code === "duplicate_unit"), "Duplicate unit import hatasi yok.");
    const invalidPreview = await uploadProfileImport(server.baseUrl, adminToken, "/api/unit-technical-profiles/import/preview", await workbookBuffer(importHeaders, [[
      unitA1.id,
      unitA1.name,
      profileAfterImport.profile.profileVersion,
      "=HYPERLINK(\"x\")",
      -1,
      "maybe",
      "missing_option",
    ]]));
    const invalidPreviewBody = await json(invalidPreview);
    assert(invalidPreviewBody.errors.some((issue: any) => issue.code === "formula_not_allowed"), "Formula cell reddedilmedi.");
    assert(invalidPreviewBody.errors.some((issue: any) => issue.code === "out_of_range"), "Out of range import hatasi yok.");
    assert(invalidPreviewBody.errors.some((issue: any) => issue.code === "invalid_enum"), "Invalid enum import hatasi yok.");
    assert(invalidPreviewBody.errors.some((issue: any) => issue.code === "invalid_custom_value"), "Invalid custom option import hatasi yok.");
    const allOrNothing = await uploadProfileImport(server.baseUrl, adminToken, "/api/unit-technical-profiles/import", await workbookBuffer(importHeaders, [
      [unitA1.id, unitA1.name, profileAfterImport.profile.profileVersion, "Should rollback", "", "", ""],
      [999999, "No unit", "", "Invalid", "", "", ""],
    ]), { confirm: "true" });
    assert(allOrNothing.status === 422, "Hatali import all-or-nothing 422 donmedi.");
    const profileAfterRollback = await json(await api(server.baseUrl, adminToken, `/api/unit-technical-profiles/${unitA1.id}`));
    assert(profileAfterRollback.profile.mainActivity === "Imported draft activity", "All-or-nothing rollback calismadi.");
    const standardCrossUnitImport = await uploadProfileImport(server.baseUrl, standardToken, "/api/unit-technical-profiles/import/preview", await workbookBuffer(importHeaders, [[
      unitA2.id,
      unitA2.name,
      "",
      "Standard cross unit import",
      "",
      "",
      "",
    ]]));
    assert(standardCrossUnitImport.status === 200, "Standard cross-unit import preview hata ozeti donmedi.");
    const standardCrossUnitImportBody = await json(standardCrossUnitImport);
    assert(
      standardCrossUnitImportBody.errors.some((issue: any) => issue.code === "unit_forbidden"),
      "Standard import baska unit satirini preview error olarak reddetmedi.",
    );
    const adminCrossTenantImport = await uploadProfileImport(server.baseUrl, adminToken, "/api/unit-technical-profiles/import/preview", await workbookBuffer(importHeaders, [[
      unitB1.id,
      unitB1.name,
      "",
      "Cross tenant import",
      "",
      "",
      "",
    ]]));
    assert(adminCrossTenantImport.status === 200, "Admin cross-tenant import preview hata ozeti donmedi.");
    const adminCrossTenantImportBody = await json(adminCrossTenantImport);
    assert(
      adminCrossTenantImportBody.errors.some((issue: any) => issue.code === "unit_not_found"),
      "Admin import baska tenant unit satirini preview error olarak reddetmedi.",
    );
    const superImportNoContext = await uploadProfileImport(server.baseUrl, superadminToken, "/api/unit-technical-profiles/import/preview", validImportBuffer);
    assert(superImportNoContext.status === 400, "Superadmin context olmadan import preview alabildi.");
    const superImportWrongContext = await uploadProfileImport(
      server.baseUrl,
      superadminToken,
      `/api/unit-technical-profiles/import/preview?companyId=${standardBUser.company_id}`,
      validImportBuffer,
    );
    assert(superImportWrongContext.status === 200, "Superadmin yanlis context import preview hata ozeti donmedi.");
    const superImportWrongContextBody = await json(superImportWrongContext);
    assert(
      superImportWrongContextBody.errors.some((issue: any) => issue.code === "unit_not_found"),
      "Superadmin yanlis tenant context ile import preview unit_not_found uretmedi.",
    );
    assertions += 13;

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
    const customAudit = audits.rows.find((row) => row.action === "unit_technical_profile.custom_values_updated" && row.changes_text?.includes("phase3c3_process_temperature"));
    assert(customAudit, "Custom values audit yok.");
    assert(!customAudit.changes_text?.includes("42.5"), "Custom values audit ham deger iceriyor.");
    const definitionAudit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE entity_type='unit_technical_profile_field'
       ORDER BY occurred_at, id`,
    );
    assert(definitionAudit.rows.some((row) => row.action === "unit_technical_profile_field.created"), "Definition create audit yok.");
    assert(definitionAudit.rows.some((row) => row.action === "unit_technical_profile_field.archived"), "Definition archive audit yok.");
    const snapshotAudit = await pool.query<{ action: string; metadata_json: any }>(
      `SELECT action, metadata_json
       FROM audit_events
       WHERE entity_type='unit_technical_profile_snapshot' AND unit_id=$1
       ORDER BY id`,
      [unitA1.id],
    );
    assert(snapshotAudit.rows.some((row) => row.action === "unit_technical_profile.snapshot_created" && row.metadata_json?.snapshotNumber === 1), "Snapshot create audit yok.");
    const importAudit = await pool.query<{ action: string; metadata_json: any }>(
      `SELECT action, metadata_json
       FROM audit_events
       WHERE action='unit_technical_profile.import_applied'
       ORDER BY id`,
    );
    assert(importAudit.rows.some((row) => row.metadata_json?.mode === "update_non_empty" && row.metadata_json?.affectedUnitCount === 1), "Import audit summary yok.");
    const exportAudit = await pool.query<{ action: string }>("SELECT action FROM audit_events WHERE action='unit_technical_profile.exported'");
    assert((exportAudit.rowCount ?? 0) >= 1, "Export audit yok.");
    assertions += 11;

    console.log(JSON.stringify({ ok: true, assertions }, null, 2));
  } finally {
    await server.close().catch(() => undefined);
    await pool.end();
  }
}

await main();
