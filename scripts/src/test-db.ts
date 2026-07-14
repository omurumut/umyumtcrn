import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const POSTGRES_IMAGE = "postgres:16-alpine";
const POSTGRES_USER = "test_runner";
const POSTGRES_DB = "iso50001_test";
const TEST_DB_LABEL = "com.iso50001-ems.test-db";
const RUN_LABEL = `${TEST_DB_LABEL}.run`;
const READINESS_ATTEMPTS = 60;
const READINESS_DELAY_MS = 500;
const DOCKER_TIMEOUT_MS = 10_000;
const DOCKER_RUN_TIMEOUT_MS = 120_000;
const TASKKILL_TIMEOUT_MS = 2_000;
const GRACEFUL_SHUTDOWN_MS = 3_000;
const FORCE_SHUTDOWN_MS = 2_000;
const WATCHDOG_STOP_MS = 2_000;
const SENSITIVE_ENV_NAMES = new Set([
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGPASSFILE",
  "PGOPTIONS",
  "PGSYSCONFDIR",
  "NODE_OPTIONS",
  "TEST_DB_CHILD_TIMEOUT_MS",
]);
const UNSAFE_ENV_NAME = /(SEED|BOOTSTRAP|DEMO|MGM|IMPORT|EXPORT|SYNC|DOTENV)/i;
const CLEANUP_WATCHDOG_SOURCE = String.raw`
const { spawnSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const parentPid = Number(process.argv[1]);
const containerId = process.argv[2];
const runId = process.argv[3];
const fixedLabel = process.argv[4];
const runLabel = process.argv[5];
const cidFile = process.argv[6];
const format = "{{.Id}}|{{index .Config.Labels \"" + fixedLabel + "\"}}|{{index .Config.Labels \"" + runLabel + "\"}}";
function parentIsAlive() {
  try { process.kill(parentPid, 0); return true; } catch { return false; }
}
function cleanupOwnedContainer() {
  const inspected = spawnSync("docker", ["inspect", "--format", format, containerId], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, windowsHide: true,
  });
  const [actualId, fixedValue, runValue] = (inspected.stdout || "").trim().split("|");
  if (inspected.status === 0 && actualId === containerId && fixedValue === "true" && runValue === runId) {
    spawnSync("docker", ["rm", "--force", containerId], {
      stdio: "ignore", timeout: 5000, windowsHide: true,
    });
  }
  try { rmSync(cidFile, { force: true }); } catch {}
}
function monitor() {
  if (parentIsAlive()) { setTimeout(monitor, 250); return; }
  cleanupOwnedContainer();
}
monitor();
`;

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

interface ManagedProcess {
  child: ChildProcess;
  processTree: boolean;
}

interface Invocation {
  mode: "smoke" | "with-child";
  childCommand: string[] | null;
}

interface OwnershipResult {
  missing: boolean;
  owned: boolean;
}

let activeProcess: ManagedProcess | null = null;
let signalExitCode: number | null = null;
let activeTermination: Promise<void> | null = null;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForClose(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("close", onClose);
  });
}

function runTaskkill(pid: number, force: boolean): Promise<void> {
  return new Promise((resolve) => {
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    const killer = spawn("taskkill", args, {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => killer.kill("SIGKILL"), TASKKILL_TIMEOUT_MS);
    killer.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
    killer.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function terminateProcess(
  child: ChildProcess,
  processTree: boolean,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32" && processTree) {
    await runTaskkill(pid, false);
  } else {
    try {
      process.kill(processTree ? -pid : pid, "SIGTERM");
    } catch {
      return;
    }
  }

  if (await waitForClose(child, GRACEFUL_SHUTDOWN_MS)) return;

  if (process.platform === "win32" && processTree) {
    await runTaskkill(pid, true);
  } else {
    try {
      process.kill(processTree ? -pid : pid, "SIGKILL");
    } catch {
      return;
    }
  }
  await waitForClose(child, FORCE_SHUTDOWN_MS);
}

function signalExitCodeFor(signal: NodeJS.Signals | null): number {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  if (signal === "SIGKILL") return 137;
  return 128;
}

function runProcess(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    inherit?: boolean;
    timeoutMs?: number;
    processTree?: boolean;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const processTree = options.processTree ?? false;
    const child = spawn(command, args, {
      cwd: process.cwd(),
      detached: processTree && process.platform !== "win32",
      env: options.env ?? process.env,
      shell: false,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    activeProcess = { child, processTree };

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    if (!options.inherit) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          void terminateProcess(child, processTree);
        }, options.timeoutMs)
      : null;

    child.once("error", (error) => {
      if (timeout) clearTimeout(timeout);
      if (activeProcess?.child === child) activeProcess = null;
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (activeProcess?.child === child) activeProcess = null;
      if (settled) return;
      settled = true;
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: timedOut ? 124 : (code ?? signalExitCodeFor(signal)),
        signal,
        timedOut,
      });
    });
  });
}

async function runDocker(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    allowFailure?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<ProcessResult> {
  const result = await runProcess("docker", args, {
    env: options.env ?? sanitizedHostEnvironment(),
    timeoutMs: options.timeoutMs ?? DOCKER_TIMEOUT_MS,
  });
  if (result.timedOut) {
    throw new Error(
      `Docker komutu ${options.timeoutMs ?? DOCKER_TIMEOUT_MS} ms içinde tamamlanmadı.`,
    );
  }
  if (result.exitCode !== 0 && !options.allowFailure) {
    throw new Error(
      `Docker komutu başarısız oldu (${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function sanitizedHostEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      !SENSITIVE_ENV_NAMES.has(key.toUpperCase()) &&
      !UNSAFE_ENV_NAME.test(key)
    ) {
      env[key] = value;
    }
  }
  return env;
}

function disposableEnvironment(
  databaseUrl: string,
  password: string,
  containerId: string,
  runId: string,
  port: number,
): NodeJS.ProcessEnv {
  return {
    ...sanitizedHostEnvironment(),
    DATABASE_URL: databaseUrl,
    PGHOST: "127.0.0.1",
    PGPORT: String(port),
    PGUSER: POSTGRES_USER,
    PGPASSWORD: password,
    PGDATABASE: POSTGRES_DB,
    NODE_ENV: "test",
    ENABLE_SUPERADMIN_BOOTSTRAP: "false",
    ENABLE_DEMO_SEED: "false",
    ENABLE_DEMO_SEED_USERS: "false",
    TEST_DB_DISPOSABLE: "true",
    TEST_DB_CONTAINER_ID: containerId,
    TEST_DB_RUN_ID: runId,
    TEST_DB_PORT: String(port),
  };
}

function parseInvocation(): Invocation {
  const [modeArg, ...rest] = process.argv.slice(2);
  if (modeArg !== "--smoke" && modeArg !== "--with-child") {
    throw new Error(
      "Kullanım: test-db.ts --smoke | --with-child -- <executable> [args...]",
    );
  }

  const command = [...rest];
  while (command[0] === "--") command.shift();
  if (modeArg === "--smoke") {
    if (command.length > 0)
      throw new Error("test:db:smoke child command kabul etmez.");
    return { mode: "smoke", childCommand: null };
  }
  if (command.length === 0) {
    throw new Error(
      "Kullanım: pnpm run test:with-db -- <executable> [args...]",
    );
  }
  if (
    process.platform === "win32" &&
    [".cmd", ".bat"].includes(extname(command[0]).toLowerCase())
  ) {
    throw new Error(
      "Windows .cmd/.bat child commands are not supported. Use a Node/JS entrypoint.",
    );
  }

  // Child commands are trusted repository test entrypoints; this is not a filesystem sandbox.
  return { mode: "with-child", childCommand: command };
}

function optionalChildTimeoutMs(): number | undefined {
  const raw = process.env.TEST_DB_CHILD_TIMEOUT_MS;
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new Error("TEST_DB_CHILD_TIMEOUT_MS pozitif tam sayı olmalıdır.");
  }
  const timeoutMs = Number(raw);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 600_000
  ) {
    throw new Error(
      "TEST_DB_CHILD_TIMEOUT_MS 100-600000 aralığında olmalıdır.",
    );
  }
  return timeoutMs;
}

function ownershipFormat(): string {
  return `{{.Id}}|{{index .Config.Labels "${TEST_DB_LABEL}"}}|{{index .Config.Labels "${RUN_LABEL}"}}`;
}

async function readContainerIdFile(cidFile: string): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const containerId = (await readFile(cidFile, "utf8"))
        .trim()
        .toLowerCase();
      return /^[a-f0-9]{64}$/.test(containerId) ? containerId : null;
    } catch {
      if (attempt < 9) await wait(100);
    }
  }
  return null;
}

async function inspectOwnership(
  containerId: string,
  runId: string,
): Promise<OwnershipResult> {
  const result = await runDocker(
    ["inspect", "--format", ownershipFormat(), containerId],
    { allowFailure: true },
  );
  if (result.exitCode !== 0) {
    return {
      missing: /no such (object|container)/i.test(result.stderr),
      owned: false,
    };
  }
  const [actualId, fixedLabel, actualRunId] = result.stdout.split("|");
  return {
    missing: false,
    owned:
      actualId === containerId &&
      fixedLabel === "true" &&
      actualRunId === runId,
  };
}

async function assertContainerOwnership(
  containerId: string,
  runId: string,
): Promise<void> {
  const ownership = await inspectOwnership(containerId, runId);
  if (ownership.missing || !ownership.owned) {
    throw new Error("Disposable container ID/label sahipliği doğrulanamadı.");
  }
}

function startCleanupWatchdog(
  containerId: string,
  runId: string,
  cidFile: string,
): ChildProcess {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "TEMP",
    "TMP",
    "HOME",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const watchdog = spawn(
    process.execPath,
    [
      "-e",
      CLEANUP_WATCHDOG_SOURCE,
      String(process.pid),
      containerId,
      runId,
      TEST_DB_LABEL,
      RUN_LABEL,
      cidFile,
    ],
    {
      detached: true,
      env,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  watchdog.unref();
  return watchdog;
}

async function stopCleanupWatchdog(
  watchdog: ChildProcess | null,
): Promise<boolean> {
  if (!watchdog || watchdog.exitCode !== null || watchdog.signalCode !== null)
    return true;
  watchdog.kill("SIGTERM");
  if (await waitForClose(watchdog, WATCHDOG_STOP_MS)) return true;
  watchdog.kill("SIGKILL");
  return waitForClose(watchdog, FORCE_SHUTDOWN_MS);
}

async function containerState(containerId: string): Promise<string> {
  const result = await runDocker([
    "inspect",
    "--format",
    "{{.State.Status}}",
    containerId,
  ]);
  return result.stdout;
}

async function waitForPostgres(containerId: string): Promise<void> {
  for (let attempt = 1; attempt <= READINESS_ATTEMPTS; attempt += 1) {
    const state = await containerState(containerId);
    if (state === "exited" || state === "dead") {
      throw new Error(`Disposable PostgreSQL erken kapandı: ${state}.`);
    }
    if (state !== "running") {
      throw new Error(`Disposable PostgreSQL beklenmeyen durumda: ${state}.`);
    }
    const result = await runDocker(
      [
        "exec",
        containerId,
        "pg_isready",
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
      ],
      { allowFailure: true },
    );
    if (result.exitCode === 0) return;
    if (signalExitCode !== null) throw new Error("Sinyal alındı.");
    if (attempt < READINESS_ATTEMPTS) await wait(READINESS_DELAY_MS);
  }
  throw new Error("Disposable PostgreSQL readiness süresi aşıldı.");
}

async function verifyContainerIsolation(
  containerId: string,
  runId: string,
): Promise<number> {
  await assertContainerOwnership(containerId, runId);
  const portsResult = await runDocker([
    "inspect",
    "--format",
    "{{json .NetworkSettings.Ports}}",
    containerId,
  ]);
  const ports = JSON.parse(portsResult.stdout) as Record<
    string,
    Array<{ HostIp: string; HostPort: string }> | null
  >;
  const binding = ports["5432/tcp"]?.[0];
  if (
    !binding ||
    binding.HostIp !== "127.0.0.1" ||
    !/^\d+$/.test(binding.HostPort)
  ) {
    throw new Error("PostgreSQL portu yalnız 127.0.0.1 üzerinde yayınlanmadı.");
  }

  const tmpfsResult = await runDocker([
    "inspect",
    "--format",
    "{{json .HostConfig.Tmpfs}}",
    containerId,
  ]);
  const tmpfs = JSON.parse(tmpfsResult.stdout) as Record<string, string> | null;
  if (!tmpfs || !("/var/lib/postgresql/data" in tmpfs)) {
    throw new Error("PostgreSQL veri dizini tmpfs üzerinde değil.");
  }

  const mountsResult = await runDocker([
    "inspect",
    "--format",
    "{{json .Mounts}}",
    containerId,
  ]);
  const mounts = JSON.parse(mountsResult.stdout) as Array<{ Type: string }>;
  if (
    mounts.some((mount) => mount.Type === "volume" || mount.Type === "bind")
  ) {
    throw new Error(
      "Disposable container kalıcı volume veya bind mount kullanıyor.",
    );
  }
  return Number(binding.HostPort);
}

async function runSmokeChild(
  env: NodeJS.ProcessEnv,
  mode: "migrate" | "assert",
): Promise<void> {
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const smokeFile = fileURLToPath(
    new URL("./test-db-smoke.ts", import.meta.url),
  );
  const result = await runProcess(
    process.execPath,
    [tsxCli, smokeFile, `--${mode}`],
    {
      env,
      inherit: true,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Test DB ${mode} child işlemi ${result.exitCode} koduyla başarısız oldu.`,
    );
  }
}

async function cleanupContainer(
  containerId: string,
  runId: string,
): Promise<boolean> {
  const ownership = await inspectOwnership(containerId, runId);
  if (ownership.missing) {
    console.log("[test-db] Cleanup doğrulandı; container zaten yok.");
    return true;
  }
  if (!ownership.owned) {
    console.error(
      "[test-db] Cleanup reddedildi: container ID/label sahipliği eşleşmiyor.",
    );
    return false;
  }

  const removal = await runDocker(["rm", "--force", containerId], {
    allowFailure: true,
  });
  const afterRemoval = await inspectOwnership(containerId, runId);
  const clean =
    (removal.exitCode === 0 || afterRemoval.missing) && afterRemoval.missing;
  console.log(
    clean
      ? "[test-db] Cleanup doğrulandı."
      : "[test-db] Cleanup doğrulanamadı.",
  );
  return clean;
}

async function main(): Promise<number> {
  let invocation: Invocation;
  let childTimeoutMs: number | undefined;
  try {
    invocation = parseInvocation();
    childTimeoutMs = optionalChildTimeoutMs();
  } catch (error) {
    console.error(
      `[test-db] ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }

  const runId = randomBytes(12).toString("hex");
  const containerName = `iso50001-test-db-${runId}`;
  const cidFile = join(tmpdir(), `${containerName}.cid`);
  const password = randomBytes(32).toString("base64url");
  let containerId: string | null = null;
  let cleanupWatchdog: ChildProcess | null = null;
  let intendedExitCode = 0;
  let cleanupFailed = false;

  console.log(
    `[test-db] Disposable PostgreSQL oluşturuluyor: ${containerName}`,
  );
  try {
    await runDocker(["info", "--format", "{{.ServerVersion}}"]);
    const dockerEnv = {
      ...sanitizedHostEnvironment(),
      POSTGRES_PASSWORD: password,
    };
    let created: ProcessResult;
    try {
      created = await runDocker(
        [
          "run",
          "--detach",
          "--name",
          containerName,
          "--cidfile",
          cidFile,
          "--label",
          `${TEST_DB_LABEL}=true`,
          "--label",
          `${RUN_LABEL}=${runId}`,
          "--restart",
          "no",
          "--publish",
          "127.0.0.1::5432",
          "--tmpfs",
          "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m",
          "--env",
          "POSTGRES_PASSWORD",
          "--env",
          `POSTGRES_USER=${POSTGRES_USER}`,
          "--env",
          `POSTGRES_DB=${POSTGRES_DB}`,
          POSTGRES_IMAGE,
        ],
        { env: dockerEnv, timeoutMs: DOCKER_RUN_TIMEOUT_MS },
      );
    } catch (error) {
      containerId = await readContainerIdFile(cidFile);
      throw error;
    }
    const cidFileId = await readContainerIdFile(cidFile);
    if (!cidFileId) {
      throw new Error("Docker geçerli bir container ID döndürmedi.");
    }
    containerId = cidFileId;
    if (
      !/^[a-f0-9]{64}$/i.test(created.stdout) ||
      created.stdout.toLowerCase() !== containerId
    ) {
      throw new Error(
        "Docker stdout ve cidfile container ID değerleri eşleşmiyor.",
      );
    }
    await assertContainerOwnership(containerId, runId);
    cleanupWatchdog = startCleanupWatchdog(containerId, runId, cidFile);

    const port = await verifyContainerIsolation(containerId, runId);
    await waitForPostgres(containerId);
    const databaseUrl = `postgresql://${POSTGRES_USER}:${encodeURIComponent(password)}@127.0.0.1:${port}/${POSTGRES_DB}?sslmode=disable`;
    const childEnv = disposableEnvironment(
      databaseUrl,
      password,
      containerId,
      runId,
      port,
    );

    console.log(
      `[test-db] PostgreSQL hazır (localhost:${port}); runtime migration doğrulanıyor.`,
    );
    await runSmokeChild(childEnv, "migrate");

    if (invocation.mode === "with-child" && invocation.childCommand) {
      console.log(
        `[test-db] Child komutu çalıştırılıyor: ${invocation.childCommand[0]}`,
      );
      const result = await runProcess(
        invocation.childCommand[0],
        invocation.childCommand.slice(1),
        {
          env: childEnv,
          inherit: true,
          processTree: true,
          timeoutMs: childTimeoutMs,
        },
      );
      intendedExitCode = result.exitCode;
    } else {
      console.log("[test-db] Salt-okuma child smoke çalıştırılıyor.");
      await runSmokeChild(childEnv, "assert");
    }
  } catch (error) {
    if (signalExitCode === null) {
      console.error(
        `[test-db] Hata: ${error instanceof Error ? error.message : String(error)}`,
      );
      intendedExitCode = intendedExitCode || 1;
    }
  } finally {
    if (activeTermination) await activeTermination;
    if (containerId) {
      try {
        cleanupFailed = !(await cleanupContainer(containerId, runId));
      } catch (error) {
        cleanupFailed = true;
        console.error(
          `[test-db] Cleanup hatası: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (!(await stopCleanupWatchdog(cleanupWatchdog))) {
      cleanupFailed = true;
      console.error("[test-db] Cleanup watchdog zamanında kapanmadı.");
    }
    await rm(cidFile, { force: true });
  }

  if (signalExitCode !== null) return signalExitCode;
  if (intendedExitCode !== 0) return intendedExitCode;
  return cleanupFailed ? 1 : 0;
}

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.once(signal, () => {
    signalExitCode = exitCode;
    if (activeProcess && !activeTermination) {
      activeTermination = terminateProcess(
        activeProcess.child,
        activeProcess.processTree,
      );
    }
  });
}

process.exitCode = await main();
