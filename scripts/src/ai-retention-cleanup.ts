import { pool } from "@workspace/db";

type Args = {
  companyId: number | null;
  execute: boolean;
  ack: string | null;
  batchSize: number;
  maxRows: number;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Args = { companyId: null, execute: false, ack: null, batchSize: 100, maxRows: 500 };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === "--execute") parsed.execute = true;
    else if (arg === "--company-id" && next) { parsed.companyId = Number(next); i += 1; }
    else if (arg === "--ack" && next) { parsed.ack = next; i += 1; }
    else if (arg === "--batch-size" && next) { parsed.batchSize = Number(next); i += 1; }
    else if (arg === "--max-rows" && next) { parsed.maxRows = Number(next); i += 1; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(parsed.companyId) || parsed.companyId === null || parsed.companyId <= 0) throw new Error("--company-id is required.");
  if (!Number.isSafeInteger(parsed.batchSize) || parsed.batchSize < 1 || parsed.batchSize > 500) throw new Error("--batch-size must be 1-500.");
  if (!Number.isSafeInteger(parsed.maxRows) || parsed.maxRows < 1 || parsed.maxRows > 10_000) throw new Error("--max-rows must be 1-10000.");
  return parsed;
}

function assertWriteEnvironment(args: Args): void {
  if (!args.execute) return;
  const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  const local = databaseUrl && ["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname);
  const expectedAck = `EXECUTE_AI_RETENTION_CLEANUP_${args.companyId}`;
  if (args.ack !== expectedAck) throw new Error(`Execute requires --ack ${expectedAck}.`);
  if (!local && process.env.AI_RETENTION_CLEANUP_REMOTE_ACK !== expectedAck) {
    throw new Error("Remote AI retention cleanup execution requires AI_RETENTION_CLEANUP_REMOTE_ACK.");
  }
}

async function selectCandidates(companyId: number, limit: number) {
  return await pool.query<{ id: number; status: string; provider: string; created_at: Date }>(
    `
      SELECT a.id, a.status, a.provider, a.created_at
      FROM ai_analyses a
      JOIN company_ai_settings s ON s.company_id=a.company_id
      WHERE a.company_id=$1
        AND s.retention_days IS NOT NULL
        AND s.retention_days BETWEEN 30 AND 3650
        AND a.status IN ('completed','failed')
        AND a.created_at < now() - (s.retention_days || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM ai_finding_action_links l WHERE l.analysis_id=a.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM ai_analyses child WHERE child.source_analysis_id=a.id
        )
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT $2
    `,
    [companyId, limit],
  );
}

async function recordLastRun(summary: Record<string, unknown>) {
  await pool.query(
    `
      INSERT INTO ai_operational_state (state_key, value_json, updated_at)
      VALUES ('ai_retention_cleanup:last_run', $1::jsonb, now())
      ON CONFLICT (state_key) DO UPDATE
      SET value_json=excluded.value_json, updated_at=now()
    `,
    [JSON.stringify(summary)],
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  assertWriteEnvironment(args);
  let deleted = 0;
  let scanned = 0;
  const preview: Array<{ id: number; status: string; provider: string; createdAt: string }> = [];

  while (scanned < args.maxRows) {
    const batchLimit = Math.min(args.batchSize, args.maxRows - scanned);
    const candidates = await selectCandidates(args.companyId!, batchLimit);
    scanned += candidates.rowCount ?? 0;
    preview.push(...candidates.rows.slice(0, Math.max(0, 25 - preview.length)).map((row) => ({
      id: row.id,
      status: row.status,
      provider: row.provider,
      createdAt: row.created_at.toISOString(),
    })));
    if (!args.execute || candidates.rows.length === 0) break;
    const ids = candidates.rows.map((row) => row.id);
    const removed = await pool.query(
      `
        DELETE FROM ai_analyses a
        WHERE a.company_id=$1
          AND a.id = ANY($2::int[])
          AND NOT EXISTS (SELECT 1 FROM ai_finding_action_links l WHERE l.analysis_id=a.id)
          AND NOT EXISTS (SELECT 1 FROM ai_analyses child WHERE child.source_analysis_id=a.id)
      `,
      [args.companyId, ids],
    );
    deleted += removed.rowCount ?? 0;
    if (candidates.rows.length < batchLimit) break;
  }

  const summary = {
    mode: args.execute ? "execute" : "dry-run",
    companyId: args.companyId,
    candidateCount: scanned,
    deleted,
    batchSize: args.batchSize,
    maxRows: args.maxRows,
    preview,
  };
  if (args.execute) await recordLastRun(summary);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(`[ai-retention-cleanup] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
