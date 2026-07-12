import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const apiRoot = join(projectRoot, "artifacts", "api-server");
const apiEntry = join(apiRoot, "dist", "index.mjs");
const envFile = join(projectRoot, ".env");
const comspec = process.env.ComSpec || "cmd.exe";

function loadEnvFile(filePath) {
  const result = {};
  if (!existsSync(filePath)) return result;

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

const childEnv = {
  ...process.env,
  ...loadEnvFile(envFile),
  PORT: "8080",
  NODE_ENV: "development",
};

let apiProcess = null;
let rebuilding = false;
let rebuildQueued = false;
let debounceTimer = null;

function stopApi() {
  if (!apiProcess || apiProcess.killed) return;

  spawnSync("taskkill", ["/PID", String(apiProcess.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });

  apiProcess = null;
}

function buildApi() {
  console.log("\n[EnYS] API build ediliyor...");

  const result = spawnSync(
    comspec,
    ["/d", "/s", "/c", "pnpm.cmd --filter @workspace/api-server run build"],
    {
      cwd: projectRoot,
      env: childEnv,
      stdio: "inherit",
      windowsHide: false,
    },
  );

  if (result.error) {
    console.error("\n[EnYS] Build komutu calistirilamadi:");
    console.error(result.error);
    return false;
  }

  if (result.status !== 0) {
    console.error(`\n[EnYS] Build cikis kodu: ${result.status}`);
    return false;
  }

  return true;
}

function startApi() {
  if (!existsSync(apiEntry)) {
    console.error("[EnYS] HATA: dist/index.mjs bulunamadi.");
    return;
  }

  console.log("[EnYS] API baslatiliyor: http://localhost:8080");

  apiProcess = spawn(
    process.execPath,
    ["--enable-source-maps", apiEntry],
    {
      cwd: apiRoot,
      env: childEnv,
      stdio: "inherit",
      windowsHide: false,
    },
  );

  apiProcess.on("error", (error) => {
    console.error("[EnYS] API baslatma hatasi:", error);
  });

  apiProcess.on("exit", (code, signal) => {
    if (apiProcess) {
      console.log(`[EnYS] API kapandi. Kod: ${code ?? "-"}, sinyal: ${signal ?? "-"}`);
    }
  });
}

function rebuildAndRestart() {
  if (rebuilding) {
    rebuildQueued = true;
    return;
  }

  rebuilding = true;
  stopApi();

  if (buildApi()) {
    startApi();
    console.log("[EnYS] Izleme aktif. API dosyasini kaydettiginizde otomatik yenilenecek.");
  } else {
    console.error("[EnYS] Build basarisiz. Yukaridaki hata mesajini kontrol edin.");
  }

  rebuilding = false;

  if (rebuildQueued) {
    rebuildQueued = false;
    scheduleRebuild();
  }
}

function scheduleRebuild() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(rebuildAndRestart, 700);
}

const watchDirectories = [
  join(projectRoot, "artifacts", "api-server", "src"),
  join(projectRoot, "lib", "db", "src"),
  join(projectRoot, "lib", "api-zod", "src"),
  join(projectRoot, "lib", "api-spec", "src"),
].filter(existsSync);

if (!existsSync(envFile)) {
  console.error("[EnYS] HATA: Proje kokunde .env dosyasi bulunamadi.");
  process.stdin.resume();
  process.exitCode = 1;
} else if (!existsSync(apiRoot)) {
  console.error("[EnYS] HATA: artifacts/api-server bulunamadi.");
  process.stdin.resume();
  process.exitCode = 1;
} else {
  console.log("[EnYS] API otomatik yenileme baslatiliyor.");
  console.log("[EnYS] Izlenen klasorler:");

  for (const directory of watchDirectories) {
    console.log(`  - ${directory}`);

    watch(directory, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;

      if (/\.(ts|tsx|js|mjs|json)$/i.test(filename)) {
        console.log(`[EnYS] Degisiklik algilandi: ${filename}`);
        scheduleRebuild();
      }
    });
  }

  process.on("SIGINT", () => {
    stopApi();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    stopApi();
    process.exit(0);
  });

  rebuildAndRestart();
}
