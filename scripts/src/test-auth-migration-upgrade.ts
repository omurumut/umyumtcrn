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
    await unlink(join(oldMigrationsFolder, "0023_shared_auth_state.sql"));
    const journalPath = join(oldMigrationsFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
    journal.entries = journal.entries.filter((entry) => entry.tag !== "0023_shared_auth_state");
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

    await resetDatabase();
    await runMigrations(oldMigrationsFolder);
    assert(await migrationCount() === 22, "Backup öncesi migration sayısı 22 değil.");
    const oldTableCount = await tableCount();
    assert(oldTableCount === 32, `0022 şema tablo sayısı 32 değil: ${oldTableCount}`);

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
    assert(await migrationCount() === 22, "Restore sonrası migration sayısı 22 değil.");

    await runMigrations(resolve(migrationsFolder));
    assert(await migrationCount() === 23, "Restore üzerine 0023 uygulanmadı.");
    const newTableCount = await tableCount();
    assert(newTableCount === 34, `Upgrade şema tablo sayısı 34 değil: ${newTableCount}`);
    const authTables = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('auth_sessions','auth_rate_limits')",
    );
    assert(Number(authTables.rows[0]?.count ?? 0) === 2, "Shared auth tabloları restore upgrade sonrası yok.");

    console.log(JSON.stringify({ backupMigrationCount: 22, restoredMigrationCount: 22, upgradedMigrationCount: 23, oldTableCount, newTableCount }));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[test-auth-migration-upgrade] ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
  process.exitCode = 1;
});
