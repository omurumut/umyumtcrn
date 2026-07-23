import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path, { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

type TestApp = {
  listen(port: number, host: string): {
    once(event: "listening" | "error", listener: (...args: never[]) => void): void;
    address(): AddressInfo | string | null;
    close(callback: (error?: Error) => void): void;
  };
};

type TokenSet = {
  adminA: string;
  kontrolA: string;
  standardA: string;
  adminB: string;
  kontrolB: string;
  standardB: string;
  superadmin: string;
};

type UserRow = { id: number; company_id: number; unit_id: number | null; password_hash?: string };
type StorageModule = {
  reportStorage: {
    provider: string;
    put(input: { key: string; content: Buffer; contentType: string }): Promise<{ contentLength: number; checksumSha256: string }>;
    get(key: string): Promise<unknown>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    list?(input: { prefix: string; continuationToken?: string | null; maxKeys: number }): Promise<{ objects: Array<{ key: string }>; nextContinuationToken: string | null; truncated: boolean }>;
  };
  ReportStorageError: new(category: string) => Error;
};

const counters = {
  retentionSettingsScenarios: 0,
  retentionExpiryScenarios: 0,
  archiveSoftDeleteScenarios: 0,
  archiveRestoreScenarios: 0,
  archivePurgeScenarios: 0,
  archiveDiagnosticsScenarios: 0,
  archiveDetailScenarios: 0,
  archiveCleanupCliScenarios: 0,
  archiveSecurityScenarios: 0,
  archiveAuditScenarios: 0,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bump(key: keyof typeof counters, count = 1): void {
  counters[key] += count;
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function listen(app: TestApp): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolveListen, reject) => {
    server.once("listening", resolveListen);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())),
  };
}

async function login(baseUrl: string, username: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: process.env.E2E_TEST_PASSWORD }),
  });
  assert(response.status === 200, `Login failed for ${username}: ${response.status}`);
  const body = await response.json() as { token?: string };
  assert(body.token, `Token missing for ${username}.`);
  return body.token;
}

async function api(baseUrl: string, method: string, pathName: string, token?: string, body?: unknown): Promise<{ status: number; text: string; json: unknown }> {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: response.status, text, json };
}

async function getUser(username: string, includeHash = false): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `SELECT id, company_id, unit_id ${includeHash ? ", password_hash" : ""} FROM users WHERE username=$1 LIMIT 1`,
    [username],
  );
  const row = result.rows[0];
  assert(row, `Fixture user missing: ${username}`);
  return row;
}

async function ensureTenantBMutationUsers(companyId: number, passwordHash: string): Promise<void> {
  await pool.query(
    `INSERT INTO users(company_id, username, password_hash, name, role, unit_id, active)
     VALUES
       ($1, 'e2e_report_admin_b', $2, 'E2E Report Admin B', 'admin', null, true),
       ($1, 'e2e_report_kontrol_b', $2, 'E2E Report Kontrol B', 'kontrol_admin', null, true)
     ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, company_id=EXCLUDED.company_id, role=EXCLUDED.role, active=true`,
    [companyId, passwordHash],
  );
}

async function seedArchive(input: {
  storage: StorageModule["reportStorage"];
  companyId: number;
  unitId?: number | null;
  generatedBy: number;
  status: "generating" | "completed" | "failed" | "deleted" | "purging" | "purged" | "purge_failed";
  title: string;
  reportType?: string;
  reportYear?: number;
  withObject?: boolean;
  storageKeyOnly?: boolean;
  wrongChecksum?: boolean;
  wrongSize?: boolean;
  deletionLocked?: boolean;
  previousStatus?: "completed" | "failed" | null;
  retentionExpiresAt?: Date | null;
  purgeEligibleAt?: Date | null;
  generatedAt?: Date;
  snapshotId?: number | null;
}): Promise<{ id: number; key: string | null; content: Buffer }> {
  const reportType = input.reportType ?? "annual_energy_performance";
  const reportYear = input.reportYear ?? 2026;
  const content = Buffer.from(`<!doctype html><html><body>${input.title}</body></html>`, "utf8");
  const now = input.generatedAt ?? daysAgo(10);
  const completedAt = ["completed", "deleted", "purging", "purged", "purge_failed"].includes(input.status) ? now : null;
  const failedAt = input.status === "failed" || input.previousStatus === "failed" ? now : null;
  const deletedAt = input.status === "deleted" ? daysAgo(45) : null;
  const purgedAt = input.status === "purged" ? daysAgo(1) : null;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO report_archives(
       company_id, unit_id, report_type, report_year, title, output_name, content_type,
       status, generated_by, generated_at, completed_at, failed_at, failure_category,
       deleted_at, deleted_by, delete_reason, purge_eligible_at, purged_at, purged_by,
       purge_failure_category, retention_expires_at, deletion_locked, previous_status,
       size_bytes, checksum_sha256, storage_provider, storage_key, snapshot_id
     )
     VALUES($1,$2,$3,$4,$5,$6,'text/html; charset=utf-8',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,null,null,null,null,$23)
     RETURNING id`,
    [
      input.companyId,
      input.unitId ?? null,
      reportType,
      reportYear,
      input.title,
      `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`,
      input.status,
      input.generatedBy,
      now,
      completedAt,
      failedAt,
      input.status === "failed" ? "render_failed" : null,
      deletedAt,
      deletedAt ? input.generatedBy : null,
      deletedAt ? "fixture-delete" : null,
      input.purgeEligibleAt ?? (deletedAt ? addDays(deletedAt, 30) : null),
      purgedAt,
      purgedAt ? input.generatedBy : null,
      input.status === "purge_failed" ? "storage_delete_failed" : null,
      input.retentionExpiresAt ?? null,
      input.deletionLocked === true,
      input.previousStatus ?? (input.status === "deleted" || input.status === "purge_failed" ? "completed" : null),
      input.snapshotId ?? null,
    ],
  );
  const id = result.rows[0]!.id;
  const key = (input.withObject || input.storageKeyOnly)
    ? `companies/${input.companyId}/reports/${reportType}/${reportYear}/${id}/${id}-${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`
    : null;
  if (input.withObject && key) await input.storage.put({ key, content, contentType: "text/html; charset=utf-8" });
  if (key) {
    await pool.query(
      "UPDATE report_archives SET storage_provider='local', storage_key=$2, size_bytes=$3, checksum_sha256=$4 WHERE id=$1",
      [id, key, input.wrongSize ? content.length + 5 : content.length, input.wrongChecksum ? "0".repeat(64) : sha256(content)],
    );
  }
  return { id, key, content };
}

async function seedSnapshot(input: {
  companyId: number;
  unitId?: number | null;
  generatedBy: number;
  reportType?: string;
  year?: number;
  payload: Record<string, unknown>;
  dataManifest?: Record<string, unknown> | null;
}): Promise<number> {
  const reportType = input.reportType ?? "annual_energy_performance";
  const result = await pool.query<{ id: number }>(
    `INSERT INTO report_generation_snapshots(
       company_id, unit_id, report_type, year, status, storage_status, filename,
       settings_snapshot_json, data_manifest_json, generated_by, completed_at
     )
     VALUES($1,$2,$3,$4,'completed','not_stored',$5,$6::jsonb,$7::jsonb,$8,$9)
     RETURNING id`,
    [
      input.companyId,
      input.unitId ?? null,
      reportType,
      input.year ?? 2026,
      `retention-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
      JSON.stringify({ fixture: "archive-detail", reportType, ...input.payload }),
      input.dataManifest === undefined ? null : JSON.stringify(input.dataManifest),
      input.generatedBy,
      new Date(),
    ],
  );
  return result.rows[0]!.id;
}

async function archiveRow(id: number): Promise<Record<string, unknown>> {
  const result = await pool.query("SELECT * FROM report_archives WHERE id=$1", [id]);
  const row = result.rows[0];
  assert(row, `Archive missing: ${id}`);
  return row;
}

async function auditCount(action: string, entityId?: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_events WHERE action=$1 ${entityId === undefined ? "" : "AND entity_id=$2"}`,
    entityId === undefined ? [action] : [action, String(entityId)],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function assertNoAuditLeak(action: string): Promise<void> {
  const result = await pool.query<{ text: string }>("SELECT coalesce(metadata_json::text, '') AS text FROM audit_events WHERE action=$1", [action]);
  for (const row of result.rows) {
    assert(!row.text.includes("companies/") && !row.text.toLowerCase().includes("secret") && !row.text.includes("REPORT_STORAGE"), `${action} audit leaked sensitive storage data.`);
  }
  bump("archiveAuditScenarios");
}

async function setupFixtures(storage: StorageModule["reportStorage"]) {
  const adminA = await getUser(process.env.E2E_ADMIN_USERNAME!, true);
  const kontrolA = await getUser(process.env.E2E_KONTROL_ADMIN_USERNAME!);
  const standardA = await getUser(process.env.E2E_STANDARD_USERNAME!);
  const standardB = await getUser(process.env.E2E_STANDARD_B_USERNAME!);
  const superadmin = await getUser(process.env.E2E_SUPERADMIN_USERNAME!);
  assert(adminA.password_hash, "Admin password hash missing.");
  await ensureTenantBMutationUsers(standardB.company_id, adminA.password_hash);
  const adminB = await getUser("e2e_report_admin_b");
  const kontrolB = await getUser("e2e_report_kontrol_b");

  await pool.query("DELETE FROM report_archives WHERE title LIKE 'retention fixture %'");
  await pool.query("DELETE FROM report_generation_snapshots WHERE filename LIKE 'retention-fixture-%' OR settings_snapshot_json->>'fixture' = 'archive-detail'");
  await pool.query("DELETE FROM company_report_retention_settings WHERE company_id IN ($1,$2)", [adminA.company_id, standardB.company_id]);

  return { adminA, kontrolA, standardA, standardB, adminB, kontrolB, superadmin, companyA: adminA.company_id, companyB: standardB.company_id };
}

async function testRetentionSettings(baseUrl: string, tokens: TokenSet, companyA: number, companyB: number): Promise<void> {
  const defaults = await api(baseUrl, "GET", "/api/company-report-settings/retention", tokens.adminA);
  assert(defaults.status === 200, "Admin retention defaults failed.");
  const defaultBody = defaults.json as { settings: { retentionEnabled: boolean; completedRetentionDays: number; failedRetentionDays: number; deletedGraceDays: number; settingsVersion: number; automaticCleanupAllowed: boolean }; permissions: { canEdit: boolean } };
  assert(defaultBody.settings.retentionEnabled === false, "Default retention should be disabled.");
  assert(defaultBody.settings.completedRetentionDays === 3650 && defaultBody.settings.failedRetentionDays === 90 && defaultBody.settings.deletedGraceDays === 30, "Default retention bounds mismatch.");
  assert(defaultBody.settings.automaticCleanupAllowed === false && defaultBody.permissions.canEdit === true, "Retention response safety mismatch.");
  bump("retentionSettingsScenarios", 4);

  const created = await api(baseUrl, "PATCH", "/api/company-report-settings/retention", tokens.adminA, {
    retentionEnabled: true,
    completedRetentionDays: 365,
    failedRetentionDays: 30,
    deletedGraceDays: 7,
    expectedSettingsVersion: 0,
  });
  assert(created.status === 200 && (created.json as { settings: { settingsVersion: number } }).settings.settingsVersion === 1, "Minimum retention update failed.");
  const maxed = await api(baseUrl, "PATCH", "/api/company-report-settings/retention", tokens.adminA, {
    retentionEnabled: true,
    completedRetentionDays: 36500,
    failedRetentionDays: 3650,
    deletedGraceDays: 365,
    expectedSettingsVersion: 1,
  });
  assert(maxed.status === 200 && (maxed.json as { settings: { settingsVersion: number } }).settings.settingsVersion === 2, "Maximum retention update failed.");
  bump("retentionSettingsScenarios", 6);

  for (const body of [
    { retentionEnabled: true, completedRetentionDays: 364, failedRetentionDays: 30, deletedGraceDays: 7, expectedSettingsVersion: 2 },
    { retentionEnabled: true, completedRetentionDays: 36501, failedRetentionDays: 30, deletedGraceDays: 7, expectedSettingsVersion: 2 },
    { retentionEnabled: true, completedRetentionDays: 365.5, failedRetentionDays: 30, deletedGraceDays: 7, expectedSettingsVersion: 2 },
    { retentionEnabled: true, completedRetentionDays: "365", failedRetentionDays: 30, deletedGraceDays: 7, expectedSettingsVersion: 2 },
    { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 29, deletedGraceDays: 7, expectedSettingsVersion: 2 },
    { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 3651, deletedGraceDays: 7, expectedSettingsVersion: 2 },
    { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 30, deletedGraceDays: 6, expectedSettingsVersion: 2 },
    { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 30, deletedGraceDays: 366, expectedSettingsVersion: 2 },
  ]) {
    assert((await api(baseUrl, "PATCH", "/api/company-report-settings/retention", tokens.adminA, body)).status === 400, "Invalid retention body accepted.");
    bump("retentionSettingsScenarios");
  }
  assert((await api(baseUrl, "PATCH", "/api/company-report-settings/retention", tokens.kontrolA, { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 30, deletedGraceDays: 7, expectedSettingsVersion: 2 })).status === 403, "Kontrol admin mutated retention.");
  assert((await api(baseUrl, "GET", "/api/company-report-settings/retention", tokens.standardA)).status === 403, "Standard read retention.");
  assert((await api(baseUrl, "PATCH", "/api/company-report-settings/retention", tokens.standardA, { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 30, deletedGraceDays: 7, expectedSettingsVersion: 2 })).status === 403, "Standard mutated retention.");
  assert((await api(baseUrl, "PATCH", `/api/company-report-settings/retention?companyId=${companyB}`, tokens.adminA, { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 30, deletedGraceDays: 7, expectedSettingsVersion: 2 })).status === 400, "Admin accepted foreign company context.");
  assert((await api(baseUrl, "GET", "/api/company-report-settings/retention", tokens.superadmin)).status === 400, "Superadmin implicit retention context accepted.");
  assert((await api(baseUrl, "GET", `/api/company-report-settings/retention?companyId=${companyA}`, tokens.superadmin)).status === 200, "Superadmin explicit retention context failed.");
  assert((await api(baseUrl, "PATCH", "/api/company-report-settings/retention", tokens.adminA, { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 30, deletedGraceDays: 7, expectedSettingsVersion: 1 })).status === 409, "Retention version conflict failed.");
  bump("retentionSettingsScenarios", 7);
  assert(await auditCount("report_retention_settings.created") >= 1 && await auditCount("report_retention_settings.updated") >= 1, "Retention audit missing.");
  await assertNoAuditLeak("report_retention_settings.updated");
}

async function testExpiryMaterialization(storageModule: StorageModule, companyA: number, adminA: UserRow): Promise<void> {
  const retentionModule = await import(pathToFileURL(resolve(__dirname, "../../artifacts/api-server/src/lib/report-retention.ts")).href) as {
    calculateRetentionExpiresAt(input: { status: "completed" | "failed"; completedAt?: Date | null; failedAt?: Date | null; generatedAt: Date; settings: { retentionEnabled: boolean; completedRetentionDays: number; failedRetentionDays: number } }): Date | null;
    calculatePurgeEligibleAt(date: Date, days: number): Date;
  };
  const archiveModule = await import(pathToFileURL(resolve(__dirname, "../../artifacts/api-server/src/lib/report-archive.ts")).href) as {
    createReportArchiveRecord(input: Record<string, unknown>): Promise<number>;
    completeReportArchive(input: Record<string, unknown>): Promise<{ storageKey: string }>;
    failReportArchive(input: Record<string, unknown>): Promise<void>;
  };
  const reference = new Date("2026-03-29T00:00:00.000Z");
  assert(retentionModule.calculateRetentionExpiresAt({ status: "completed", completedAt: reference, generatedAt: reference, settings: { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 30 } })?.toISOString() === "2027-03-29T00:00:00.000Z", "Completed retention UTC calculation failed.");
  assert(retentionModule.calculateRetentionExpiresAt({ status: "failed", failedAt: reference, generatedAt: reference, settings: { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 30 } })?.toISOString() === "2026-04-28T00:00:00.000Z", "Failed retention UTC calculation failed.");
  assert(retentionModule.calculateRetentionExpiresAt({ status: "completed", generatedAt: new Date("1999-01-01T00:00:00Z"), settings: { retentionEnabled: true, completedRetentionDays: 365, failedRetentionDays: 30 } }) === null, "Unsafe fallback date accepted.");
  assert(retentionModule.calculateRetentionExpiresAt({ status: "completed", completedAt: reference, generatedAt: reference, settings: { retentionEnabled: false, completedRetentionDays: 365, failedRetentionDays: 30 } }) === null, "Disabled retention should not materialize.");
  assert(retentionModule.calculatePurgeEligibleAt(reference, 7).toISOString() === "2026-04-05T00:00:00.000Z", "Soft-delete grace UTC calculation failed.");
  bump("retentionExpiryScenarios", 5);

  await pool.query(
    `INSERT INTO company_report_retention_settings(company_id, retention_enabled, completed_retention_days, failed_retention_days, deleted_grace_days, settings_version, updated_by)
     VALUES($1, true, 365, 30, 7, 1, $2)
     ON CONFLICT (company_id) DO UPDATE SET retention_enabled=true, completed_retention_days=365, failed_retention_days=30, deleted_grace_days=7, settings_version=1, updated_by=$2`,
    [companyA, adminA.id],
  );
  const request = { user: { userId: adminA.id, role: "admin", companyId: companyA, unitId: adminA.unit_id }, id: "retention-materialization", headers: {} };
  const archiveId = await archiveModule.createReportArchiveRecord({
    request,
    companyId: companyA,
    unitId: adminA.unit_id,
    reportType: "annual_energy_performance",
    reportYear: 2026,
    title: "retention fixture materialized completed",
    outputName: "retention-materialized.html",
    contentType: "text/html; charset=utf-8",
    snapshotId: null,
  });
  await archiveModule.completeReportArchive({
    request,
    archiveId,
    companyId: companyA,
    unitId: adminA.unit_id,
    reportType: "annual_energy_performance",
    reportYear: 2026,
    outputName: "retention-materialized.html",
    contentType: "text/html; charset=utf-8",
    content: Buffer.from("<!doctype html><html><body>materialized</body></html>"),
    snapshotId: null,
  });
  const completed = await archiveRow(archiveId);
  assert(completed.retention_expires_at instanceof Date && completed.completed_at instanceof Date, "Completed retention was not materialized.");
  assert(Math.abs((completed.retention_expires_at as Date).getTime() - addDays(completed.completed_at as Date, 365).getTime()) < 5000, "Completed retention materialized with wrong policy.");
  const oldExpiry = (completed.retention_expires_at as Date).toISOString();
  await pool.query("UPDATE company_report_retention_settings SET completed_retention_days=730, settings_version=2 WHERE company_id=$1", [companyA]);
  assert(((await archiveRow(archiveId)).retention_expires_at as Date).toISOString() === oldExpiry, "Policy update retroactively changed old archive expiry.");
  const failedId = await seedArchive({ storage: storageModule.reportStorage, companyId: companyA, unitId: adminA.unit_id, generatedBy: adminA.id, status: "generating", title: "retention fixture materialized failed" });
  await archiveModule.failReportArchive({
    request,
    archiveId: failedId.id,
    companyId: companyA,
    unitId: adminA.unit_id,
    reportType: "annual_energy_performance",
    snapshotId: null,
    failureCategory: "fixture_failure",
    outputName: "retention-failed.html",
  });
  assert((await archiveRow(failedId.id)).retention_expires_at instanceof Date, "Failed retention was not materialized.");
  bump("retentionExpiryScenarios", 4);
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  assert(typeof value === "object" && value !== null && !Array.isArray(value), message);
  return value as Record<string, unknown>;
}

function assertNoDetailLeak(text: string): void {
  for (const forbidden of ["storageKey", "storageProvider", "storage_key", "storage_provider", "bucket", "secret", "companies/", "settingsSnapshot", "settings_snapshot_json"]) {
    assert(!text.includes(forbidden), `Detail response leaked forbidden token: ${forbidden}`);
  }
}

async function testArchiveDetail(baseUrl: string, tokens: TokenSet, storageModule: StorageModule, users: Awaited<ReturnType<typeof setupFixtures>>): Promise<void> {
  const fixtureManifest = {
    schemaVersion: 1,
    reportType: "annual_energy_performance",
    scope: {
      companyId: users.companyA,
      unitId: users.standardA.unit_id,
      companyWide: false,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      year: 2026,
      timezone: "Europe/Istanbul",
    },
    filters: { includeSwot: true, includeRisks: true, includeSeu: true },
    sources: [
      {
        sourceType: "annual_consumption",
        recordCount: 12,
        identityHash: "a".repeat(64),
        identityAlgorithm: "sha256",
        identitySchemaVersion: 1,
        summary: { mustNotExpose: "hidden" },
      },
      {
        sourceType: "annual_seu",
        recordCount: 2,
        identityHash: "b".repeat(64),
        identityAlgorithm: "sha256",
        identitySchemaVersion: 1,
      },
    ],
    qualityWarnings: [
      {
        code: "MISSING_CONSUMPTION_MONTHS",
        severity: "warning",
        sourceType: "annual_consumption",
        count: 1,
        periods: ["2026-12"],
        message: "safe typed warning",
      },
    ],
    isPartial: true,
    settings: {
      profileVersion: 7,
      typeSettingsVersion: 9,
      documentNumber: "ENR-RPT-001",
      revisionNumber: "R1",
      revisionDate: "2026-07-23",
    },
    generatedAt: "2026-07-23T10:00:00.000Z",
    manifestHash: "c".repeat(64),
  };
  const snapshotId = await seedSnapshot({
    companyId: users.companyA,
    unitId: users.standardA.unit_id,
    generatedBy: users.adminA.id,
    payload: {
      reportDisplayName: "Fixture Annual Detail",
      profileVersion: 7,
      typeSettingsVersion: 9,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      documentNumber: "ENR-RPT-001",
      revisionNumber: "R1",
      revisionDate: "2026-07-23",
      preparedBy: "Prep User",
      checkedBy: "Check User",
      approvedBy: "Approve User",
      confidentiality: "internal",
      footerText: "Footer",
      evaluatorSummary: { consumptionRows: 12, includesRegression: true, note: "safe", nested: { raw: true }, tooLong: "x".repeat(200) },
      technicalProfile: { warning: "technical warning" },
      equipmentInventory: { warnings: ["inventory warning", { raw: true }] },
      storageKey: "must-not-leak",
    },
    dataManifest: fixtureManifest,
  });
  const completed = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, unitId: users.standardA.unit_id, generatedBy: users.adminA.id, status: "completed", title: "retention fixture detail completed", withObject: true, snapshotId });
  const adminDetail = await api(baseUrl, "GET", `/api/reports/archive/${completed.id}/detail`, tokens.adminA);
  assert(adminDetail.status === 200, `Admin detail failed: ${adminDetail.status}`);
  assertNoDetailLeak(adminDetail.text);
  const adminBody = asRecord(adminDetail.json, "Detail body is not an object.");
  const archive = asRecord(adminBody.archive, "Detail archive missing.");
  const scope = asRecord(adminBody.scope, "Detail scope missing.");
  const generation = asRecord(adminBody.generation, "Detail generation missing.");
  const document = asRecord(adminBody.document, "Detail document missing.");
  const dataScope = asRecord(adminBody.dataScope, "Detail dataScope missing.");
  const failure = asRecord(adminBody.failure, "Detail failure missing.");
  assert(archive.id === completed.id && archive.status === "completed" && archive.canDownload === true && archive.canRestore === false, "Completed archive detail flags are wrong.");
  assert(scope.companyId === users.companyA && scope.unitId === users.standardA.unit_id && scope.periodStart === "2026-01-01", "Detail scope fields are wrong.");
  assert(generation.snapshotId === snapshotId && generation.settingsProfileVersion === 7 && generation.reportTypeSettingsVersion === 9, "Snapshot version fields are wrong.");
  assert(document.documentNumber === "ENR-RPT-001" && document.confidentialityLevel === "internal", "Document fields are wrong.");
  assert(dataScope.manifestHash === "c".repeat(64) && dataScope.isPartial === true, "Manifest summary hash/partial failed.");
  assert(asRecord(dataScope.period, "Manifest period missing.").periodStart === "2026-01-01", "Manifest period summary failed.");
  const sources = dataScope.sources as Array<Record<string, unknown>>;
  assert(Array.isArray(sources) && sources.length === 2 && sources[0]?.sourceType === "annual_consumption" && sources[0].recordCount === 12, "Manifest source summary failed.");
  assert(!JSON.stringify(dataScope).includes("mustNotExpose"), "Manifest summary exposed source internals.");
  const warnings = dataScope.qualityWarnings as Array<Record<string, unknown>>;
  assert(Array.isArray(warnings) && warnings[0]?.code === "MISSING_CONSUMPTION_MONTHS" && warnings[0].sourceType === "annual_consumption", "Manifest warning summary failed.");
  assert(failure.category === null && failure.message === null && failure.retryable === false, "Completed failure contract is wrong.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${completed.id}/detail`, tokens.kontrolA)).status === 200, "Kontrol admin detail failed.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${completed.id}/detail`, tokens.standardA)).status === 200, "Standard own-unit detail failed.");

  const outsideUnit = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, unitId: null, generatedBy: users.adminA.id, status: "completed", title: "retention fixture detail outside unit", withObject: true });
  const foreign = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyB, unitId: users.standardB.unit_id, generatedBy: users.standardB.id, status: "completed", title: "retention fixture detail foreign", withObject: true });
  const notFound = await api(baseUrl, "GET", `/api/reports/archive/${outsideUnit.id}/detail`, tokens.standardA);
  const foreignHidden = await api(baseUrl, "GET", `/api/reports/archive/${foreign.id}/detail`, tokens.adminA);
  const missing = await api(baseUrl, "GET", "/api/reports/archive/999999999/detail", tokens.adminA);
  assert(notFound.status === 404 && foreignHidden.status === 404 && missing.status === 404, "Detail safe 404 behavior failed.");
  assert(foreignHidden.text === missing.text, "Foreign archive existence leaked through error body.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${completed.id}/detail`, tokens.superadmin)).status === 400, "Superadmin implicit detail accepted.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${completed.id}/detail?companyId=${users.companyA}`, tokens.superadmin)).status === 200, "Superadmin explicit detail failed.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${completed.id}/detail?companyId=${users.companyB}`, tokens.superadmin)).status === 404, "Superadmin wrong-company detail did not hide archive.");

  const deleted = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture detail deleted", withObject: true, previousStatus: "completed" });
  const deletedResponse = await api(baseUrl, "GET", `/api/reports/archive/${deleted.id}/detail`, tokens.adminA);
  assert(deletedResponse.status === 200, "Deleted detail failed.");
  const deletedArchive = asRecord(asRecord(deletedResponse.json, "Deleted detail body missing.").archive, "Deleted detail archive missing.");
  assert(deletedArchive.status === "deleted" && deletedArchive.canDownload === false && deletedArchive.canRestore === true && typeof deletedArchive.deletedAt === "string", "Deleted lifecycle detail is wrong.");
  const failed = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "failed", title: "retention fixture detail failed", withObject: true });
  const failedResponse = await api(baseUrl, "GET", `/api/reports/archive/${failed.id}/detail`, tokens.adminA);
  assert(failedResponse.status === 200, "Failed detail failed.");
  const failedFailure = asRecord(asRecord(failedResponse.json, "Failed detail body missing.").failure, "Failed detail failure missing.");
  assert(failedFailure.category === "render_failed" && failedFailure.message === "render_failed" && failedFailure.retryable === false, "Failed detail contract is wrong.");
  const noSnapshot = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture detail no snapshot", withObject: true });
  const noSnapshotResponse = await api(baseUrl, "GET", `/api/reports/archive/${noSnapshot.id}/detail`, tokens.adminA);
  assert(noSnapshotResponse.status === 200, "No-snapshot detail failed.");
  const noSnapshotDetail = asRecord(noSnapshotResponse.json, "No-snapshot detail body missing.");
  assert(asRecord(noSnapshotDetail.generation, "No-snapshot generation missing.").snapshotId === null, "No-snapshot snapshotId is wrong.");
  assert(noSnapshotDetail.dataScope === null, "No-snapshot dataScope should be null.");
  const invalidSnapshotId = await seedSnapshot({ companyId: users.companyA, generatedBy: users.adminA.id, payload: { profileVersion: "bad", evaluatorSummary: { ok: 1, nested: { raw: true } }, equipmentInventory: { warnings: ["valid warning", { raw: true }] } } });
  const invalid = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture detail invalid snapshot", withObject: true, snapshotId: invalidSnapshotId });
  const invalidResponse = await api(baseUrl, "GET", `/api/reports/archive/${invalid.id}/detail`, tokens.adminA);
  assert(invalidResponse.status === 200, "Invalid-snapshot detail failed.");
  const invalidDetail = asRecord(invalidResponse.json, "Invalid-snapshot detail body missing.");
  assert(asRecord(invalidDetail.generation, "Invalid generation missing.").settingsProfileVersion === null, "Invalid snapshot profile version should be null.");
  assert(invalidDetail.dataScope === null, "Invalid manifest dataScope should be null.");
  assert(await auditCount("report_archive.detail_viewed", completed.id) === 0, "Read-only detail wrote audit event.");
  bump("archiveDetailScenarios", 18);
}

async function testLifecycle(baseUrl: string, tokens: TokenSet, storageModule: StorageModule, users: Awaited<ReturnType<typeof setupFixtures>>): Promise<void> {
  const completed = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, unitId: users.adminA.unit_id, generatedBy: users.adminA.id, status: "completed", title: "retention fixture delete completed", withObject: true });
  const failed = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, unitId: users.adminA.unit_id, generatedBy: users.adminA.id, status: "failed", title: "retention fixture delete failed", withObject: true });
  const foreign = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyB, unitId: users.standardB.unit_id, generatedBy: users.standardB.id, status: "completed", title: "retention fixture foreign completed", withObject: true });
  assert((await api(baseUrl, "DELETE", `/api/reports/archive/${completed.id}`)).status === 401, "Unauthenticated delete was not rejected.");
  assert((await api(baseUrl, "DELETE", `/api/reports/archive/${completed.id}`, tokens.standardA, { reason: "x" })).status === 403, "Standard delete was not rejected.");
  assert((await api(baseUrl, "DELETE", `/api/reports/archive/${completed.id}`, tokens.kontrolA, { reason: "x" })).status === 403, "Kontrol delete was not rejected.");
  assert((await api(baseUrl, "DELETE", `/api/reports/archive/${foreign.id}`, tokens.adminA, { reason: "x" })).status === 404, "Foreign tenant delete did not hide archive.");
  bump("archiveSoftDeleteScenarios", 4);
  const deleted = await api(baseUrl, "DELETE", `/api/reports/archive/${completed.id}`, tokens.adminA, { reason: "fixture delete reason with companies/secret/path ".repeat(8) });
  assert(deleted.status === 200, `Admin delete failed: ${deleted.status}`);
  const deletedRow = await archiveRow(completed.id);
  assert(deletedRow.status === "deleted" && deletedRow.previous_status === "completed" && deletedRow.deleted_by === users.adminA.id && deletedRow.deleted_at instanceof Date && deletedRow.purge_eligible_at instanceof Date && Number(deletedRow.lifecycle_version) > 1, "Soft-delete lifecycle fields mismatch.");
  assert(completed.key && await storageModule.reportStorage.exists(completed.key), "Soft-delete removed storage object.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${completed.id}/download`, tokens.adminA)).status === 409, "Deleted archive remained downloadable.");
  const listDefault = await api(baseUrl, "GET", "/api/reports/archive", tokens.adminA);
  assert(!((listDefault.json as { items?: Array<{ id?: number }> }).items ?? []).some(item => item.id === completed.id), "Deleted archive appeared in default list.");
  const listDeleted = await api(baseUrl, "GET", "/api/reports/archive?status=deleted", tokens.adminA);
  assert(((listDeleted.json as { items?: Array<{ id?: number }> }).items ?? []).some(item => item.id === completed.id), "Deleted archive missing from deleted filter.");
  assert((await api(baseUrl, "DELETE", `/api/reports/archive/${failed.id}`, tokens.adminA, { reason: "failed delete" })).status === 200, "Failed archive delete failed.");
  bump("archiveSoftDeleteScenarios", 8);
  for (const status of ["generating", "purging", "purged", "deleted"] as const) {
    const seeded = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status, title: `retention fixture delete blocked ${status}`, withObject: status !== "generating" && status !== "purged" });
    assert((await api(baseUrl, "DELETE", `/api/reports/archive/${seeded.id}`, tokens.adminA, { reason: "blocked" })).status === 409, `${status} archive delete was not blocked.`);
    bump("archiveSoftDeleteScenarios");
  }
  const locked = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture delete locked", withObject: true, deletionLocked: true });
  assert((await api(baseUrl, "DELETE", `/api/reports/archive/${locked.id}`, tokens.adminA, { reason: "locked" })).status === 409, "Deletion-locked archive was deleted.");
  const superDelete = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyB, generatedBy: users.standardB.id, status: "completed", title: "retention fixture super delete", withObject: true });
  assert((await api(baseUrl, "DELETE", `/api/reports/archive/${superDelete.id}`, tokens.superadmin, { reason: "x" })).status === 400, "Superadmin implicit delete accepted.");
  assert((await api(baseUrl, "DELETE", `/api/reports/archive/${superDelete.id}?companyId=${users.companyB}`, tokens.superadmin, { reason: "x" })).status === 200, "Superadmin explicit delete failed.");
  bump("archiveSoftDeleteScenarios", 3);
  assert(await auditCount("report_archive.soft_deleted", completed.id) === 1, "Soft-delete audit missing.");
  await assertNoAuditLeak("report_archive.soft_deleted");

  const restoreSource = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture restore completed", withObject: true, previousStatus: "completed" });
  const restoreMissing = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture restore missing", storageKeyOnly: true, previousStatus: "completed" });
  assert((await api(baseUrl, "POST", `/api/reports/archive/${restoreSource.id}/restore`)).status === 401, "Unauthenticated restore was not rejected.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${restoreSource.id}/restore`, tokens.standardA, {})).status === 403, "Standard restore was not rejected.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${restoreSource.id}/restore`, tokens.kontrolA, {})).status === 403, "Kontrol restore was not rejected.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${foreign.id}/restore`, tokens.adminA, {})).status === 404, "Foreign tenant restore did not hide archive.");
  bump("archiveRestoreScenarios", 4);
  const restored = await api(baseUrl, "POST", `/api/reports/archive/${restoreSource.id}/restore`, tokens.adminA, {});
  assert(restored.status === 200, `Restore failed: ${restored.status}`);
  const restoredRow = await archiveRow(restoreSource.id);
  assert(restoredRow.status === "completed" && restoredRow.previous_status === null && restoredRow.deleted_at === null && restoredRow.purge_eligible_at === null && Number(restoredRow.lifecycle_version) > 1, "Restore lifecycle fields mismatch.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${restoreSource.id}/download`, tokens.adminA)).status === 200, "Restored completed archive was not downloadable.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${restoreMissing.id}/restore`, tokens.adminA, {})).status === 409, "Missing storage restore succeeded.");
  for (const status of ["completed", "purging", "purged"] as const) {
    const seeded = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status, title: `retention fixture restore blocked ${status}`, withObject: status !== "purged" });
    assert((await api(baseUrl, "POST", `/api/reports/archive/${seeded.id}/restore`, tokens.adminA, {})).status === 409, `${status} archive restore was not blocked.`);
    bump("archiveRestoreScenarios");
  }
  assert(await auditCount("report_archive.restored", restoreSource.id) === 1, "Restore audit missing.");
  assert(await auditCount("report_archive.restored", restoreMissing.id) === 0, "Failed restore wrote success audit.");
  await assertNoAuditLeak("report_archive.restored");
  bump("archiveRestoreScenarios", 5);
}

async function testPurge(baseUrl: string, tokens: TokenSet, storageModule: StorageModule, users: Awaited<ReturnType<typeof setupFixtures>>): Promise<void> {
  await pool.query("UPDATE company_report_retention_settings SET retention_enabled=true, completed_retention_days=365, failed_retention_days=30, deleted_grace_days=7 WHERE company_id=$1", [users.companyA]);
  const eligible = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture purge eligible", withObject: true, purgeEligibleAt: daysAgo(2) });
  const foreign = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyB, generatedBy: users.standardB.id, status: "deleted", title: "retention fixture purge foreign", withObject: true, purgeEligibleAt: daysAgo(2) });
  assert((await api(baseUrl, "POST", `/api/reports/archive/${eligible.id}/purge`, undefined, { ack: `PURGE_ARCHIVE_${eligible.id}` })).status === 401, "Unauthenticated purge was not rejected.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${eligible.id}/purge`, tokens.standardA, { ack: `PURGE_ARCHIVE_${eligible.id}` })).status === 403, "Standard purge was not rejected.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${eligible.id}/purge`, tokens.kontrolA, { ack: `PURGE_ARCHIVE_${eligible.id}` })).status === 403, "Kontrol purge was not rejected.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${foreign.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${foreign.id}` })).status === 404, "Foreign purge did not return safe 404.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${eligible.id}/purge`, tokens.adminA, { ack: "wrong" })).status === 400, "Purge ACK guard failed.");
  bump("archivePurgeScenarios", 5);
  const purged = await api(baseUrl, "POST", `/api/reports/archive/${eligible.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${eligible.id}` });
  assert(purged.status === 200 && (purged.json as { status?: string }).status === "purged", "Eligible purge failed.");
  const purgedRow = await archiveRow(eligible.id);
  assert(purgedRow.status === "purged" && purgedRow.purged_at instanceof Date && purgedRow.purged_by === users.adminA.id && purgedRow.storage_key === null, "Purge lifecycle fields mismatch.");
  assert(eligible.key && !(await storageModule.reportStorage.exists(eligible.key)), "Purge did not remove storage object.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${eligible.id}/download`, tokens.adminA)).status === 409, "Purged archive was downloadable.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${eligible.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${eligible.id}` })).status === 409, "Repeated purge was not safely rejected.");
  bump("archivePurgeScenarios", 6);
  for (const blocked of [
    await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture purge grace", withObject: true, purgeEligibleAt: addDays(new Date(), 2) }),
    await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture purge retention future", withObject: true, retentionExpiresAt: addDays(new Date(), 5) }),
    await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "generating", title: "retention fixture purge generating" }),
    await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture purge locked", withObject: true, retentionExpiresAt: daysAgo(1), deletionLocked: true }),
  ]) {
    assert((await api(baseUrl, "POST", `/api/reports/archive/${blocked.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${blocked.id}`, mode: "retention" })).status === 409, "Ineligible purge succeeded.");
    bump("archivePurgeScenarios");
  }
  await pool.query("UPDATE company_report_retention_settings SET retention_enabled=false WHERE company_id=$1", [users.companyA]);
  const disabled = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture purge retention disabled", withObject: true, retentionExpiresAt: daysAgo(1) });
  assert((await api(baseUrl, "POST", `/api/reports/archive/${disabled.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${disabled.id}`, mode: "retention" })).status === 409, "Retention-disabled purge succeeded.");
  await pool.query("UPDATE company_report_retention_settings SET retention_enabled=true WHERE company_id=$1", [users.companyA]);
  const failedRetention = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "failed", title: "retention fixture purge failed retention", withObject: true, retentionExpiresAt: daysAgo(1) });
  assert((await api(baseUrl, "POST", `/api/reports/archive/${failedRetention.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${failedRetention.id}`, mode: "retention" })).status === 200, "Failed retention purge did not apply.");
  const notFoundStorage = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture purge storage missing", storageKeyOnly: true, purgeEligibleAt: daysAgo(1) });
  assert((await api(baseUrl, "POST", `/api/reports/archive/${notFoundStorage.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${notFoundStorage.id}` })).status === 200, "Storage not-found purge was not idempotent.");
  const superPurge = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyB, generatedBy: users.standardB.id, status: "deleted", title: "retention fixture super purge", withObject: true, purgeEligibleAt: daysAgo(1) });
  assert((await api(baseUrl, "POST", `/api/reports/archive/${superPurge.id}/purge`, tokens.superadmin, { ack: `PURGE_ARCHIVE_${superPurge.id}` })).status === 400, "Superadmin implicit purge accepted.");
  assert((await api(baseUrl, "POST", `/api/reports/archive/${superPurge.id}/purge?companyId=${users.companyB}`, tokens.superadmin, { ack: `PURGE_ARCHIVE_${superPurge.id}` })).status === 200, "Superadmin explicit purge failed.");
  bump("archivePurgeScenarios", 5);

  const originalDelete = storageModule.reportStorage.delete.bind(storageModule.reportStorage);
  for (const category of ["storage_access_denied", "storage_timeout", "storage_network_error", "storage_delete_failed"]) {
    const fail = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: `retention fixture purge failure ${category}`, withObject: true, purgeEligibleAt: daysAgo(1) });
    let calls = 0;
    storageModule.reportStorage.delete = async () => {
      calls += 1;
      throw new storageModule.ReportStorageError(category);
    };
    const response = await api(baseUrl, "POST", `/api/reports/archive/${fail.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${fail.id}` });
    assert(response.status === 200 && (response.json as { status?: string; category?: string }).status === "failed", `${category} purge failure response mismatch.`);
    const row = await archiveRow(fail.id);
    assert(row.status === "purge_failed" && row.purge_failure_category === category && row.purged_at === null, `${category} purge failure fields mismatch.`);
    assert(calls === 1, `${category} delete call count mismatch.`);
    storageModule.reportStorage.delete = originalDelete;
    assert((await api(baseUrl, "POST", `/api/reports/archive/${fail.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${fail.id}` })).status === 200, `${category} retry purge failed.`);
    bump("archivePurgeScenarios", 4);
  }
  await assertNoAuditLeak("report_archive.purge_started");
  await assertNoAuditLeak("report_archive.purged");
  await assertNoAuditLeak("report_archive.purge_failed");
}

async function testConcurrency(baseUrl: string, tokens: TokenSet, storageModule: StorageModule, users: Awaited<ReturnType<typeof setupFixtures>>): Promise<void> {
  const doubleDelete = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture concurrent delete", withObject: true });
  const deleteResults = await Promise.all([
    api(baseUrl, "DELETE", `/api/reports/archive/${doubleDelete.id}`, tokens.adminA, { reason: "race" }),
    api(baseUrl, "DELETE", `/api/reports/archive/${doubleDelete.id}`, tokens.adminA, { reason: "race" }),
  ]);
  assert(deleteResults.filter(r => r.status === 200).length === 1 && deleteResults.filter(r => r.status === 409).length === 1, "Concurrent delete did not single-claim.");
  bump("archiveSecurityScenarios");

  const doubleRestore = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture concurrent restore", withObject: true, previousStatus: "completed" });
  const restoreResults = await Promise.all([
    api(baseUrl, "POST", `/api/reports/archive/${doubleRestore.id}/restore`, tokens.adminA, {}),
    api(baseUrl, "POST", `/api/reports/archive/${doubleRestore.id}/restore`, tokens.adminA, {}),
  ]);
  assert(restoreResults.filter(r => r.status === 200).length === 1 && restoreResults.some(r => r.status === 409), "Concurrent restore did not single-claim.");
  bump("archiveSecurityScenarios");

  const doublePurge = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture concurrent purge", withObject: true, purgeEligibleAt: daysAgo(1) });
  let deleteCalls = 0;
  const originalDelete = storageModule.reportStorage.delete.bind(storageModule.reportStorage);
  storageModule.reportStorage.delete = async (key: string) => {
    deleteCalls += 1;
    await originalDelete(key);
  };
  const purgeResults = await Promise.all([
    api(baseUrl, "POST", `/api/reports/archive/${doublePurge.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${doublePurge.id}` }),
    api(baseUrl, "POST", `/api/reports/archive/${doublePurge.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${doublePurge.id}` }),
  ]);
  storageModule.reportStorage.delete = originalDelete;
  assert(purgeResults.filter(r => r.status === 200 && (r.json as { status?: string }).status === "purged").length === 1, "Concurrent purge did not single-claim.");
  assert(deleteCalls === 1 && await auditCount("report_archive.purged", doublePurge.id) === 1, "Concurrent purge duplicate delete/audit.");
  bump("archiveSecurityScenarios", 2);

  const restorePurge = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture restore purge race", withObject: true, previousStatus: "completed", purgeEligibleAt: daysAgo(1) });
  const raceResults = await Promise.all([
    api(baseUrl, "POST", `/api/reports/archive/${restorePurge.id}/restore`, tokens.adminA, {}),
    api(baseUrl, "POST", `/api/reports/archive/${restorePurge.id}/purge`, tokens.adminA, { ack: `PURGE_ARCHIVE_${restorePurge.id}` }),
  ]);
  const finalStatus = (await archiveRow(restorePurge.id)).status;
  assert(["completed", "purged"].includes(String(finalStatus)) && raceResults.some(r => r.status === 200), "Restore/purge race reached invalid state.");
  bump("archiveSecurityScenarios");
}

async function testDiagnosticsAndDownload(baseUrl: string, tokens: TokenSet, storageModule: StorageModule, users: Awaited<ReturnType<typeof setupFixtures>>): Promise<void> {
  const ok = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture diagnostics ok", withObject: true });
  const missing = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture diagnostics missing", storageKeyOnly: true });
  const deletedMissing = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture diagnostics deleted missing", storageKeyOnly: true });
  await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "purged", title: "retention fixture diagnostics purged" });
  await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyB, generatedBy: users.standardB.id, status: "completed", title: "retention fixture diagnostics tenant b missing", storageKeyOnly: true });
  assert((await api(baseUrl, "GET", "/api/reports/archive/diagnostics/missing", tokens.standardA)).status === 403, "Standard missing diagnostics accepted.");
  assert((await api(baseUrl, "GET", "/api/reports/archive/diagnostics/missing", tokens.kontrolA)).status === 200, "Kontrol missing diagnostics failed.");
  assert((await api(baseUrl, "GET", "/api/reports/archive/diagnostics/missing", tokens.superadmin)).status === 400, "Superadmin implicit missing diagnostics accepted.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/diagnostics/missing?companyId=${users.companyA}&limit=bad`, tokens.superadmin)).status === 400, "Invalid missing diagnostics limit accepted.");
  const missingResponse = await api(baseUrl, "GET", "/api/reports/archive/diagnostics/missing?limit=50", tokens.adminA);
  assert(missingResponse.status === 200, "Missing diagnostics failed.");
  assert(missingResponse.text.includes(`"archiveId":${missing.id}`) && missingResponse.text.includes(`"archiveId":${deletedMissing.id}`), "Missing diagnostics did not flag expected archives.");
  assert(!missingResponse.text.includes("companies/") && !missingResponse.text.includes("tenant b"), "Missing diagnostics leaked storage key or other tenant.");
  bump("archiveDiagnosticsScenarios", 7);
  const originalExists = storageModule.reportStorage.exists.bind(storageModule.reportStorage);
  storageModule.reportStorage.exists = async () => {
    throw new storageModule.ReportStorageError("storage_timeout");
  };
  const providerError = await api(baseUrl, "GET", "/api/reports/archive/diagnostics/missing?limit=1", tokens.adminA);
  storageModule.reportStorage.exists = originalExists;
  assert(providerError.status === 200 && providerError.text.includes("storage_timeout") && !providerError.text.includes("companies/"), "Missing diagnostics provider error leaked unsafe data.");
  bump("archiveDiagnosticsScenarios");

  await storageModule.reportStorage.put({ key: `companies/${users.companyA}/reports/annual_energy_performance/2026/999999/orphan.html`, content: Buffer.from("orphan"), contentType: "text/html; charset=utf-8" });
  await storageModule.reportStorage.put({ key: `companies/${users.companyA}/reports/bad.txt`, content: Buffer.from("bad"), contentType: "text/plain" });
  await storageModule.reportStorage.put({ key: `companies/${users.companyB}/reports/annual_energy_performance/2026/999999/tenant-b-orphan.html`, content: Buffer.from("orphan"), contentType: "text/html; charset=utf-8" });
  assert((await api(baseUrl, "GET", "/api/reports/archive/diagnostics/orphans", tokens.standardA)).status === 403, "Standard orphan diagnostics accepted.");
  assert((await api(baseUrl, "GET", "/api/reports/archive/diagnostics/orphans", tokens.kontrolA)).status === 200, "Kontrol orphan diagnostics failed.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/diagnostics/orphans?companyId=${users.companyA}&limit=2`, tokens.superadmin)).status === 200, "Superadmin explicit orphan diagnostics failed.");
  let deleteCalls = 0;
  const originalDelete = storageModule.reportStorage.delete.bind(storageModule.reportStorage);
  storageModule.reportStorage.delete = async (key: string) => {
    deleteCalls += 1;
    await originalDelete(key);
  };
  const orphanResponse = await api(baseUrl, "GET", "/api/reports/archive/diagnostics/orphans?limit=50", tokens.adminA);
  storageModule.reportStorage.delete = originalDelete;
  assert(orphanResponse.status === 200, "Orphan diagnostics failed.");
  assert(orphanResponse.text.includes("archive_record_missing") && orphanResponse.text.includes("invalid_key_format"), "Orphan diagnostics missed expected reasons.");
  assert(!orphanResponse.text.includes("companies/") && !orphanResponse.text.includes("tenant-b-orphan"), "Orphan diagnostics leaked key or other tenant.");
  assert(deleteCalls === 0, "Orphan diagnostics performed delete.");
  bump("archiveDiagnosticsScenarios", 8);

  assert(storageModule.reportStorage.list, "Local storage list missing.");
  const firstPage = await storageModule.reportStorage.list!({ prefix: `companies/${users.companyA}/reports/`, maxKeys: 1 });
  assert(firstPage.objects.length === 1 && firstPage.truncated === true && firstPage.nextContinuationToken, "Local provider pagination failed.");
  const secondPage = await storageModule.reportStorage.list!({ prefix: `companies/${users.companyA}/reports/`, maxKeys: 1, continuationToken: firstPage.nextContinuationToken });
  assert(secondPage.objects.length === 1 && secondPage.objects[0]!.key > firstPage.objects[0]!.key, "Local provider continuation failed.");
  for (const invalid of [
    { prefix: "", maxKeys: 10 },
    { prefix: "../", maxKeys: 10 },
    { prefix: `companies\\${users.companyA}\\reports\\`, maxKeys: 10 },
    { prefix: `companies/${users.companyA}/reports/`, maxKeys: 1001 },
  ]) {
    await storageModule.reportStorage.list!(invalid).then(() => {
      throw new Error("Invalid local list input accepted.");
    }).catch((error: unknown) => assert((error as { category?: string }).category === "storage_config_invalid", "Invalid local list category mismatch."));
  }
  bump("archiveDiagnosticsScenarios", 6);

  const wrongChecksum = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture wrong checksum", withObject: true, wrongChecksum: true });
  const wrongSize = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "completed", title: "retention fixture wrong size", withObject: true, wrongSize: true });
  const failed = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "failed", title: "retention fixture download failed", withObject: true });
  const deleted = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture download deleted", withObject: true });
  const purging = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "purging", title: "retention fixture download purging", withObject: true });
  const purged = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "purged", title: "retention fixture download purged" });
  const purgeFailed = await seedArchive({ storage: storageModule.reportStorage, companyId: users.companyA, generatedBy: users.adminA.id, status: "purge_failed", title: "retention fixture download purge failed", withObject: true });
  assert((await api(baseUrl, "GET", `/api/reports/archive/${ok.id}/download`, tokens.adminA)).status === 200, "Completed download failed.");
  for (const id of [failed.id, deleted.id, purging.id, purged.id, purgeFailed.id]) {
    assert((await api(baseUrl, "GET", `/api/reports/archive/${id}/download`, tokens.adminA)).status === 409, "Non-completed download was not blocked.");
  }
  assert((await api(baseUrl, "GET", `/api/reports/archive/${wrongChecksum.id}/download`, tokens.adminA)).status === 500, "Wrong checksum did not fail safely.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${wrongSize.id}/download`, tokens.adminA)).status === 500, "Wrong size did not fail safely.");
  assert((await api(baseUrl, "GET", `/api/reports/archive/${ok.id}/download`, tokens.adminB)).status === 404, "Foreign download did not hide archive.");
  bump("archiveSecurityScenarios", 9);
  await assertNoAuditLeak("report_archive.missing_diagnostics_run");
  await assertNoAuditLeak("report_archive.orphan_diagnostics_run");
}

function runCleanup(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["./scripts/node_modules/tsx/dist/cli.mjs", "./scripts/src/report-archive-cleanup.ts", ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function testCleanupCli(storageRoot: string, storageModule: StorageModule, users: Awaited<ReturnType<typeof setupFixtures>>): Promise<void> {
  const baseEnv = { ...process.env, REPORT_STORAGE_PROVIDER: "local", REPORT_STORAGE_LOCAL_ROOT: storageRoot };
  const company = await pool.query<{ id: number }>(
    "INSERT INTO companies(name, subdomain, is_active) VALUES('Retention CLI Fixture', 'retention-cli-fixture', true) RETURNING id",
  );
  const cleanupCompanyId = company.rows[0]!.id;
  const eligible = await seedArchive({ storage: storageModule.reportStorage, companyId: cleanupCompanyId, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture cli eligible", withObject: true, purgeEligibleAt: daysAgo(1) });
  await seedArchive({ storage: storageModule.reportStorage, companyId: cleanupCompanyId, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture cli grace", withObject: true, purgeEligibleAt: addDays(new Date(), 5) });
  await seedArchive({ storage: storageModule.reportStorage, companyId: cleanupCompanyId, generatedBy: users.adminA.id, status: "completed", title: "retention fixture cli disabled", withObject: true, retentionExpiresAt: null });
  await seedArchive({ storage: storageModule.reportStorage, companyId: cleanupCompanyId, generatedBy: users.adminA.id, status: "deleted", title: "retention fixture cli locked", withObject: true, purgeEligibleAt: daysAgo(1), deletionLocked: true });
  const dryRun = runCleanup(["--company-id", String(cleanupCompanyId), "--max-count", "10"], baseEnv);
  assert(dryRun.status === 0, `Cleanup dry-run failed: ${dryRun.stderr}`);
  assert(dryRun.stdout.includes('"mode": "dry-run"') && dryRun.stdout.includes(`"id": ${eligible.id}`), "Cleanup dry-run did not list eligible candidate.");
  assert(!dryRun.stdout.includes("companies/") && !dryRun.stdout.toLowerCase().includes("secret"), "Cleanup dry-run leaked storage key/secret.");
  assert((await archiveRow(eligible.id)).status === "deleted", "Cleanup dry-run mutated DB.");
  bump("archiveCleanupCliScenarios", 4);
  for (const args of [
    [],
    ["--company-id", "bad"],
    ["--company-id", String(cleanupCompanyId), "--max-count", "0"],
    ["--company-id", String(cleanupCompanyId), "--max-bytes", String(2 * 1024 * 1024 * 1024)],
    ["--company-id", String(cleanupCompanyId), "--execute"],
  ]) {
    assert(runCleanup(args, baseEnv).status !== 0, "Cleanup guard accepted invalid args.");
    bump("archiveCleanupCliScenarios");
  }
  const remoteGuard = runCleanup(["--company-id", String(cleanupCompanyId), "--execute", "--ack", `EXECUTE_REPORT_ARCHIVE_CLEANUP_${cleanupCompanyId}`], { ...baseEnv, DATABASE_URL: "postgresql://example.com:5432/prod" });
  assert(remoteGuard.status !== 0 && remoteGuard.stderr.includes("Remote cleanup execution requires"), "Cleanup remote ACK guard failed.");
  const byteGuard = runCleanup(["--company-id", String(cleanupCompanyId), "--execute", "--ack", `EXECUTE_REPORT_ARCHIVE_CLEANUP_${cleanupCompanyId}`, "--max-bytes", "1"], baseEnv);
  assert(byteGuard.status !== 0 && (await archiveRow(eligible.id)).status === "deleted", "Cleanup max-bytes guard failed.");
  const execute = runCleanup(["--company-id", String(cleanupCompanyId), "--execute", "--ack", `EXECUTE_REPORT_ARCHIVE_CLEANUP_${cleanupCompanyId}`, "--max-count", "10"], baseEnv);
  assert(execute.status === 0 && execute.stdout.includes('"purged": 1'), `Cleanup execute failed: status=${execute.status} stdout=${execute.stdout} stderr=${execute.stderr}`);
  assert((await archiveRow(eligible.id)).status === "purged", "Cleanup execute did not purge candidate.");
  const rerun = runCleanup(["--company-id", String(cleanupCompanyId), "--execute", "--ack", `EXECUTE_REPORT_ARCHIVE_CLEANUP_${cleanupCompanyId}`, "--max-count", "10"], baseEnv);
  assert(rerun.status === 0, "Cleanup rerun failed.");
  bump("archiveCleanupCliScenarios", 4);
}

async function main(): Promise<void> {
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Dedicated archive test requires disposable test DB.");
  assert(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).hostname === "127.0.0.1", "Dedicated archive test refused non-local DATABASE_URL.");
  const storageRoot = await mkdtemp(join(tmpdir(), "iso50001-report-archive-retention-"));
  process.env.REPORT_STORAGE_PROVIDER = "local";
  process.env.REPORT_STORAGE_LOCAL_ROOT = storageRoot;
  process.env.REPORT_ARCHIVE_STORAGE_REQUIRED = "false";
  const storageModule = await import(pathToFileURL(resolve(__dirname, "../../artifacts/api-server/src/lib/report-storage.ts")).href) as StorageModule;
  const appModule = await import(pathToFileURL(resolve(__dirname, "../../artifacts/api-server/src/app.ts")).href) as { default: TestApp };
  const fixtures = await setupFixtures(storageModule.reportStorage);
  const server = await listen(appModule.default);
  try {
    const tokens: TokenSet = {
      adminA: await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!),
      kontrolA: await login(server.baseUrl, process.env.E2E_KONTROL_ADMIN_USERNAME!),
      standardA: await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!),
      adminB: await login(server.baseUrl, "e2e_report_admin_b"),
      kontrolB: await login(server.baseUrl, "e2e_report_kontrol_b"),
      standardB: await login(server.baseUrl, process.env.E2E_STANDARD_B_USERNAME!),
      superadmin: await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!),
    };
    assert(tokens.kontrolB && tokens.standardB, "Tenant B readonly/standard tokens missing.");
    await testRetentionSettings(server.baseUrl, tokens, fixtures.companyA, fixtures.companyB);
    await testExpiryMaterialization(storageModule, fixtures.companyA, fixtures.adminA);
    await testArchiveDetail(server.baseUrl, tokens, storageModule, fixtures);
    await testLifecycle(server.baseUrl, tokens, storageModule, fixtures);
    await testPurge(server.baseUrl, tokens, storageModule, fixtures);
    await testConcurrency(server.baseUrl, tokens, storageModule, fixtures);
    await testDiagnosticsAndDownload(server.baseUrl, tokens, storageModule, fixtures);
    await testCleanupCli(storageRoot, storageModule, fixtures);
    console.log(JSON.stringify({ ...counters, storageProvider: storageModule.reportStorage.provider, productionStorage: "not_used" }, null, 2));
  } finally {
    await server.close();
    await rm(storageRoot, { recursive: true, force: true }).catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(`[test-report-archive-retention] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
