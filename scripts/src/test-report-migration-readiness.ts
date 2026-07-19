import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, runMigrations } from "@workspace/db";

type Journal = { entries: Array<{ tag: string }> };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function scalarNumber(query: string): Promise<number> {
  const result = await pool.query<{ value: string }>(query);
  return Number(result.rows[0]?.value ?? 0);
}

async function resetDatabase(): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
}

async function prepareMigrationsThrough0027(sourceFolder: string, targetFolder: string): Promise<void> {
  await cp(sourceFolder, targetFolder, { recursive: true });
  await unlink(join(targetFolder, "0029_report_generation_snapshots.sql"));
  await unlink(join(targetFolder, "0028_company_report_settings.sql"));
  await unlink(join(targetFolder, "0030_report_archives.sql"));
  await unlink(join(targetFolder, "0031_report_archive_retention.sql"));
  const journalPath = join(targetFolder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  journal.entries = journal.entries.filter((entry) => !["0028_company_report_settings", "0029_report_generation_snapshots", "0030_report_archives", "0031_report_archive_retention"].includes(entry.tag));
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
}

async function expectRejected(name: string, query: string, params: unknown[] = []): Promise<void> {
  try {
    await pool.query(query, params);
  } catch {
    return;
  }
  throw new Error(`${name} kabul edildi; reddedilmeliydi.`);
}

async function migrationCount(): Promise<number> {
  return scalarNumber("SELECT count(*)::text AS value FROM drizzle.__drizzle_migrations");
}

async function tableCount(): Promise<number> {
  return scalarNumber("SELECT count(*)::text AS value FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
}

async function syncSerial(table: string, column = "id"): Promise<void> {
  await pool.query(`SELECT setval(pg_get_serial_sequence('${table}', '${column}'), COALESCE((SELECT max(${column}) FROM ${table}), 1), true)`);
}

async function assertCurrentConstraints(): Promise<void> {
  assert(await migrationCount() === 31, "Migration sayısı 31 değil.");
  assert(await tableCount() === 44, "Tablo sayısı 44 değil.");
  await syncSerial("companies");
  const company = await pool.query<{ id: number }>("INSERT INTO companies(name, subdomain) VALUES('[F3B4] Constraint A', 'f3b4-constraint-a') RETURNING id");
  const companyId = company.rows[0]!.id;
  await syncSerial("users");
  const user = await pool.query<{ id: number }>(
    "INSERT INTO users(username, password_hash, name, role, company_id) VALUES('f3b4_constraint_admin', 'x', 'F3B4 Constraint Admin', 'admin', $1) RETURNING id",
    [companyId],
  );
  const userId = user.rows[0]!.id;
  const unit = await pool.query<{ id: number }>(
    "INSERT INTO units(company_id, name, location, type, city) VALUES($1, '[F3B4] Unit', 'Test', 'fabrika', 'Istanbul') RETURNING id",
    [companyId],
  );
  const unitId = unit.rows[0]!.id;

  await pool.query(
    `INSERT INTO company_report_profiles(company_id, default_locale, confidentiality_level, cover_style, file_name_pattern, profile_version, updated_by)
     VALUES($1, 'tr-TR', 'internal', 'standard', '{company}_{reportType}_{year}', 1, $2)`,
    [companyId, userId],
  );
  await expectRejected("duplicate profile", "INSERT INTO company_report_profiles(company_id) VALUES($1)", [companyId]);
  await expectRejected("invalid locale", "INSERT INTO company_report_profiles(company_id, default_locale) VALUES($1, 'en-US')", [companyId]);
  await expectRejected("invalid confidentiality", "INSERT INTO company_report_profiles(company_id, confidentiality_level) VALUES($1, 'secret')", [companyId]);
  await expectRejected("invalid cover style", "INSERT INTO company_report_profiles(company_id, cover_style) VALUES($1, 'wide')", [companyId]);
  await expectRejected("zero profile version", "INSERT INTO company_report_profiles(company_id, profile_version) VALUES($1, 0)", [companyId]);

  await pool.query(
    "INSERT INTO company_report_type_settings(company_id, report_type, type_settings_version, updated_by) VALUES($1, 'energy_targets_management', 1, $2)",
    [companyId, userId],
  );
  await expectRejected("duplicate type settings", "INSERT INTO company_report_type_settings(company_id, report_type) VALUES($1, 'energy_targets_management')", [companyId]);
  await expectRejected("invalid type report type", "INSERT INTO company_report_type_settings(company_id, report_type) VALUES($1, 'bad_report')", [companyId]);
  await expectRejected("zero type version", "INSERT INTO company_report_type_settings(company_id, report_type, type_settings_version) VALUES($1, 'annual_energy_performance', 0)", [companyId]);

  await pool.query(
    `INSERT INTO company_report_section_settings(company_id, report_type, section_code, is_visible, display_order, label_override, updated_by)
     VALUES($1, 'energy_targets_management', 'vap_portfolio', true, 50, 'VAP', $2)`,
    [companyId, userId],
  );
  await expectRejected("duplicate section", "INSERT INTO company_report_section_settings(company_id, report_type, section_code, is_visible, display_order) VALUES($1, 'energy_targets_management', 'vap_portfolio', true, 50)", [companyId]);
  await expectRejected("invalid section code", "INSERT INTO company_report_section_settings(company_id, report_type, section_code, is_visible, display_order) VALUES($1, 'energy_targets_management', 'Bad-Section', true, 50)", [companyId]);
  await expectRejected("invalid display order", "INSERT INTO company_report_section_settings(company_id, report_type, section_code, is_visible, display_order) VALUES($1, 'energy_targets_management', 'progress_chronology', true, 0)", [companyId]);

  await pool.query(
    "INSERT INTO company_report_retention_settings(company_id, retention_enabled, completed_retention_days, failed_retention_days, deleted_grace_days, settings_version, updated_by) VALUES($1, false, 3650, 90, 30, 1, $2)",
    [companyId, userId],
  );
  await expectRejected("duplicate retention settings", "INSERT INTO company_report_retention_settings(company_id) VALUES($1)", [companyId]);
  await expectRejected("too short completed retention", "INSERT INTO company_report_retention_settings(company_id, completed_retention_days) VALUES($1, 30)", [companyId]);
  await expectRejected("too short failed retention", "INSERT INTO company_report_retention_settings(company_id, failed_retention_days) VALUES($1, 1)", [companyId]);
  await expectRejected("too short deleted grace", "INSERT INTO company_report_retention_settings(company_id, deleted_grace_days) VALUES($1, 1)", [companyId]);
  await expectRejected("zero retention version", "INSERT INTO company_report_retention_settings(company_id, settings_version) VALUES($1, 0)", [companyId]);

  await expectRejected("invalid snapshot status", "INSERT INTO report_generation_snapshots(company_id, unit_id, report_type, status, storage_status, filename, settings_snapshot_json, generated_by) VALUES($1, $2, 'energy_targets_management', 'done', 'not_stored', 'x.pdf', '{}', $3)", [companyId, unitId, userId]);
  await expectRejected("invalid snapshot report type", "INSERT INTO report_generation_snapshots(company_id, unit_id, report_type, status, storage_status, filename, settings_snapshot_json, generated_by) VALUES($1, $2, 'bad', 'generating', 'not_stored', 'x.pdf', '{}', $3)", [companyId, unitId, userId]);
  await pool.query(
    "INSERT INTO report_generation_snapshots(company_id, unit_id, report_type, status, storage_status, filename, settings_snapshot_json, generated_by) VALUES($1, $2, 'energy_targets_management', 'generating', 'not_stored', 'x.pdf', $3, $4)",
    [companyId, unitId, JSON.stringify({ schemaVersion: "f3b4", sections: [] }), userId],
  );
  await pool.query(
    "INSERT INTO report_archives(company_id, unit_id, report_type, report_year, title, output_name, content_type, size_bytes, checksum_sha256, storage_provider, storage_key, status, generated_by) VALUES($1, $2, 'energy_targets_management', 2026, 'Archive', 'archive.pdf', 'application/pdf', 1200, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'local', 'companies/1/reports/energy_targets_management/2026/1/archive.pdf', 'completed', $3)",
    [companyId, unitId, userId],
  );
  await expectRejected("invalid archive status", "INSERT INTO report_archives(company_id, report_type, title, output_name, content_type, status) VALUES($1, 'energy_targets_management', 'Bad', 'bad.pdf', 'application/pdf', 'done')", [companyId]);
  await expectRejected("invalid archive content type", "INSERT INTO report_archives(company_id, report_type, title, output_name, content_type, status) VALUES($1, 'energy_targets_management', 'Bad', 'bad.pdf', 'text/plain', 'completed')", [companyId]);
  await expectRejected("invalid archive checksum", "INSERT INTO report_archives(company_id, report_type, title, output_name, content_type, size_bytes, checksum_sha256, status) VALUES($1, 'energy_targets_management', 'Bad', 'bad.pdf', 'application/pdf', 10, 'not-a-checksum', 'completed')", [companyId]);
  await expectRejected("invalid snapshot tenant fk", "INSERT INTO report_generation_snapshots(company_id, unit_id, report_type, status, storage_status, filename, settings_snapshot_json) VALUES(999999, null, 'energy_targets_management', 'generating', 'not_stored', 'x.pdf', '{}')");
}

async function assertPopulatedUpgrade(migrationsFolder: string): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "iso50001-report-readiness-"));
  const oldMigrationsFolder = join(temporaryRoot, "drizzle-0027");
  try {
    await prepareMigrationsThrough0027(migrationsFolder, oldMigrationsFolder);
    await resetDatabase();
    await runMigrations(oldMigrationsFolder);
    assert(await migrationCount() === 27, "0027 simülasyon migration sayısı 27 değil.");

    await syncSerial("companies");
    const companyA = await pool.query<{ id: number }>("INSERT INTO companies(name, subdomain) VALUES('[F3B4] Tenant A', 'f3b4-tenant-a') RETURNING id");
    const companyB = await pool.query<{ id: number }>("INSERT INTO companies(name, subdomain) VALUES('[F3B4] Tenant B', 'f3b4-tenant-b') RETURNING id");
    const companyAId = companyA.rows[0]!.id;
    const companyBId = companyB.rows[0]!.id;
    await syncSerial("units");
    const unitA = await pool.query<{ id: number }>("INSERT INTO units(company_id, name, location, type, city) VALUES($1, '[F3B4] Unit A', 'Test', 'fabrika', 'Istanbul') RETURNING id", [companyAId]);
    const unitB = await pool.query<{ id: number }>("INSERT INTO units(company_id, name, location, type, city) VALUES($1, '[F3B4] Unit B', 'Test', 'fabrika', 'Ankara') RETURNING id", [companyBId]);
    await syncSerial("users");
    const userA = await pool.query<{ id: number }>("INSERT INTO users(username, password_hash, name, role, company_id, unit_id) VALUES('f3b4_admin_a', 'x', 'F3B4 Admin A', 'admin', $1, $2) RETURNING id", [companyAId, unitA.rows[0]!.id]);
    await pool.query("INSERT INTO users(username, password_hash, name, role, company_id, unit_id) VALUES('f3b4_user_b', 'x', 'F3B4 User B', 'user', $1, $2)", [companyBId, unitB.rows[0]!.id]);
    await syncSerial("energy_sources");
    const sourceA = await pool.query<{ id: number }>("INSERT INTO energy_sources(company_id, unit_id, type, name, unit) VALUES($1, $2, 'elektrik', '[F3B4] Electricity A', 'kWh') RETURNING id", [companyAId, unitA.rows[0]!.id]);
    await syncSerial("meters");
    const meterA = await pool.query<{ id: number }>("INSERT INTO meters(company_id, unit_id, energy_source_id, name, type, location, city, unit) VALUES($1, $2, $3, '[F3B4] Meter A', 'elektrik', 'Test', 'Istanbul', 'kWh') RETURNING id", [companyAId, unitA.rows[0]!.id, sourceA.rows[0]!.id]);
    await pool.query("INSERT INTO consumption(company_id, meter_id, year, month, kwh, tep, co2) VALUES($1, $2, 2026, 1, 1000, 0.086, 0.42)", [companyAId, meterA.rows[0]!.id]);
    const legacyReport = await pool.query<{ id: number }>("INSERT INTO reports(company_id, unit_id, year, status, download_url) VALUES($1, $2, 2026, 'complete', 'data:text/html;base64,PGgxPk9sZDwvaDE=') RETURNING id", [companyAId, unitA.rows[0]!.id]);
    await pool.query("INSERT INTO audit_events(request_id, actor_user_id, actor_role, company_id, unit_id, action, entity_type, entity_id, outcome, metadata_json) VALUES('f3b4-before', $1, 'admin', $2, $3, 'user.update', 'report', $4, 'success', '{\"phase\":\"before-0028\"}')", [userA.rows[0]!.id, companyAId, unitA.rows[0]!.id, String(legacyReport.rows[0]!.id)]);

    await runMigrations(resolve(migrationsFolder));
    assert(await migrationCount() === 31, "Upgrade sonrası migration sayısı 31 değil.");
    assert(await tableCount() === 44, "Upgrade sonrası tablo sayısı 44 değil.");
    const preserved = await pool.query<{ reports: string; audit: string; consumption: string }>(
      "SELECT (SELECT count(*)::text FROM reports WHERE id=$1) reports, (SELECT count(*)::text FROM audit_events WHERE request_id='f3b4-before') audit, (SELECT count(*)::text FROM consumption WHERE company_id=$2) consumption",
      [legacyReport.rows[0]!.id, companyAId],
    );
    assert(preserved.rows[0]?.reports === "1", "Legacy report korunmadı.");
    assert(preserved.rows[0]?.audit === "1", "Legacy audit korunmadı.");
    assert(preserved.rows[0]?.consumption === "1", "Consumption korunmadı.");
    await pool.query("INSERT INTO company_report_type_settings(company_id, report_type, title_override) VALUES($1, 'annual_energy_performance', 'Tenant A Annual')", [companyAId]);
    const snapshot = await pool.query<{ id: number }>("INSERT INTO report_generation_snapshots(company_id, unit_id, report_type, year, status, storage_status, filename, settings_snapshot_json, generated_by) VALUES($1, $2, 'annual_energy_performance', 2026, 'completed', 'stored', 'tenant-a.html', $3, $4) RETURNING id", [companyAId, unitA.rows[0]!.id, JSON.stringify({ companyId: companyAId, reportType: "annual_energy_performance", sections: [] }), userA.rows[0]!.id]);
    await pool.query("INSERT INTO report_archives(company_id, unit_id, report_type, report_year, title, output_name, content_type, size_bytes, checksum_sha256, storage_provider, storage_key, status, generated_by, snapshot_id, legacy_report_id) VALUES($1, $2, 'annual_energy_performance', 2026, 'Tenant A Annual', 'tenant-a.html', 'text/html; charset=utf-8', 64, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'local', 'companies/1/reports/annual_energy_performance/2026/1/tenant-a.html', 'completed', $3, $4, $5)", [companyAId, unitA.rows[0]!.id, userA.rows[0]!.id, snapshot.rows[0]!.id, legacyReport.rows[0]!.id]);
    const tenantMix = await pool.query<{ count: string }>("SELECT count(*)::text FROM report_generation_snapshots WHERE company_id=$1", [companyBId]);
    assert(tenantMix.rows[0]?.count === "0", "Tenant B üzerinde beklenmeyen snapshot oluştu.");
    const retentionBackfill = await pool.query<{ count: string }>("SELECT count(*)::text FROM company_report_retention_settings WHERE company_id IN ($1, $2)", [companyAId, companyBId]);
    assert(retentionBackfill.rows[0]?.count === "0", "Retention settings destructive backfill yapmamalı.");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Bu test yalnız disposable DB üzerinde çalışır.");
  const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  assert(databaseUrl?.hostname === "127.0.0.1" && databaseUrl.pathname === "/iso50001_test", "Disposable localhost DB doğrulanamadı.");
  const migrationsFolder = fileURLToPath(new URL("../../lib/db/drizzle", import.meta.url));

  await assertCurrentConstraints();
  await assertPopulatedUpgrade(migrationsFolder);
  console.log(JSON.stringify({
    mode: "report-migration-readiness",
    migrations: await migrationCount(),
    tableCount: await tableCount(),
    currentConstraintChecks: "passed",
    populatedUpgrade0027To0031: "passed",
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
