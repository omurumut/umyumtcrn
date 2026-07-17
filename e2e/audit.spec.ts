import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime değeri zorunludur.`);
  return value;
}

function disposableDatabaseUrl(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Audit E2E yalnız disposable test DB üzerinde çalışır.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Audit E2E bağlantısı disposable localhost DB ile eşleşmiyor.");
  }
  return rawUrl;
}

type QueryResult<Row> = { rows: Row[]; rowCount: number | null };
type TestPool = {
  query<Row>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};

const scriptsRequire = createRequire(resolve(process.cwd(), "scripts/package.json"));
const { Pool } = scriptsRequire("pg") as {
  Pool: new (options: { connectionString: string }) => TestPool;
};
const pool = new Pool({ connectionString: disposableDatabaseUrl() });

const credentials = {
  standardA1: requiredEnv("E2E_STANDARD_USERNAME"),
  standardB1: requiredEnv("E2E_STANDARD_B_USERNAME"),
  adminA: requiredEnv("E2E_ADMIN_USERNAME"),
  kontrolAdminA: requiredEnv("E2E_KONTROL_ADMIN_USERNAME"),
  superadmin: requiredEnv("E2E_SUPERADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type LoginResult = {
  token: string;
  user: { id: number; role: string; companyId: number; unitId: number | null };
};

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function login(request: APIRequestContext, username: string): Promise<LoginResult> {
  const response = await request.post("/api/auth/login", {
    data: { username, password: credentials.password },
  });
  expect(response.status()).toBe(200);
  return await response.json() as LoginResult;
}

async function fixtureIds() {
  const result = await pool.query<{ company_a: number; company_b: number; meter_a1: number; target_a1: number }>(
    `SELECT
       (SELECT company_id FROM users WHERE username = $1) company_a,
       (SELECT company_id FROM users WHERE username = $2) company_b,
       (SELECT id FROM meters WHERE name='[E2E] Shared Meter' AND company_id=(SELECT company_id FROM users WHERE username = $1) ORDER BY id LIMIT 1) meter_a1,
       (SELECT id FROM energy_targets WHERE company_id=(SELECT company_id FROM users WHERE username = $1) ORDER BY id LIMIT 1) target_a1`,
    [credentials.adminA, credentials.standardB1],
  );
  return result.rows[0]!;
}

test.afterAll(async () => {
  await pool.end();
});

test.describe.serial("audit events", () => {
  test("AUDIT-01 request ID is echoed and accepted when safe", async ({ request }) => {
    const response = await request.get("/api/health", { headers: { "X-Request-Id": "e2e-audit-request-1" } });
    expect(response.headers()["x-request-id"]).toBe("e2e-audit-request-1");
  });

  test("AUDIT-02 standard user cannot read audit events", async ({ request }) => {
    const session = await login(request, credentials.standardA1);
    const response = await request.get("/api/audit-events", { headers: auth(session.token) });
    expect(response.status()).toBe(403);
  });

  test("AUDIT-03 admin and kontrol_admin see only own company audit", async ({ request }) => {
    const ids = await fixtureIds();
    await request.post("/api/auth/login", { data: { username: credentials.adminA, password: credentials.password } });

    const admin = await login(request, credentials.adminA);
    const adminResponse = await request.get(`/api/audit-events?companyId=${ids.company_b}`, { headers: auth(admin.token) });
    expect(adminResponse.status()).toBe(200);
    const adminBody = await adminResponse.json() as { items: Array<{ companyId: number | null }> };
    expect(adminBody.items.every((event) => event.companyId === admin.user.companyId)).toBe(true);

    const kontrol = await login(request, credentials.kontrolAdminA);
    const kontrolResponse = await request.get("/api/audit-events", { headers: auth(kontrol.token) });
    expect(kontrolResponse.status()).toBe(200);
  });

  test("AUDIT-04 superadmin requires explicit company or platform scope", async ({ request }) => {
    const ids = await fixtureIds();
    const session = await login(request, credentials.superadmin);
    const missing = await request.get("/api/audit-events", { headers: auth(session.token) });
    expect(missing.status()).toBe(400);

    const company = await request.get(`/api/audit-events?companyId=${ids.company_a}`, { headers: auth(session.token) });
    expect(company.status()).toBe(200);
    const platform = await request.get("/api/audit-events?scope=platform", { headers: auth(session.token) });
    expect(platform.status()).toBe(200);
  });

  test("AUDIT-05 strict query parsing rejects invalid ids and filters", async ({ request }) => {
    const session = await login(request, credentials.superadmin);
    expect((await request.get("/api/audit-events?companyId=123abc", { headers: auth(session.token) })).status()).toBe(400);
    expect((await request.get("/api/audit-events?scope=platform&action=raw.request.body", { headers: auth(session.token) })).status()).toBe(400);
    expect((await request.get("/api/audit-events/1.5?scope=platform", { headers: auth(session.token) })).status()).toBe(400);
  });

  test("AUDIT-06 auth failures are audited without raw username or password", async ({ request }) => {
    const username = `audit-failure-${Date.now()}`;
    const response = await request.post("/api/auth/login", { data: { username, password: "wrong-password" } });
    expect([401, 429]).toContain(response.status());

    const superadmin = await login(request, credentials.superadmin);
    const events = await request.get("/api/audit-events?scope=platform&action=auth.login.failure&pageSize=10", { headers: auth(superadmin.token) });
    expect(events.status()).toBe(200);
    const body = await events.json() as { items: unknown[] };
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(username);
    expect(serialized).not.toContain("wrong-password");
    expect(serialized).toContain("usernameHash");
  });

  test("AUDIT-07 user password changes redact password material", async ({ request }) => {
    const admin = await login(request, credentials.adminA);
    const create = await request.post("/api/users", {
      headers: auth(admin.token),
      data: { username: `audit-user-${Date.now()}`, password: `${credentials.password}x`, name: "Audit User", role: "user", unitId: admin.user.unitId },
    });
    expect(create.status()).toBe(201);
    const user = await create.json() as { id: number };
    const patch = await request.patch(`/api/users/${user.id}`, {
      headers: auth(admin.token),
      data: { password: `${credentials.password}y`, role: "kontrol_admin" },
    });
    expect(patch.status()).toBe(200);

    const list = await request.get("/api/audit-events?action=user.update&pageSize=10", { headers: auth(admin.token) });
    const body = await list.json() as { items: unknown[] };
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(credentials.password);
    expect(serialized).not.toContain("passwordHash");

    await request.delete(`/api/users/${user.id}`, { headers: auth(admin.token) });
  });

  test("AUDIT-08 consumption create produces tenant-scoped audit event", async ({ request }) => {
    const ids = await fixtureIds();
    const admin = await login(request, credentials.adminA);
    const create = await request.post("/api/consumption", {
      headers: auth(admin.token),
      data: { meterId: ids.meter_a1, year: 2098, month: 11, kwh: 12.5, notes: "audit e2e" },
    });
    expect(create.status()).toBe(201);
    const consumption = await create.json() as { id: number };

    const list = await request.get(`/api/audit-events?action=consumption.create&entityId=${consumption.id}`, { headers: auth(admin.token) });
    expect(list.status()).toBe(200);
    const body = await list.json() as { items: Array<{ action: string; companyId: number; entityId: string }> };
    expect(body.items[0]).toMatchObject({ action: "consumption.create", companyId: admin.user.companyId, entityId: String(consumption.id) });

    await request.delete(`/api/consumption/${consumption.id}`, { headers: auth(admin.token) });
  });

  test("AUDIT-09 audit endpoints are append-only through API", async ({ request }) => {
    const admin = await login(request, credentials.adminA);
    expect((await request.post("/api/audit-events", { headers: auth(admin.token), data: {} })).status()).toBe(404);
    expect((await request.patch("/api/audit-events/1", { headers: auth(admin.token), data: {} })).status()).toBe(404);
    expect((await request.delete("/api/audit-events/1", { headers: auth(admin.token) })).status()).toBe(404);
  });

  test("AUDIT-10 pagination is bounded and stable", async ({ request }) => {
    const ids = await fixtureIds();
    await pool.query(
      `INSERT INTO audit_events (request_id, actor_role, company_id, action, entity_type, entity_id, outcome, changes_json)
       SELECT 'e2e-page', 'test', $1, 'target.update', 'target', gs::text, 'success', '{}'::jsonb
       FROM generate_series(1, 1000) gs`,
      [ids.company_a],
    );
    const admin = await login(request, credentials.adminA);
    const response = await request.get("/api/audit-events?action=target.update&pageSize=500", { headers: auth(admin.token) });
    expect(response.status()).toBe(200);
    const body = await response.json() as { items: unknown[]; pageSize: number };
    expect(body.pageSize).toBe(100);
    expect(body.items).toHaveLength(100);
  });

  test("AUDIT-11 action-plan create rolls back when audit insert fails", async ({ request }) => {
    const ids = await fixtureIds();
    const admin = await login(request, credentials.adminA);
    const title = `[E2E] audit rollback action ${Date.now()}`;
    await pool.query("ALTER TABLE audit_events ADD CONSTRAINT e2e_audit_action_create_fail CHECK (action <> 'action.create')");
    try {
      const response = await request.post("/api/energy-action-plans", {
        headers: auth(admin.token),
        data: { targetId: ids.target_a1, title, priority: "medium", status: "planned" },
      });
      expect(response.status()).toBeGreaterThanOrEqual(500);
      const bodyText = await response.text();
      expect(bodyText).not.toContain("e2e_audit_action_create_fail");
      expect(bodyText.toLowerCase()).not.toContain("constraint");
      const actionRows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM energy_action_plans WHERE title=$1", [title]);
      expect(actionRows.rows[0]?.count).toBe("0");
      const auditRows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM audit_events WHERE entity_type='action_plan' AND changes_json::text LIKE $1", [`%${title}%`]);
      expect(auditRows.rows[0]?.count).toBe("0");
    } finally {
      await pool.query("ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS e2e_audit_action_create_fail");
    }
  });
});
