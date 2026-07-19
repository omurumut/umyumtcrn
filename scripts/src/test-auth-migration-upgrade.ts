import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, runMigrations } from "@workspace/db";

type Journal = { entries: Array<{ tag: string }> };

const BACKUP_BASELINE_MIGRATION = 22;
const BACKUP_BASELINE_TABLE_COUNT = 32;
const CURRENT_MIGRATION_COUNT = 31;
const CURRENT_TABLE_COUNT = 44;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function migrationCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations",
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function tableCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
  );
  return Number(result.rows[0]?.count ?? 0);
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
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  assert(result.status === 0, `Docker backup/restore komutu başarısız: ${args[1] ?? args[0]}`);
  return result.stdout;
}

function migrationNumber(tagOrFileName: string): number | null {
  const match = /^(\d{4})/.exec(tagOrFileName);
  return match ? Number(match[1]) : null;
}

async function main(): Promise<void> {
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Disposable DB zorunlu.");
  const containerId = process.env.TEST_DB_CONTAINER_ID;
  const databaseUser = process.env.PGUSER;
  const databaseName = process.env.PGDATABASE;
  assert(containerId && databaseUser && databaseName, "Disposable container DB bilgisi eksik.");

  const migrationsFolder = fileURLToPath(new URL("../../lib/db/drizzle", import.meta.url));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "iso50001-auth-upgrade-"));
  const oldMigrationsFolder = join(temporaryRoot, "drizzle-0022");
  const dumpPath = join(temporaryRoot, "schema-0022.dump.sql");
  try {
    await cp(migrationsFolder, oldMigrationsFolder, { recursive: true });
    for (const migrationFile of await readdir(oldMigrationsFolder)) {
      const number = migrationNumber(migrationFile);
      if (number !== null && number > BACKUP_BASELINE_MIGRATION && migrationFile.endsWith(".sql")) {
        await unlink(join(oldMigrationsFolder, migrationFile));
      }
    }
    const journalPath = join(oldMigrationsFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
    journal.entries = journal.entries.filter((entry) => {
      const number = migrationNumber(entry.tag);
      return number !== null && number <= BACKUP_BASELINE_MIGRATION;
    });
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

    await resetDatabase();
    await runMigrations(oldMigrationsFolder);
    assert(await migrationCount() === BACKUP_BASELINE_MIGRATION, "Backup öncesi migration sayısı 22 değil.");
    const oldTableCount = await tableCount();
    assert(oldTableCount === BACKUP_BASELINE_TABLE_COUNT, `0022 şema tablo sayısı 32 değil: ${oldTableCount}`);

    const dump = dockerResult([
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
    await writeFile(dumpPath, dump);

    await resetDatabase();
    dockerResult(
      ["exec", "-i", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", databaseUser, "-d", databaseName],
      await readFile(dumpPath),
    );
    assert(await migrationCount() === BACKUP_BASELINE_MIGRATION, "Restore sonrası migration sayısı 22 değil.");

    await runMigrations(resolve(migrationsFolder));
    assert(await migrationCount() === CURRENT_MIGRATION_COUNT, "Restore üzerine güncel migration seti uygulanmadı.");
    const newTableCount = await tableCount();
    assert(newTableCount === CURRENT_TABLE_COUNT, `Upgrade şema tablo sayısı 44 değil: ${newTableCount}`);
    const authTables = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('auth_sessions','auth_rate_limits')",
    );
    assert(Number(authTables.rows[0]?.count ?? 0) === 2, "Shared auth tabloları restore upgrade sonrası yok.");

    console.log(JSON.stringify({
      backupMigrationCount: BACKUP_BASELINE_MIGRATION,
      restoredMigrationCount: BACKUP_BASELINE_MIGRATION,
      upgradedMigrationCount: CURRENT_MIGRATION_COUNT,
      oldTableCount,
      newTableCount,
    }));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[test-auth-migration-upgrade] ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
  process.exitCode = 1;
});
