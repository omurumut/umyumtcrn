import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type ClosableServer = {
  address(): AddressInfo | string | null;
  close(callback: (error?: Error) => void): void;
  once?(event: string, callback: (error: Error) => void): void;
};

type TestApp = {
  listen(port: number, host: string, callback: () => void): ClosableServer;
};

type ViteServer = {
  listen(): Promise<void>;
  close(): Promise<void>;
  httpServer: { address(): AddressInfo | string | null } | null;
};

function assertDisposableEnvironment(): void {
  const databaseUrl = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : null;
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.TEST_DB_DISPOSABLE !== "true" ||
    !/^[a-f0-9]{64}$/i.test(process.env.TEST_DB_CONTAINER_ID ?? "") ||
    !/^[a-f0-9]{24}$/i.test(process.env.TEST_DB_RUN_ID ?? "") ||
    databaseUrl?.hostname !== "127.0.0.1" ||
    databaseUrl.pathname !== "/iso50001_test"
  ) {
    throw new Error(
      "E2E yalnız doğrulanmış disposable test DB üzerinde çalışır.",
    );
  }
  for (const name of [
    "E2E_ADMIN_USERNAME",
    "E2E_KONTROL_ADMIN_USERNAME",
    "E2E_STANDARD_USERNAME",
    "E2E_STANDARD_B_USERNAME",
    "E2E_NULL_UNIT_USERNAME",
    "E2E_INACTIVE_USERNAME",
    "E2E_INACTIVE_COMPANY_USERNAME",
    "E2E_SESSION_USERNAME",
    "E2E_SUPERADMIN_USERNAME",
    "E2E_TEST_PASSWORD",
  ]) {
    if (!process.env[name]) throw new Error(`${name} runtime değeri eksik.`);
  }
}

function listen(app: TestApp): Promise<ClosableServer> {
  return new Promise((resolveServer, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolveServer(server));
    server.once?.("error", reject);
  });
}

function closeServer(server: ClosableServer | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function addressPort(
  address: AddressInfo | string | null,
  label: string,
): number {
  if (
    !address ||
    typeof address === "string" ||
    !Number.isSafeInteger(address.port) ||
    address.port <= 0
  ) {
    throw new Error(`${label} rastgele portu çözülemedi.`);
  }
  return address.port;
}

function reserveLocalPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const reservation = createNetServer();
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const port = addressPort(reservation.address(), "Vite rezervasyon");
      reservation.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function runPlaywright(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const rootRequire = createRequire(resolve(repoRoot, "package.json"));
  const cli = rootRequire.resolve("@playwright/test/cli");
  return new Promise((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      [cli, "test", "--config", resolve(repoRoot, "playwright.config.ts")],
      {
        cwd: repoRoot,
        env,
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright sinyal ile kapandı: ${signal}`));
      } else {
        resolveExit(code ?? 1);
      }
    });
  });
}

async function main(): Promise<number> {
  assertDisposableEnvironment();
  const repoRoot = resolve(import.meta.dirname, "../..");
  let apiServer: ClosableServer | null = null;
  let viteServer: ViteServer | null = null;

  try {
    const appUrl = pathToFileURL(
      resolve(repoRoot, "artifacts/api-server/src/app.ts"),
    ).href;
    const appModule = (await import(appUrl)) as { default: TestApp };
    apiServer = await listen(appModule.default);
    const apiPort = addressPort(apiServer.address(), "API");
    const apiUrl = `http://127.0.0.1:${apiPort}`;

    const dashboardRoot = resolve(repoRoot, "artifacts/ems-dashboard");
    const dashboardRequire = createRequire(
      resolve(dashboardRoot, "package.json"),
    );
    const viteModuleUrl = pathToFileURL(dashboardRequire.resolve("vite")).href;
    const viteModule = (await import(viteModuleUrl)) as {
      createServer(config: Record<string, unknown>): Promise<ViteServer>;
    };
    const requestedFrontendPort = await reserveLocalPort();
    viteServer = await viteModule.createServer({
      configFile: resolve(dashboardRoot, "vite.config.ts"),
      root: dashboardRoot,
      mode: "test",
      envFile: false,
      logLevel: "warn",
      server: {
        host: "127.0.0.1",
        port: requestedFrontendPort,
        strictPort: true,
        allowedHosts: ["127.0.0.1"],
        proxy: { "/api": { target: apiUrl, changeOrigin: true } },
      },
    });
    await viteServer.listen();
    const frontendPort = addressPort(
      viteServer.httpServer?.address() ?? null,
      "Vite",
    );
    const baseUrl = `http://127.0.0.1:${frontendPort}`;
    console.log(
      `[test-e2e] API ve frontend localhost üzerinde hazır (${apiPort}/${frontendPort}).`,
    );

    return await runPlaywright(repoRoot, {
      ...process.env,
      E2E_BASE_URL: baseUrl,
    });
  } finally {
    if (viteServer) await viteServer.close().catch(() => undefined);
    await closeServer(apiServer).catch(() => undefined);
    const dbUrl = pathToFileURL(resolve(repoRoot, "lib/db/src/index.ts")).href;
    const dbModule = (await import(dbUrl).catch(() => null)) as {
      pool?: { end(): Promise<void> };
    } | null;
    if (dbModule?.pool) await dbModule.pool.end().catch(() => undefined);
    console.log("[test-e2e] API/frontend süreçleri kapatıldı.");
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(
    `[test-e2e] Hata: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
