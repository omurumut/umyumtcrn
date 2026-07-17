import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type DatabasePoolConfig = {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  maxUses?: number;
};

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function production(): boolean {
  return process.env.NODE_ENV === "production";
}

function parseBoundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    if (production()) throw new Error(`${name} must be a positive integer.`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    if (production()) throw new Error(`${name} must be between ${min} and ${max}.`);
    return fallback;
  }
  return parsed;
}

function parseOptionalBoundedIntegerEnv(name: string, min: number, max: number): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    if (production()) throw new Error(`${name} must be a positive integer.`);
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    if (production()) throw new Error(`${name} must be between ${min} and ${max}.`);
    return undefined;
  }
  return parsed;
}

export function resolveDatabasePoolConfig(): DatabasePoolConfig {
  const config: DatabasePoolConfig = {
    connectionString: process.env.DATABASE_URL!,
    max: parseBoundedIntegerEnv("DB_POOL_MAX", 10, 1, 50),
    idleTimeoutMillis: parseBoundedIntegerEnv("DB_POOL_IDLE_TIMEOUT_MS", 10_000, 1_000, 600_000),
    connectionTimeoutMillis: parseBoundedIntegerEnv("DB_POOL_CONNECTION_TIMEOUT_MS", 5_000, 100, 60_000),
  };
  const maxUses = parseOptionalBoundedIntegerEnv("DB_POOL_MAX_USES", 1, 100_000);
  if (maxUses !== undefined) config.maxUses = maxUses;
  return config;
}

export const databasePoolConfig = resolveDatabasePoolConfig();
export const pool = new Pool(databasePoolConfig);
export const db = drizzle(pool, { schema });

pool.on("error", () => {
  console.error("[db] Unexpected idle database client error.");
});

let poolClosePromise: Promise<void> | null = null;

export function closeDatabasePool(): Promise<void> {
  poolClosePromise ??= pool.end();
  return poolClosePromise;
}

export async function runMigrations(migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}

export * from "./schema";
