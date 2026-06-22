import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "@workspace/db";
import { seedAdminUser } from "./routes/auth.js";
import { seedStationsIfEmpty, seedDegreeDataIfEmpty, startMgmDailyScheduler } from "./services/mgm-sync.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "drizzle");

logger.info("Running database migrations...");
runMigrations(migrationsFolder)
  .then(() => {
    logger.info("Migrations complete");
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      seedAdminUser();
      // MGM Gün Derece Havuzu: ilk çalışmada seed et, sonra günlük güncelle
      seedStationsIfEmpty()
        .then(() => seedDegreeDataIfEmpty())
        .then(() => startMgmDailyScheduler())
        .catch(err => logger.error({ err }, "MGM seed/scheduler hatası"));
    });
  })
  .catch((err) => {
    logger.error({ err }, "Migration failed");
    process.exit(1);
  });
