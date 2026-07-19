import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  calculateUnitTechnicalProfileCompletion,
  validateUnitTechnicalProfilePublishMinimum,
} from "@workspace/api-zod";

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

async function publishProfile(baseUrl: string, token: string, unitId: number, body: Record<string, unknown>, companyId?: number) {
  const query = companyId === undefined ? "" : `?companyId=${companyId}`;
  return api(baseUrl, token, `/api/unit-technical-profiles/${unitId}/publish${query}`, {
    method: "POST",
    body: JSON.stringify(body),
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
    assertions += 1;

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
      },
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
    assertions += 6;

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
    assertions += 2;

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
    assertions += 6;

    const standardExplicitPublish = await publishProfile(server.baseUrl, standardToken, unitA1.id, {
      expectedProfileVersion: secondPublishBody.profile.profileVersion,
      validFrom: "2026-07-01",
    });
    assert(standardExplicitPublish.status === 403, "Standard explicit publish yapabildi.");
    const superHistoryNoContext = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitA1.id}/history`);
    assert(superHistoryNoContext.status === 400, "Superadmin history context olmadan basarili oldu.");
    const superEffectiveWithContext = await api(server.baseUrl, superadminToken, `/api/unit-technical-profiles/${unitA1.id}/effective?companyId=${adminUser.company_id}&date=2026-07-01`);
    assert(superEffectiveWithContext.status === 200, "Superadmin explicit context effective okuyamadi.");
    assertions += 3;

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
    assertions += 9;

    console.log(JSON.stringify({ ok: true, assertions }, null, 2));
  } finally {
    await server.close().catch(() => undefined);
    await pool.end();
  }
}

await main();
