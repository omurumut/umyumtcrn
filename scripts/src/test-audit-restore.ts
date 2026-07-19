import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, runMigrations } from "@workspace/db";

type Journal = { entries: Array<{ tag: string }> };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function scalarNumber(sql: string): Promise<number> {
  const result = await pool.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

async function resetDatabase(): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
}

function dockerResult(args: string[], input?: Buffer): Buffer {
  const result = spawnSync("docker", args, {
    input,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  assert(result.status === 0, `Docker backup/restore komutu başarısız: ${args[1] ?? args[0]}`);
  return result.stdout;
}

async function migrationCount(): Promise<number> {
  return scalarNumber("SELECT count(*)::text AS value FROM drizzle.__drizzle_migrations");
}

async function tableCount(): Promise<number> {
  return scalarNumber(
    "SELECT count(*)::text AS value FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
  );
}

async function prepareOldMigrations(sourceFolder: string, targetFolder: string): Promise<void> {
  await cp(sourceFolder, targetFolder, { recursive: true });
  await unlink(join(targetFolder, "0029_report_generation_snapshots.sql"));
  await unlink(join(targetFolder, "0028_company_report_settings.sql"));
  await unlink(join(targetFolder, "0030_report_archives.sql"));
  await unlink(join(targetFolder, "0031_report_archive_retention.sql"));
  await unlink(join(targetFolder, "0027_company_brand_assets.sql"));
  await unlink(join(targetFolder, "0026_company_settings.sql"));
  await unlink(join(targetFolder, "0025_company_profile_fields.sql"));
  await unlink(join(targetFolder, "0024_audit_events.sql"));
  const journalPath = join(targetFolder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  journal.entries = journal.entries.filter((entry) => !["0024_audit_events", "0025_company_profile_fields", "0026_company_settings", "0027_company_brand_assets", "0028_company_report_settings", "0029_report_generation_snapshots", "0030_report_archives", "0031_report_archive_retention"].includes(entry.tag));
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
}

async function insertLegacyData(): Promise<{ companyId: number; userId: number }> {
  await pool.query("SELECT setval(pg_get_serial_sequence('companies', 'id'), (SELECT max(id) FROM companies), true)");
  await pool.query("SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT max(id) FROM users), true)");
  const company = await pool.query<{ id: number }>(
    `INSERT INTO companies (name, subdomain, is_active)
     VALUES ('[AUDIT RESTORE] Tenant', 'audit-restore-tenant', true)
     RETURNING id`,
  );
  const companyId = company.rows[0]!.id;
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (username, password_hash, name, role, company_id, active)
     VALUES ('audit_restore_user', 'scrypt$restore$placeholder', 'Audit Restore User', 'admin', $1, true)
     RETURNING id`,
    [companyId],
  );
  return { companyId, userId: user.rows[0]!.id };
}

async function assertAuditSchema(): Promise<void> {
  assert(await migrationCount() === 33, "Upgrade sonrası migration sayısı 33 değil.");
    assert(await tableCount() === 46, "Upgrade sonrası tablo sayısı 46 değil.");
  const auditTable = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_events'",
  );
  assert(auditTable.rows[0]?.count === "1", "audit_events tablosu oluşmadı.");

  const indexes = await pool.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='audit_events'",
  );
  const indexSet = new Set(indexes.rows.map((row) => row.indexname));
  for (const indexName of [
    "audit_events_company_occurred_idx",
    "audit_events_actor_occurred_idx",
    "audit_events_entity_idx",
    "audit_events_action_occurred_idx",
    "audit_events_request_id_idx",
  ]) {
    assert(indexSet.has(indexName), `${indexName} audit index eksik.`);
  }

  const fks = await pool.query<{ confdeltype: string }>(
    "SELECT confdeltype FROM pg_constraint WHERE conrelid='public.audit_events'::regclass AND contype='f'",
  );
  assert(fks.rows.some((row) => row.confdeltype === "n"), "audit_events SET NULL FK eksik.");
}

async function assertRedaction(): Promise<void> {
  const forbidden = [
    "password",
    "passwordHash",
    "token",
    "tokenHash",
    "authorization",
    "cookie",
    "DATABASE_URL",
    "secret",
    "stack",
    "sql",
    "rawRows",
    "Bearer ",
  ];
  const rows = await pool.query<{ payload: string }>(
    "SELECT coalesce(changes_json::text, '') || coalesce(metadata_json::text, '') AS payload FROM audit_events",
  );
  const payload = rows.rows.map((row) => row.payload).join("\n");
  for (const term of forbidden) {
    assert(!payload.includes(term), `Audit payload yasaklı terim içeriyor: ${term}`);
  }
}

async function main(): Promise<void> {
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Disposable DB zorunlu.");
  const containerId = process.env.TEST_DB_CONTAINER_ID;
  const databaseUser = process.env.PGUSER;
  const databaseName = process.env.PGDATABASE;
  assert(containerId && databaseUser && databaseName, "Disposable container DB bilgisi eksik.");

  const migrationsFolder = fileURLToPath(new URL("../../lib/db/drizzle", import.meta.url));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "iso50001-audit-restore-"));
  const oldMigrationsFolder = join(temporaryRoot, "drizzle-0023");

  try {
    await prepareOldMigrations(migrationsFolder, oldMigrationsFolder);
    await resetDatabase();
    await runMigrations(oldMigrationsFolder);
    assert(await migrationCount() === 23, "Backup öncesi migration sayısı 23 değil.");
    assert(await tableCount() === 34, "0023 şema tablo sayısı 34 değil.");
    const legacy = await insertLegacyData();

    const legacyDump = dockerResult([
      "exec",
      containerId,
      "pg_dump",
      "--no-owner",
      "--no-privileges",
      "-U",
      databaseUser,
      "-d",
      databaseName,
    ]);

    await resetDatabase();
    dockerResult(
      ["exec", "-i", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", databaseUser, "-d", databaseName],
      legacyDump,
    );
    assert(await migrationCount() === 23, "Restore sonrası migration sayısı 23 değil.");
    await runMigrations(resolve(migrationsFolder));
    await assertAuditSchema();
    await runMigrations(resolve(migrationsFolder));
    assert(await migrationCount() === 33, "İkinci migrator no-op değil.");

    const preservedCompany = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM companies WHERE id=$1 AND subdomain='audit-restore-tenant'",
      [legacy.companyId],
    );
    const preservedUser = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users WHERE id=$1 AND company_id=$2 AND username='audit_restore_user'",
      [legacy.userId, legacy.companyId],
    );
    assert(preservedCompany.rows[0]?.count === "1", "Legacy company restore/upgrade sonrası korunmadı.");
    assert(preservedUser.rows[0]?.count === "1", "Legacy user restore/upgrade sonrası korunmadı.");

    await pool.query(
      `INSERT INTO audit_events (request_id, actor_user_id, actor_role, company_id, action, entity_type, entity_id, outcome, changes_json, metadata_json)
       VALUES
       ('audit-restore-1', $1, 'admin', $2, 'user.update', 'user', $3, 'success', '{"after":{"role":"admin"}}'::jsonb, '{"ipHash":"[redacted]"}'::jsonb),
       ('audit-restore-2', $1, 'admin', $2, 'mgm.import', 'weather_degree_days', 'excel', 'partial', '{"summary":{"total":2,"failed":1}}'::jsonb, '{"operation":"degree-days-import"}'::jsonb)`,
      [legacy.userId, legacy.companyId, String(legacy.userId)],
    );
    await assertRedaction();

    const auditDump = dockerResult([
      "exec",
      containerId,
      "pg_dump",
      "--no-owner",
      "--no-privileges",
      "-U",
      databaseUser,
      "-d",
      databaseName,
    ]);
    const auditCountBefore = await scalarNumber("SELECT count(*)::text AS value FROM audit_events");
    await resetDatabase();
    dockerResult(
      ["exec", "-i", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", databaseUser, "-d", databaseName],
      auditDump,
    );
    assert(await migrationCount() === 33, "Audit restore sonrası migration sayısı 33 değil.");
    assert(await scalarNumber("SELECT count(*)::text AS value FROM audit_events") === auditCountBefore, "Audit event sayısı restore sonrası eşleşmedi.");
    await assertRedaction();

    console.log(JSON.stringify({
      backupMigrationCount: 23,
      upgradedMigrationCount: 33,
      auditEventCount: auditCountBefore,
      legacyDataPreserved: true,
      auditBackupRestore: true,
    }));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[test-audit-restore] ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
  process.exitCode = 1;
});
