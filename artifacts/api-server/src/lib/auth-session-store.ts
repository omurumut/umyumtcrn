import { createHash, randomUUID } from "node:crypto";
import {
  authSessionsTable,
  companiesTable,
  db,
  pool,
  usersTable,
} from "@workspace/db";
import { and, eq, gt, isNull, lt } from "drizzle-orm";

const DEFAULT_SESSION_TTL_HOURS = 24;
const MAX_SESSION_TTL_HOURS = 24 * 30;
const LAST_USED_UPDATE_INTERVAL_MS = 10 * 60 * 1000;
const AUTH_STORE_TIMEOUT_MS = 5_000;
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthenticatedSessionUser = {
  userId: number;
  username: string;
  name: string;
  role: string;
  unitId: number | null;
  companyId: number;
};

function readSessionTtlHours(): number {
  const value = process.env.AUTH_SESSION_TTL_HOURS;
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return DEFAULT_SESSION_TTL_HOURS;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_SESSION_TTL_HOURS
    ? parsed
    : DEFAULT_SESSION_TTL_HOURS;
}

export function isValidAuthToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function runAuthStoreOperation<T>(operation: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Authentication store operation timed out.")),
          AUTH_STORE_TIMEOUT_MS,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function createAuthSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + readSessionTtlHours() * 60 * 60 * 1000);
  await db.insert(authSessionsTable).values({
    tokenHash: hashAuthToken(token),
    userId,
    createdAt: now,
    expiresAt,
    lastUsedAt: now,
  });
  return { token, expiresAt };
}

export async function authenticateSessionToken(token: string): Promise<AuthenticatedSessionUser | null> {
  if (!isValidAuthToken(token)) return null;

  const now = new Date();
  const [session] = await db.select({
    sessionId: authSessionsTable.id,
    lastUsedAt: authSessionsTable.lastUsedAt,
    userId: usersTable.id,
    username: usersTable.username,
    name: usersTable.name,
    role: usersTable.role,
    unitId: usersTable.unitId,
    companyId: usersTable.companyId,
  }).from(authSessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, authSessionsTable.userId))
    .innerJoin(companiesTable, eq(companiesTable.id, usersTable.companyId))
    .where(and(
      eq(authSessionsTable.tokenHash, hashAuthToken(token)),
      isNull(authSessionsTable.revokedAt),
      gt(authSessionsTable.expiresAt, now),
      eq(usersTable.active, true),
      eq(companiesTable.isActive, true),
    ))
    .limit(1);

  if (!session) return null;

  if (session.lastUsedAt.getTime() <= now.getTime() - LAST_USED_UPDATE_INTERVAL_MS) {
    await db.update(authSessionsTable)
      .set({ lastUsedAt: now })
      .where(and(
        eq(authSessionsTable.id, session.sessionId),
        lt(authSessionsTable.lastUsedAt, new Date(now.getTime() - LAST_USED_UPDATE_INTERVAL_MS)),
      ));
  }

  return {
    userId: session.userId,
    username: session.username,
    name: session.name,
    role: session.role,
    unitId: session.unitId,
    companyId: session.companyId,
  };
}

export async function revokeAuthSession(token: string): Promise<void> {
  if (!isValidAuthToken(token)) return;
  await db.update(authSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(authSessionsTable.tokenHash, hashAuthToken(token)),
      isNull(authSessionsTable.revokedAt),
    ));
}

export async function cleanupAuthSessions(batchSize = 500): Promise<number> {
  const safeBatchSize = Number.isSafeInteger(batchSize) && batchSize > 0 && batchSize <= 5_000
    ? batchSize
    : 500;
  const result = await pool.query(
    `WITH removable AS (
       SELECT id FROM auth_sessions
       WHERE expires_at <= now()
          OR (revoked_at IS NOT NULL AND revoked_at <= now() - interval '24 hours')
       ORDER BY expires_at
       LIMIT $1
     )
     DELETE FROM auth_sessions s USING removable r WHERE s.id = r.id`,
    [safeBatchSize],
  );
  return result.rowCount ?? 0;
}
