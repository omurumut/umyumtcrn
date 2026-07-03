---
name: EMS schema drift and drizzle-kit generate danger
description: How to safely add a migration when Drizzle schema.ts has columns/tables with no matching migration file (schema drift), without using push/push-force.
---

## Problem pattern
`lib/db/src/schema/energy.ts` can drift ahead of `lib/db/drizzle/*.sql`: a field gets added to the Drizzle schema object but the corresponding migration file is never generated/committed. New/fresh databases that only run the repo's migrations then fail at runtime with `column "..." does not exist`, even though `__drizzle_migrations` shows every repo migration as applied.

**Why:** at least one past migration (`0010_variables_tables.sql`) was added to `lib/db/drizzle/` without a matching `meta/_journal.json` entry and without regenerating `meta/*_snapshot.json`. This desyncs drizzle-kit's internal snapshot chain from the real DB state.

## Consequence — do NOT trust `drizzle-kit generate` blindly here
Because the snapshot chain is desynced, running `drizzle-kit generate` in `lib/db` produces a migration that re-`CREATE TABLE`s many tables that already exist in the real database (e.g. `energy_action_plans`, `seu_assessments`, `variables`, `vap_projects`, `weather_degree_days`) alongside the actually-needed `ALTER TABLE ... ADD COLUMN` lines. Applying it as-is would break the database.

**How to apply:** after `drizzle-kit generate`, diff the output against `information_schema.columns`/`information_schema.tables` for the real DB before accepting it. Keep only the `ALTER TABLE ADD COLUMN` (or other) statements for objects confirmed missing; discard `CREATE TABLE` statements for tables that already exist. Hand-write a minimal replacement migration file instead of committing the raw generate output. Never use `drizzle-kit push`/`push-force` to "fix" this — always go through a reviewed migration file plus the repo's own migrator (`runMigrations` from `@workspace/db`, wraps `drizzle-orm/node-postgres/migrator`'s `migrate()`).

## Journal `when` ordering still applies
New migration's journal entry `when` must be greater than the max `when` of all already-applied entries, or `migrate()` silently skips it (see ems-drizzle-when-ordering.md).
