import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] === "force" ? "force" : "push";

function fail(message) {
  console.error(`[db-push-guard] ${message}`);
  process.exit(1);
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function databaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("DATABASE_URL is required.");
  try {
    return new URL(raw);
  } catch {
    fail("DATABASE_URL is invalid.");
  }
}

if (process.env.NODE_ENV === "production") {
  fail("Refusing drizzle push while NODE_ENV=production.");
}
if (process.env.ALLOW_DRIZZLE_PUSH !== "true") {
  fail("Set ALLOW_DRIZZLE_PUSH=true for disposable local/dev schema push.");
}
if (process.env.TEST_DB_DISPOSABLE !== "true") {
  fail("Set TEST_DB_DISPOSABLE=true to confirm the database is disposable.");
}
if (mode === "force" && process.env.ALLOW_DRIZZLE_PUSH_FORCE !== "true") {
  fail("Set ALLOW_DRIZZLE_PUSH_FORCE=true for push-force.");
}

const url = databaseUrl();
if (!isLocalHost(url.hostname)) {
  fail("Refusing drizzle push against non-local database host.");
}

const args = ["exec", "drizzle-kit", "push", "--config", "./drizzle.config.ts"];
if (mode === "force") args.splice(3, 0, "--force");

console.error(`[db-push-guard] Allowed ${mode} for confirmed disposable local database.`);
const child = spawn("pnpm", args, {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[db-push-guard] drizzle-kit terminated by signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
