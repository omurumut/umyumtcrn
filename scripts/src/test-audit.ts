import { auditEventsTable, db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDisposableDatabase(): void {
  assert(process.env.NODE_ENV === "test", "Audit test NODE_ENV=test gerektirir.");
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Audit test yalniz disposable DB uzerinde calisir.");
  const rawUrl = process.env.DATABASE_URL;
  assert(rawUrl, "DATABASE_URL yok.");
  const url = new URL(rawUrl);
  assert(url.hostname === "127.0.0.1", "Audit test yalniz localhost disposable DB kullanir.");
  assert(url.pathname === "/iso50001_test", "Audit test DB adi gecersiz.");
}

function sanitizeForAudit(value: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/(password|hash|token|authorization|cookie|secret)/i.test(key)) output[key] = "[redacted]";
    else if (raw && typeof raw === "object" && !Array.isArray(raw)) output[key] = sanitizeForAudit(raw as Record<string, unknown>);
    else output[key] = raw;
  }
  return output;
}

async function main() {
  assertDisposableDatabase();

  const sanitized = sanitizeForAudit({
    username: "demo",
    password: "secret",
    passwordHash: "hash",
    authorization: "Bearer token",
    nested: { tokenHash: "token", safe: "ok" },
  }) as Record<string, unknown>;
  assert(sanitized.password === "[redacted]", "password redaction yok.");
  assert(sanitized.passwordHash === "[redacted]", "passwordHash redaction yok.");
  assert(sanitized.authorization === "[redacted]", "authorization redaction yok.");
  assert(JSON.stringify(sanitized).includes("secret") === false, "secret degeri sizdi.");

  const [user] = await db.select({ id: usersTable.id, role: usersTable.role, companyId: usersTable.companyId })
    .from(usersTable)
    .where(eq(usersTable.role, "user"))
    .limit(1);
  assert(user, "Rollback testi icin user bulunamadi.");

  const before = user.role;
  try {
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, user.id));
      await tx.insert(auditEventsTable).values({
        requestId: "audit-rollback-test",
        actorUserId: 999999999,
        actorRole: "test",
        companyId: user.companyId,
        action: "user.update",
        entityType: "user",
        entityId: String(user.id),
        outcome: "success",
        changes: { role: { before, after: "admin" } },
      });
    });
    throw new Error("Audit FK failure beklenirken transaction basarili oldu.");
  } catch {
    // expected FK rollback
  }

  const [after] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, user.id));
  assert(after?.role === before, "Audit failure role update rollback etmedi.");

  console.log(JSON.stringify({ ok: true, assertions: 6 }, null, 2));
}

await main();
