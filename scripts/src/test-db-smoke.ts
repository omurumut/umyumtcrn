import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool, runMigrations } from "@workspace/db";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

const migrationsFolder = fileURLToPath(
  new URL("../../lib/db/drizzle", import.meta.url),
);
const REQUIRED_TABLES = [
  "companies",
  "users",
  "units",
  "sub_units",
  "energy_sources",
  "energy_use_groups",
  "meters",
  "consumption",
  "energy_targets",
  "vap_projects",
  "variables",
  "variable_values",
  "weather_degree_days",
  "mgm_station_mappings",
  "energy_baselines",
  "energy_performance_results",
  "energy_review_records",
] as const;
const REQUIRED_INDEXES = [
  "wdd_station_key_year_month_official_idx",
  "wdd_station_key_year_idx",
  "wdd_province_district_year_idx",
  "wdd_station_name_year_month_idx",
  "idx_mgm_station_mappings_province",
  "idx_mgm_station_mappings_province_district",
  "vap_projects_action_plan_id_unique",
  "energy_targets_seu_assessment_item_id_idx",
  "energy_targets_baseline_id_idx",
  "energy_targets_sub_unit_id_idx",
  "energy_targets_energy_source_id_idx",
  "energy_targets_company_unit_item_year_unique",
] as const;

interface JournalEntry {
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface Queryable {
  query<T extends QueryResultRow>(queryText: string): Promise<QueryResult<T>>;
}

interface SchemaSummary {
  tableCount: number;
  companyCount: number;
  defaultCompanyPresent: boolean;
  targetIntegrity: {
    partialUniqueIndexPresent: true;
    subUnitForeignKeyPresent: true;
    energySourceForeignKeyPresent: true;
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function loadJournal(): Promise<Journal> {
  const journal = JSON.parse(
    await readFile(`${migrationsFolder}/meta/_journal.json`, "utf8"),
  ) as Journal;
  assert(
    Array.isArray(journal.entries) && journal.entries.length > 0,
    "Migration journal boş.",
  );
  return journal;
}

function assertDisposableConnection(): void {
  assert(
    process.env.TEST_DB_DISPOSABLE === "true",
    "Disposable DB doğrulama bayrağı yok.",
  );
  assert(
    /^[a-f0-9]{24}$/i.test(process.env.TEST_DB_RUN_ID ?? ""),
    "Disposable run ID geçersiz.",
  );
  assert(
    /^[a-f0-9]{64}$/i.test(process.env.TEST_DB_CONTAINER_ID ?? ""),
    "Disposable container ID geçersiz.",
  );
  const rawUrl = process.env.DATABASE_URL;
  assert(rawUrl, "Disposable DATABASE_URL tanımlı değil.");
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("Disposable DATABASE_URL geçersiz.");
  }
  assert(
    databaseUrl.protocol === "postgresql:" ||
      databaseUrl.protocol === "postgres:",
    "Disposable DB protokolü geçersiz.",
  );
  assert(
    databaseUrl.hostname === "127.0.0.1",
    "Disposable DB hostu localhost değil.",
  );
  assert(
    databaseUrl.port === process.env.PGPORT,
    "Disposable DB port doğrulaması başarısız.",
  );
  assert(process.env.PGHOST === "127.0.0.1", "PGHOST disposable değil.");
  assert(
    process.env.PGUSER === decodeURIComponent(databaseUrl.username),
    "PGUSER uyumsuz.",
  );
  assert(
    process.env.PGDATABASE ===
      decodeURIComponent(databaseUrl.pathname.slice(1)),
    "PGDATABASE uyumsuz.",
  );
  assert(
    process.env.PGPASSWORD === decodeURIComponent(databaseUrl.password),
    "PGPASSWORD uyumsuz.",
  );
  for (const forbiddenName of [
    "TEST_DATABASE_URL",
    "PGHOSTADDR",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSFILE",
    "PGOPTIONS",
    "PGSYSCONFDIR",
    "NODE_OPTIONS",
    "TEST_DB_CHILD_TIMEOUT_MS",
  ]) {
    assert(
      process.env[forbiddenName] === undefined,
      `${forbiddenName} disposable child environment içinde olmamalı.`,
    );
  }
  assert(
    process.env.ENABLE_SUPERADMIN_BOOTSTRAP === "false" &&
      process.env.ENABLE_DEMO_SEED === "false" &&
      process.env.ENABLE_DEMO_SEED_USERS === "false",
    "Seed/bootstrap güvenli kapatma bayrakları eksik.",
  );
}

async function migrationCount(queryable: Queryable): Promise<number> {
  const relation = await queryable.query<{ name: string | null }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name",
  );
  if (relation.rows[0]?.name === null) return 0;
  const result = await queryable.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations",
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function migrationHashes(queryable: Queryable): Promise<Set<string>> {
  const result = await queryable.query<{ hash: string }>(
    "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id",
  );
  return new Set(result.rows.map((row) => row.hash));
}

async function fileHash(tag: string): Promise<string> {
  const content = await readFile(`${migrationsFolder}/${tag}.sql`);
  return createHash("sha256").update(content).digest("hex");
}

async function assertMigrationHistory(
  queryable: Queryable,
  journal: Journal,
): Promise<void> {
  assert(
    !journal.entries.some((entry) => entry.tag.startsWith("0010_")),
    "0010 journal içinde olmamalı.",
  );
  const appliedHashes = await migrationHashes(queryable);
  assert(
    appliedHashes.size === journal.entries.length,
    `DB migration hash sayısı journal ile eşleşmiyor: ${appliedHashes.size}/${journal.entries.length}.`,
  );
  for (const entry of journal.entries) {
    assert(
      appliedHashes.has(await fileHash(entry.tag)),
      `${entry.tag} hash'i DB geçmişinde yok.`,
    );
  }

  const orphan0010Hash = await fileHash("0010_variables_tables");
  assert(
    !appliedHashes.has(orphan0010Hash),
    "0010 migration hash'i uygulanmış.",
  );
  assert(
    appliedHashes.has(await fileHash("0009_energy_performance")),
    "Güncel 0009 hash'i eşleşmiyor.",
  );
  assert(
    appliedHashes.has(await fileHash("0019_energy_review_record_soft_delete")),
    "Güncel 0019 hash'i eşleşmiyor.",
  );
  assert(
    appliedHashes.has(await fileHash("0020_target_parent_links")),
    "Güncel 0020 hash'i eşleşmiyor.",
  );
  assert(
    appliedHashes.has(await fileHash("0021_target_integrity_hardening")),
    "Güncel 0021 hash'i eşleşmiyor.",
  );
  const hardeningSql = await readFile(`${migrationsFolder}/0021_target_integrity_hardening.sql`, "utf8");
  assert(
    !/^\s*(?:UPDATE|DELETE\s+FROM|DROP|TRUNCATE)\b/im.test(hardeningSql),
    "0021 data-loss veya backfill işlemi içermemeli.",
  );
}

async function schemaSummary(queryable: Queryable): Promise<SchemaSummary> {
  const tablesResult = await queryable.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const tables = new Set(tablesResult.rows.map((row) => row.table_name));
  assert(!tables.has("tasks"), "Fresh şemada tasks tablosu bulunmamalı.");
  for (const table of REQUIRED_TABLES) {
    assert(tables.has(table), `${table} tablosu fresh şemada yok.`);
  }

  const recordTypeResult = await queryable.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'meters' AND column_name = 'record_type'
     ) AS exists`,
  );
  assert(
    recordTypeResult.rows[0]?.exists,
    "meters.record_type kolonu fresh şemada yok.",
  );

  const targetParentColumnsResult = await queryable.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'energy_targets'
       AND column_name IN ('seu_assessment_item_id', 'baseline_id')`,
  );
  const targetParentColumns = new Set(targetParentColumnsResult.rows.map((row) => row.column_name));
  assert(targetParentColumns.has("seu_assessment_item_id"), "energy_targets.seu_assessment_item_id fresh şemada yok.");
  assert(targetParentColumns.has("baseline_id"), "energy_targets.baseline_id fresh şemada yok.");

  const companiesResult = await queryable.query<{
    total: string;
    default_count: string;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE id = 1 AND subdomain = 'default' AND is_active = true)::text AS default_count
     FROM companies`,
  );
  const companyCount = Number(companiesResult.rows[0]?.total ?? 0);
  const defaultCompanyPresent =
    Number(companiesResult.rows[0]?.default_count ?? 0) === 1;
  assert(
    companyCount >= 1 && defaultCompanyPresent,
    "Varsayılan company migration sözleşmesi sağlanmadı.",
  );

  const indexesResult = await queryable.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
  );
  const indexes = new Set(indexesResult.rows.map((row) => row.indexname));
  for (const index of REQUIRED_INDEXES) {
    assert(indexes.has(index), `${index} index'i fresh şemada yok.`);
  }

  const targetUniqueIndexResult = await queryable.query<{
    is_unique: boolean;
    definition: string;
    predicate: string | null;
  }>(
    `SELECT i.indisunique AS is_unique,
            pg_get_indexdef(i.indexrelid) AS definition,
            pg_get_expr(i.indpred, i.indrelid) AS predicate
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'energy_targets_company_unit_item_year_unique'`,
  );
  const targetUniqueIndex = targetUniqueIndexResult.rows[0];
  assert(targetUniqueIndex?.is_unique === true, "Target duplicate index'i unique değil.");
  assert(
    /\(company_id, unit_id, seu_assessment_item_id, target_year\)/i.test(targetUniqueIndex.definition),
    "Target duplicate index kolon sırası geçersiz.",
  );
  assert(
    /seu_assessment_item_id IS NOT NULL/i.test(targetUniqueIndex.predicate ?? "") &&
      /unit_id IS NOT NULL/i.test(targetUniqueIndex.predicate ?? ""),
    "Target duplicate partial index predicate'i geçersiz.",
  );

  const foreignKeysResult = await queryable.query<{ name: string; definition: string; delete_action: string }>(
    `SELECT conname AS name, pg_get_constraintdef(oid) AS definition, confdeltype::text AS delete_action
     FROM pg_constraint
     WHERE conrelid = 'public.energy_targets'::regclass AND contype = 'f'`,
  );
  assert(
    foreignKeysResult.rows.some((row) => /FOREIGN KEY \(seu_assessment_item_id\).*seu_assessment_items\(id\)/i.test(row.definition) && row.delete_action === "a"),
    "energy_targets.seu_assessment_item_id NO ACTION foreign key fresh şemada yok.",
  );
  assert(
    foreignKeysResult.rows.some((row) => /FOREIGN KEY \(baseline_id\).*energy_baselines\(id\)/i.test(row.definition) && row.delete_action === "a"),
    "energy_targets.baseline_id NO ACTION foreign key fresh şemada yok.",
  );
  assert(
    foreignKeysResult.rows.some((row) => row.name === "energy_targets_sub_unit_id_sub_units_id_fk" &&
      /FOREIGN KEY \(sub_unit_id\).*sub_units\(id\)/i.test(row.definition) && row.delete_action === "n"),
    "energy_targets.sub_unit_id SET NULL foreign key fresh şemada yok.",
  );
  assert(
    foreignKeysResult.rows.some((row) => row.name === "energy_targets_energy_source_id_energy_sources_id_fk" &&
      /FOREIGN KEY \(energy_source_id\).*energy_sources\(id\)/i.test(row.definition) && row.delete_action === "n"),
    "energy_targets.energy_source_id SET NULL foreign key fresh şemada yok.",
  );

  return {
    tableCount: tables.size,
    companyCount,
    defaultCompanyPresent,
    targetIntegrity: {
      partialUniqueIndexPresent: true,
      subUnitForeignKeyPresent: true,
      energySourceForeignKeyPresent: true,
    },
  };
}

async function runReadOnlyAssertions(
  databasePool: Pool,
  journal: Journal,
): Promise<SchemaSummary> {
  const client: PoolClient = await databasePool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN READ ONLY");
    transactionStarted = true;
    const readOnly = await client.query<{ transaction_read_only: string }>(
      "SHOW transaction_read_only",
    );
    assert(
      readOnly.rows[0]?.transaction_read_only === "on",
      "Read-only transaction etkin değil.",
    );
    assert(
      (await migrationCount(client)) === journal.entries.length,
      "Migration sayısı journal ile eşleşmiyor.",
    );
    await assertMigrationHistory(client, journal);
    return await schemaSummary(client);
  } finally {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        console.warn(
          "[test-db] WARNING read-only transaction rollback başarısız oldu.",
        );
      }
    }
    client.release();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  assert(
    mode === "--migrate" || mode === "--assert",
    "Smoke modu --migrate veya --assert olmalı.",
  );
  assertDisposableConnection();
  const journal = await loadJournal();

  let firstDurationMs: number | null = null;
  let secondDurationMs: number | null = null;
  if (mode === "--migrate") {
    assert(
      (await migrationCount(pool)) === 0,
      "Disposable DB migration öncesinde boş değil.",
    );
    const firstStarted = performance.now();
    await runMigrations(migrationsFolder);
    firstDurationMs = Math.round(performance.now() - firstStarted);
    assert(
      (await migrationCount(pool)) === journal.entries.length,
      "İlk migrator çalışması journal sayısıyla eşleşmedi.",
    );

    const secondStarted = performance.now();
    await runMigrations(migrationsFolder);
    secondDurationMs = Math.round(performance.now() - secondStarted);
    assert(
      (await migrationCount(pool)) === journal.entries.length,
      "İkinci migrator çalışması no-op olmadı.",
    );
  }

  const summary = await runReadOnlyAssertions(pool, journal);
  console.log(
    JSON.stringify({
      mode: mode.slice(2),
      migrations: journal.entries.length,
      firstDurationMs,
      secondDurationMs,
      orphan0010Applied: false,
      ...summary,
    }),
  );
}

try {
  await main();
} finally {
  await pool.end();
}
