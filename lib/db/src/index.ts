import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
