import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDisposableDatabase() {
  assert(process.env.NODE_ENV === "test", "Equipment custom field test NODE_ENV=test gerektirir.");
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Equipment custom field test disposable DB gerektirir.");
  const rawUrl = process.env.DATABASE_URL;
  assert(rawUrl, "DATABASE_URL yok.");
  const url = new URL(rawUrl);
  assert(url.hostname === "127.0.0.1" && url.pathname === "/iso50001_test", "Test DB disposable localhost olmali.");
}

async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function startServer() {
  const port = await reservePort();
  const repoRoot = resolve(import.meta.dirname, "../..");
  let output = "";
  const child: ChildProcess = spawn(process.execPath, ["--enable-source-maps", resolve(repoRoot, "artifacts/api-server/dist/index.mjs")], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), ENABLE_DEMO_SEED: "false", ENABLE_SUPERADMIN_BOOTSTRAP: "false" },
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
          close: async () => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            child.kill("SIGTERM");
            await Promise.race([new Promise<void>((resolveClose) => child.once("close", () => resolveClose())), delay(20_000)]);
          },
        };
      }
    } catch {}
    await delay(250);
  }
  child.kill("SIGKILL");
  throw new Error(`API readiness zaman asimi: ${output.slice(-1000)}`);
}

async function json(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function responseSummary(response: Response) {
  const text = await response.clone().text();
  return text || "<empty>";
}

async function expectStatus(response: Response, expected: number, message: string) {
  assert(response.status === expected, `${message} beklenen ${expected}, alinan ${response.status}: ${await responseSummary(response)}`);
}

async function login(baseUrl: string, username: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: process.env.E2E_TEST_PASSWORD }),
  });
  await expectStatus(response, 200, `${username} login`);
  return (await json(response)).token as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function api(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...auth(token), ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
}

async function createDefinition(baseUrl: string, token: string, body: Record<string, unknown>, companyId?: number) {
  return api(baseUrl, token, `/api/equipment-field-definitions${companyId ? `?companyId=${companyId}` : ""}`, { method: "POST", body: JSON.stringify(body) });
}

async function patchDefinition(baseUrl: string, token: string, id: number, body: Record<string, unknown>, companyId?: number) {
  return api(baseUrl, token, `/api/equipment-field-definitions/${id}${companyId ? `?companyId=${companyId}` : ""}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function postEquipment(baseUrl: string, token: string, body: Record<string, unknown>, companyId?: number) {
  return api(baseUrl, token, `/api/equipment${companyId ? `?companyId=${companyId}` : ""}`, { method: "POST", body: JSON.stringify(body) });
}

async function patchEquipment(baseUrl: string, token: string, id: number, body: Record<string, unknown>, companyId?: number) {
  return api(baseUrl, token, `/api/equipment/${id}${companyId ? `?companyId=${companyId}` : ""}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function main() {
  assertDisposableDatabase();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = await startServer();
  let assertions = 0;
  try {
    const usersResult = await pool.query<{ username: string; company_id: number; unit_id: number | null }>(
      "SELECT username, company_id, unit_id FROM users WHERE username = ANY($1::text[])",
      [[process.env.E2E_ADMIN_USERNAME, process.env.E2E_KONTROL_ADMIN_USERNAME, process.env.E2E_STANDARD_USERNAME, process.env.E2E_STANDARD_B_USERNAME, process.env.E2E_SUPERADMIN_USERNAME].filter(Boolean)],
    );
    const users = new Map(usersResult.rows.map((row) => [row.username, row]));
    const admin = users.get(process.env.E2E_ADMIN_USERNAME!);
    const kontrol = users.get(process.env.E2E_KONTROL_ADMIN_USERNAME!);
    const standard = users.get(process.env.E2E_STANDARD_USERNAME!);
    const standardB = users.get(process.env.E2E_STANDARD_B_USERNAME!);
    assert(admin && kontrol && standard && standardB, "Fixture kullanicilari eksik.");
    assert(standard.unit_id !== null && standardB.unit_id !== null, "Standard unit eksik.");
    const subUnit = await pool.query<{ id: number }>("SELECT id FROM sub_units WHERE company_id=$1 AND unit_id=$2 LIMIT 1", [admin.company_id, standard.unit_id]);

    const adminToken = await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!);
    const kontrolToken = await login(server.baseUrl, process.env.E2E_KONTROL_ADMIN_USERNAME!);
    const standardToken = await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!);
    const standardBToken = await login(server.baseUrl, process.env.E2E_STANDARD_B_USERNAME!);
    const superToken = await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);
    const suffix = Date.now();

    const superNoContext = await api(server.baseUrl, superToken, "/api/equipment-field-definitions");
    await expectStatus(superNoContext, 400, "Superadmin context olmadan definition listeleyememeli");
    const kontrolCreate = await createDefinition(server.baseUrl, kontrolToken, { code: `eq_kontrol_${suffix}`, label: "Kontrol", fieldType: "short_text" });
    await expectStatus(kontrolCreate, 403, "kontrol_admin create reddedilmeli");
    const standardCreate = await createDefinition(server.baseUrl, standardToken, { code: `eq_standard_${suffix}`, label: "Standard", fieldType: "short_text" });
    await expectStatus(standardCreate, 403, "Standard create reddedilmeli");
    assertions += 3;

    const reserved = await createDefinition(server.baseUrl, adminToken, { code: "name", label: "Name", fieldType: "short_text" });
    await expectStatus(reserved, 400, "Reserved code reddedilmeli");
    const invalidCode = await createDefinition(server.baseUrl, adminToken, { code: "1bad", label: "Bad", fieldType: "short_text" });
    await expectStatus(invalidCode, 400, "Invalid code reddedilmeli");
    const invalidType = await createDefinition(server.baseUrl, adminToken, { code: `eq_bad_type_${suffix}`, label: "Bad", fieldType: "file" });
    await expectStatus(invalidType, 400, "Invalid type reddedilmeli");
    const duplicateOption = await createDefinition(server.baseUrl, adminToken, { code: `eq_dup_opt_${suffix}`, label: "Dup", fieldType: "single_select", options: [{ code: "a", label: "A" }, { code: "a", label: "A2" }] });
    await expectStatus(duplicateOption, 400, "Duplicate option code reddedilmeli");
    const invalidUnitNumber = await createDefinition(server.baseUrl, adminToken, { code: `eq_unit_bad_${suffix}`, label: "Unit bad", fieldType: "unit_number" });
    await expectStatus(invalidUnitNumber, 400, "Unit number unit label zorunlu olmali");
    assertions += 5;

    const definitions: any[] = [];
    for (const definition of [
      { code: `eq_short_${suffix}`, label: "Kisa", fieldType: "short_text" },
      { code: `eq_long_${suffix}`, label: "Uzun", fieldType: "long_text" },
      { code: `eq_int_${suffix}`, label: "Tam", fieldType: "integer" },
      { code: `eq_dec_${suffix}`, label: "Ondalik", fieldType: "decimal" },
      { code: `eq_bool_${suffix}`, label: "Durum", fieldType: "boolean" },
      { code: `eq_select_${suffix}`, label: "Secim", fieldType: "single_select", options: [{ code: "aa", label: "A" }, { code: "bb", label: "B" }] },
      { code: `eq_multi_${suffix}`, label: "Cok", fieldType: "multi_select", options: [{ code: "xx", label: "X" }, { code: "yy", label: "Y" }] },
      { code: `eq_date_${suffix}`, label: "Tarih", fieldType: "date" },
      { code: `eq_unit_${suffix}`, label: "Birimli", fieldType: "unit_number", unitLabel: "bar" },
    ]) {
      const response = await createDefinition(server.baseUrl, adminToken, { section: "technical", displayOrder: definitions.length, ...definition });
      await expectStatus(response, 201, `Definition create ${definition.code}`);
      definitions.push((await json(response)).definition);
      assertions += 1;
    }
    const duplicate = await createDefinition(server.baseUrl, adminToken, { code: definitions[0].code, label: "Dup", fieldType: "short_text" });
    await expectStatus(duplicate, 409, "Duplicate definition 409 olmali");
    assertions += 1;

    const updateDef = await patchDefinition(server.baseUrl, adminToken, definitions[0].id, { expectedDefinitionVersion: 1, label: "Kisa guncel" });
    await expectStatus(updateDef, 200, "Definition update");
    const updatedDef = (await json(updateDef)).definition;
    assert(updatedDef.definitionVersion === 2, "Definition version artmadi.");
    const staleDef = await patchDefinition(server.baseUrl, adminToken, definitions[0].id, { expectedDefinitionVersion: 1, label: "stale" });
    await expectStatus(staleDef, 409, "Definition stale 409");
    assertions += 3;

    const baseEquipment = {
      unitId: standard.unit_id,
      subUnitId: subUnit.rows[0]?.id,
      equipmentCode: `EQ3D4-${suffix}`,
      name: "[E2E] Custom field equipment",
      equipmentKind: "physical",
      category: "pump",
      status: "active",
      customValues: {
        [definitions[0].code]: "  hello  ",
        [definitions[1].code]: "long text value",
        [definitions[2].code]: 7,
        [definitions[3].code]: 0,
        [definitions[4].code]: "no",
        [definitions[5].code]: "aa",
        [definitions[6].code]: ["xx", "yy"],
        [definitions[7].code]: "2026-07-20",
        [definitions[8].code]: 0,
      },
    };
    const equipmentRes = await postEquipment(server.baseUrl, adminToken, baseEquipment);
    await expectStatus(equipmentRes, 201, "Equipment custom values create");
    const equipment = await json(equipmentRes);
    assert(equipment.equipment.customValues[definitions[0].code] === "hello", "Short text trimlenmedi.");
    assert(equipment.equipment.customValues[definitions[3].code] === 0 && equipment.equipment.customValues[definitions[8].code] === 0, "0 korunmadi.");
    assert(equipment.equipment.customValues[definitions[4].code] === "no", "Boolean false/no korunmadi.");
    assert(equipment.customFields.some((field: any) => field.code === definitions[5].code && field.value === "aa"), "Detail resolved custom field donmedi.");
    assertions += 5;

    const unknown = await postEquipment(server.baseUrl, adminToken, { ...baseEquipment, equipmentCode: `EQ3D4-UNKNOWN-${suffix}`, customValues: { unknown_code: "x" } });
    await expectStatus(unknown, 400, "Unknown code reddedilmeli");
    const badOption = await postEquipment(server.baseUrl, adminToken, { ...baseEquipment, equipmentCode: `EQ3D4-BADOPT-${suffix}`, customValues: { [definitions[5].code]: "z" } });
    await expectStatus(badOption, 400, "Invalid option reddedilmeli");
    const badNumber = await postEquipment(server.baseUrl, adminToken, { ...baseEquipment, equipmentCode: `EQ3D4-BADNUM-${suffix}`, customValues: { [definitions[2].code]: 1.5 } });
    await expectStatus(badNumber, 400, "Invalid numeric reddedilmeli");
    assertions += 3;

    const id = equipment.equipment.id as number;
    const customPatch = await patchEquipment(server.baseUrl, adminToken, id, { expectedEquipmentVersion: 1, customValues: { [definitions[2].code]: 8, [definitions[3].code]: null } });
    await expectStatus(customPatch, 200, "Custom-only patch");
    const patched = await json(customPatch);
    assert(patched.equipment.equipmentVersion === 2, "Custom-only patch version artirmadi.");
    assert(patched.equipment.customValues[definitions[2].code] === 8 && !(definitions[3].code in patched.equipment.customValues), "Merge/null clear calismadi.");
    const stalePatch = await patchEquipment(server.baseUrl, adminToken, id, { expectedEquipmentVersion: 1, customValues: { [definitions[2].code]: 9 } });
    await expectStatus(stalePatch, 409, "Stale custom patch 409 olmali");
    assertions += 4;

    const usedCodeChange = await patchDefinition(server.baseUrl, adminToken, definitions[2].id, { expectedDefinitionVersion: 1, code: `eq_int_changed_${suffix}` });
    await expectStatus(usedCodeChange, 409, "Kullanilmis code degismemeli");
    const usedTypeChange = await patchDefinition(server.baseUrl, adminToken, definitions[2].id, { expectedDefinitionVersion: 1, fieldType: "decimal" });
    await expectStatus(usedTypeChange, 409, "Kullanilmis type degismemeli");
    assertions += 2;

    const archive = await api(server.baseUrl, adminToken, `/api/equipment-field-definitions/${definitions[0].id}/archive`, { method: "POST", body: JSON.stringify({ expectedDefinitionVersion: 2 }) });
    await expectStatus(archive, 200, "Definition archive");
    const afterArchiveDetail = await api(server.baseUrl, adminToken, `/api/equipment/${id}`);
    await expectStatus(afterArchiveDetail, 200, "Archived definition detail");
    const afterArchive = await json(afterArchiveDetail);
    assert(afterArchive.customFields.some((field: any) => field.code === definitions[0].code && field.isActive === false), "Pasif definition mevcut degerle gorunmedi.");
    const archivedNewValue = await postEquipment(server.baseUrl, adminToken, { ...baseEquipment, equipmentCode: `EQ3D4-ARCH-${suffix}`, customValues: { [definitions[0].code]: "new" } });
    await expectStatus(archivedNewValue, 400, "Pasif definition yeni value reddedilmeli");
    const reactivate = await api(server.baseUrl, adminToken, `/api/equipment-field-definitions/${definitions[0].id}/reactivate`, { method: "POST", body: JSON.stringify({ expectedDefinitionVersion: 3 }) });
    await expectStatus(reactivate, 200, "Definition reactivate");
    assertions += 5;

    const standardUpdate = await patchEquipment(server.baseUrl, standardToken, id, { expectedEquipmentVersion: 2, customValues: { [definitions[2].code]: 10 } });
    await expectStatus(standardUpdate, 200, "Standard kendi unit custom update");
    const standardBOther = await patchEquipment(server.baseUrl, standardBToken, id, { expectedEquipmentVersion: 3, customValues: { [definitions[2].code]: 11 } });
    await expectStatus(standardBOther, 404, "Standard baska unit custom update reddedilmeli");
    const superContext = await api(server.baseUrl, superToken, `/api/equipment-field-definitions?companyId=${admin.company_id}`);
    await expectStatus(superContext, 200, "Superadmin explicit context");
    assertions += 3;

    const audit = await pool.query<{ action: string; changes_json: any; metadata_json: any }>("SELECT action, changes_json, metadata_json FROM audit_events WHERE entity_type IN ('equipment','equipment_field') ORDER BY id");
    assert(audit.rows.some((row) => row.action === "equipment_field.created"), "Definition create audit yok.");
    assert(audit.rows.some((row) => row.action === "equipment_field.archived"), "Definition archive audit yok.");
  assert(audit.rows.some((row) => row.action === "equipment.updated" && JSON.stringify(row.metadata_json).includes(definitions[2].code)), "Custom code audit metadata yok.");
    assert(!audit.rows.some((row) => JSON.stringify(row).includes("long text value")), "Long text audit'e sizdi.");
    assertions += 4;

    console.log(JSON.stringify({ ok: true, assertions }, null, 2));
  } finally {
    await server.close();
    await pool.end();
  }
}

await main();
