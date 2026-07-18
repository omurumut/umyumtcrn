import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const guard = path.resolve(__dirname, "../../lib/db/scripts/guarded-drizzle-push.mjs");
const secretUrl = "postgresql://secret_user:secret_password@localhost:5432/disposable";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run(args: string[], env: NodeJS.ProcessEnv = {}, extraPath?: string) {
  return spawnSync(process.execPath, [guard, ...args], {
    encoding: "utf8",
    env: {
      PATH: extraPath ? `${extraPath}${path.delimiter}${process.env.PATH ?? ""}` : process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      ...env,
    },
  });
}

function output(result: ReturnType<typeof run>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function assertRejected(name: string, args: string[], env: NodeJS.ProcessEnv, expected: RegExp): void {
  const result = run(args, env);
  const text = output(result);
  assert((result.status ?? 1) !== 0, `${name}: guard unexpectedly passed.`);
  assert(expected.test(text), `${name}: expected message not found.`);
  assert(!text.includes("secret_password") && !text.includes(secretUrl), `${name}: secret URL leaked.`);
}

function makeFakePnpm(exitCode: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), "iso50001-pnpm-mock-"));
  if (process.platform === "win32") {
    writeFileSync(path.join(dir, "pnpm.cmd"), `@echo off\r\necho fake pnpm %*\r\nexit /b ${exitCode}\r\n`);
  } else {
    const file = path.join(dir, "pnpm");
    writeFileSync(file, `#!/usr/bin/env sh\necho fake pnpm "$@"\nexit ${exitCode}\n`, { mode: 0o755 });
  }
  return dir;
}

function main(): void {
  assertRejected("production env", [], {
    NODE_ENV: "production",
    DATABASE_URL: secretUrl,
    ALLOW_DRIZZLE_PUSH: "true",
    TEST_DB_DISPOSABLE: "true",
  }, /NODE_ENV=production/);

  assertRejected("missing db url", [], {
    ALLOW_DRIZZLE_PUSH: "true",
    TEST_DB_DISPOSABLE: "true",
  }, /DATABASE_URL is required/);

  assertRejected("invalid db url", [], {
    DATABASE_URL: "not a url",
    ALLOW_DRIZZLE_PUSH: "true",
    TEST_DB_DISPOSABLE: "true",
  }, /DATABASE_URL is invalid/);

  assertRejected("remote host", [], {
    DATABASE_URL: "postgresql://secret_user:secret_password@example.com:5432/db",
    ALLOW_DRIZZLE_PUSH: "true",
    TEST_DB_DISPOSABLE: "true",
  }, /non-local database host/);

  assertRejected("missing allow", [], {
    DATABASE_URL: secretUrl,
    TEST_DB_DISPOSABLE: "true",
  }, /ALLOW_DRIZZLE_PUSH=true/);

  assertRejected("missing disposable", [], {
    DATABASE_URL: secretUrl,
    ALLOW_DRIZZLE_PUSH: "true",
  }, /TEST_DB_DISPOSABLE=true/);

  assertRejected("missing force flag", ["force"], {
    DATABASE_URL: secretUrl,
    ALLOW_DRIZZLE_PUSH: "true",
    TEST_DB_DISPOSABLE: "true",
  }, /ALLOW_DRIZZLE_PUSH_FORCE=true/);

  const fake = makeFakePnpm(7);
  try {
    const result = run([], {
      DATABASE_URL: secretUrl,
      ALLOW_DRIZZLE_PUSH: "true",
      TEST_DB_DISPOSABLE: "true",
    }, fake);
    const text = output(result);
    assert(result.status === 7, "Child command failure exit code was not propagated.");
    assert(/fake pnpm/.test(text), "Mocked child command did not run.");
    assert(!text.includes("secret_password") && !text.includes(secretUrl), "Secret URL leaked in allowed path.");
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ dbPushGuardScenarios: 8 }));
}

main();
