import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

type RateLimitClient = {
  query(queryText: string, values?: unknown[]): Promise<{ rows: Array<{ attempt_count: number; retry_after: number }> }>;
};

export type RateLimitScope = "ip" | "username";

export type RateLimitKey = {
  scope: RateLimitScope;
  keyHash: string;
  maxAttempts: number;
};

export type FailedLoginResult = {
  blocked: boolean;
  retryAfterSeconds: number;
};

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createIpRateLimitKey(ip: string, maxAttempts: number): RateLimitKey {
  return { scope: "ip", keyHash: hashKey(ip), maxAttempts };
}

export function createUsernameRateLimitKey(value: unknown, maxAttempts: number): RateLimitKey | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return { scope: "username", keyHash: hashKey(normalized), maxAttempts };
}

export async function checkLoginRateLimits(keys: RateLimitKey[]): Promise<number | null> {
  if (keys.length === 0) return null;
  const clauses = keys.map((_, index) => `(scope = $${index * 2 + 1} AND key_hash = $${index * 2 + 2})`);
  const values = keys.flatMap((key) => [key.scope, key.keyHash]);
  const result = await pool.query<{ retry_after: number }>(
    `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (blocked_until - now()))))::int AS retry_after
     FROM auth_rate_limits
     WHERE blocked_until > now() AND (${clauses.join(" OR ")})
     ORDER BY blocked_until DESC
     LIMIT 1`,
    values,
  );
  return result.rows[0]?.retry_after ?? null;
}

async function registerOneFailedLogin(
  client: RateLimitClient,
  key: RateLimitKey,
  windowMs: number,
): Promise<{ attemptCount: number; retryAfterSeconds: number }> {
  const result = await client.query(
    `INSERT INTO auth_rate_limits
       (scope, key_hash, window_started_at, attempt_count, blocked_until, updated_at)
     VALUES (
       $1,
       $2,
       now(),
       1,
       CASE WHEN 1 >= $4 THEN now() + ($3::double precision * interval '1 millisecond') ELSE NULL END,
       now()
     )
     ON CONFLICT (scope, key_hash) DO UPDATE SET
       window_started_at = CASE
         WHEN auth_rate_limits.window_started_at + ($3::double precision * interval '1 millisecond') <= now()
           THEN now()
         ELSE auth_rate_limits.window_started_at
       END,
       attempt_count = CASE
         WHEN auth_rate_limits.window_started_at + ($3::double precision * interval '1 millisecond') <= now()
           THEN 1
         ELSE auth_rate_limits.attempt_count + 1
       END,
       blocked_until = CASE
         WHEN auth_rate_limits.window_started_at + ($3::double precision * interval '1 millisecond') <= now()
           THEN NULL
         WHEN auth_rate_limits.attempt_count + 1 >= $4
           THEN auth_rate_limits.window_started_at + ($3::double precision * interval '1 millisecond')
         ELSE NULL
       END,
       updated_at = now()
     RETURNING attempt_count,
       CASE WHEN blocked_until > now()
         THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (blocked_until - now()))))::int
         ELSE 0
       END AS retry_after`,
    [key.scope, key.keyHash, windowMs, key.maxAttempts],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Login rate-limit sayacı güncellenemedi.");
  return { attemptCount: row.attempt_count, retryAfterSeconds: row.retry_after };
}

export async function registerFailedLogin(
  keys: RateLimitKey[],
  windowMs: number,
): Promise<FailedLoginResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let blocked = false;
    let retryAfterSeconds = 0;
    for (const key of keys) {
      const result = await registerOneFailedLogin(client as unknown as RateLimitClient, key, windowMs);
      if (result.attemptCount > key.maxAttempts) blocked = true;
      retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds);
    }
    await client.query("COMMIT");
    return { blocked, retryAfterSeconds };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function resetUsernameRateLimit(key: RateLimitKey | null): Promise<void> {
  if (!key) return;
  await pool.query("DELETE FROM auth_rate_limits WHERE scope = $1 AND key_hash = $2", [key.scope, key.keyHash]);
}

export async function cleanupLoginRateLimits(batchSize = 500): Promise<number> {
  const safeBatchSize = Number.isSafeInteger(batchSize) && batchSize > 0 && batchSize <= 5_000
    ? batchSize
    : 500;
  const result = await pool.query(
    `WITH removable AS (
       SELECT id FROM auth_rate_limits
       WHERE updated_at <= now() - interval '24 hours'
         AND (blocked_until IS NULL OR blocked_until <= now())
       ORDER BY updated_at
       LIMIT $1
     )
     DELETE FROM auth_rate_limits r USING removable x WHERE r.id = x.id`,
    [safeBatchSize],
  );
  return result.rowCount ?? 0;
}
