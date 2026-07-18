import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestApp = {
  listen(port: number, host: string): {
    once(event: "listening" | "error", listener: (...args: never[]) => void): void;
    address(): AddressInfo | string | null;
    close(callback: (error?: Error) => void): void;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function listen(app: TestApp): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function login(baseUrl: string, username: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: process.env.E2E_TEST_PASSWORD }),
  });
  assert(response.status === 200, `Login failed for ${username}: ${response.status}`);
  const body = await response.json() as { token?: string };
  assert(body.token, `Token missing for ${username}.`);
  return body.token;
}

async function getUser(username: string): Promise<{ id: number; company_id: number }> {
  const result = await pool.query<{ id: number; company_id: number }>(
    "SELECT id, company_id FROM users WHERE username = $1",
    [username],
  );
  const row = result.rows[0];
  assert(row, `Fixture user missing: ${username}`);
  return row;
}

async function seedSnapshots(): Promise<{ companyA: number; companyB: number }> {
  const adminA = await getUser(process.env.E2E_ADMIN_USERNAME!);
  const adminB = await getUser(process.env.E2E_STANDARD_B_USERNAME!);
  await pool.query("DELETE FROM report_generation_snapshots WHERE filename LIKE 'ops-diagnostics-%'");
  await pool.query(
    `
      INSERT INTO report_generation_snapshots(company_id, report_type, status, storage_status, filename, settings_snapshot_json, generated_by, generated_at, failed_at, failure_reason)
      VALUES
        ($1, 'energy_targets_management', 'generating', 'not_stored', 'ops-diagnostics-new.pdf', '{"safe":true}', $3, now(), null, null),
        ($1, 'energy_targets_management', 'generating', 'not_stored', 'ops-diagnostics-stale.pdf', '{"secret":"must-not-leak"}', $3, now() - interval '2 hours', null, null),
        ($1, 'annual_energy_performance', 'completed', 'not_stored', 'ops-diagnostics-completed.html', '{"safe":true}', $3, now() - interval '3 hours', null, null),
        ($1, 'energy_performance_monitoring', 'failed', 'not_stored', 'ops-diagnostics-failed.pdf', '{"html":"must-not-leak"}', $3, now() - interval '1 hour', now() - interval '50 minutes', 'settings_snapshot'),
        ($1, 'energy_performance_monitoring', 'failed', 'not_stored', 'ops-diagnostics-failed-redacted.pdf', '{"html":"must-not-leak"}', $3, now() - interval '1 hour', now() - interval '45 minutes', 'C:\\secret\\browser.exe'),
        ($2, 'energy_targets_management', 'generating', 'not_stored', 'ops-diagnostics-tenant-b.pdf', '{"tenant":"b"}', $4, now() - interval '2 hours', null, null)
    `,
    [adminA.company_id, adminB.company_id, adminA.id, adminB.id],
  );
  return { companyA: adminA.company_id, companyB: adminB.company_id };
}

async function requestDiagnostics(baseUrl: string, token: string, query = ""): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/report-snapshots/diagnostics${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function main(): Promise<void> {
  const appModule = await import(pathToFileURL(path.resolve(__dirname, "../../artifacts/api-server/src/app.ts")).href) as { default: TestApp };
  const { companyA, companyB } = await seedSnapshots();
  const server = await listen(appModule.default);
  try {
    const adminToken = await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!);
    const standardToken = await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!);
    const superadminToken = await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);

    assert((await requestDiagnostics(server.baseUrl, standardToken)).status === 403, "Standard user should be forbidden.");
    assert((await requestDiagnostics(server.baseUrl, adminToken, `?companyId=${companyB}`)).status === 403, "Admin saw another tenant.");
    assert((await requestDiagnostics(server.baseUrl, adminToken, "?reportType=bad")).status === 400, "Unknown report type accepted.");
    assert((await requestDiagnostics(server.baseUrl, adminToken, "?staleMinutes=1")).status === 400, "Invalid low threshold accepted.");
    assert((await requestDiagnostics(server.baseUrl, adminToken, "?limit=500")).status === 400, "Invalid high limit accepted.");

    const response = await requestDiagnostics(server.baseUrl, adminToken, "?staleMinutes=30&limit=10");
    assert(response.status === 200, `Admin diagnostics failed: ${response.status}`);
    const bodyText = await response.text();
    assert(!bodyText.includes("must-not-leak") && !bodyText.includes("settingsSnapshot") && !bodyText.includes("C:\\secret"), "Diagnostics leaked sensitive snapshot data.");
    const body = JSON.parse(bodyText) as {
      companyId?: number;
      staleGenerating?: unknown[];
      failed?: Array<{ failureCategory?: string | null }>;
    };
    assert(body.companyId === companyA, "Admin diagnostics company scope mismatch.");
    assert((body.staleGenerating ?? []).length === 1, "Stale generating count mismatch.");
    assert((body.failed ?? []).length >= 2, "Failed diagnostics missing.");
    assert(body.failed?.some(row => row.failureCategory === "redacted"), "Unsafe failure category was not redacted.");

    const superResponse = await requestDiagnostics(server.baseUrl, superadminToken, `?companyId=${companyB}&staleMinutes=30`);
    assert(superResponse.status === 200, "Superadmin explicit company diagnostics failed.");
    const superBody = await superResponse.json() as { companyId?: number; staleGenerating?: unknown[] };
    assert(superBody.companyId === companyB && (superBody.staleGenerating ?? []).length === 1, "Superadmin company context mismatch.");

    console.log(JSON.stringify({ operationalDiagnosticsScenarios: 11 }));
  } finally {
    await server.close();
    await pool.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(`[test-operational-diagnostics] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
