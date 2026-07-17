import { closeDatabasePool, pool } from "@workspace/db";

function batchSize(): number {
  const raw = process.env.AUTH_CLEANUP_BATCH_SIZE;
  if (raw === undefined) return 500;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error("AUTH_CLEANUP_BATCH_SIZE pozitif tam sayı olmalıdır.");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 5_000) {
    throw new Error("AUTH_CLEANUP_BATCH_SIZE 1-5000 aralığında olmalıdır.");
  }
  return parsed;
}

async function main(): Promise<void> {
  if (process.env.ENABLE_AUTH_MAINTENANCE !== "true") {
    throw new Error("Auth cleanup için ENABLE_AUTH_MAINTENANCE=true zorunludur.");
  }
  const limit = batchSize();
  const sessions = await pool.query(
    `WITH removable AS (
       SELECT id FROM auth_sessions
       WHERE expires_at <= now()
          OR (revoked_at IS NOT NULL AND revoked_at <= now() - interval '24 hours')
       ORDER BY expires_at LIMIT $1
     )
     DELETE FROM auth_sessions s USING removable r WHERE s.id = r.id`,
    [limit],
  );
  const rateLimits = await pool.query(
    `WITH removable AS (
       SELECT id FROM auth_rate_limits
       WHERE updated_at <= now() - interval '24 hours'
         AND (blocked_until IS NULL OR blocked_until <= now())
       ORDER BY updated_at LIMIT $1
     )
     DELETE FROM auth_rate_limits r USING removable x WHERE r.id = x.id`,
    [limit],
  );
  console.log(JSON.stringify({ sessions: sessions.rowCount ?? 0, rateLimits: rateLimits.rowCount ?? 0 }));
}

main()
  .catch((error: unknown) => {
    console.error(`[auth-cleanup] ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabasePool());
