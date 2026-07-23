ALTER TABLE "report_archives"
  ADD COLUMN IF NOT EXISTS "retry_of_archive_id" integer;

ALTER TABLE "report_archives"
  DROP CONSTRAINT IF EXISTS "report_archives_retry_of_archive_id_fk";

ALTER TABLE "report_archives"
  ADD CONSTRAINT "report_archives_retry_of_archive_id_fk"
  FOREIGN KEY ("retry_of_archive_id") REFERENCES "report_archives"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "report_archives_retry_of_idx"
  ON "report_archives" ("retry_of_archive_id");

CREATE UNIQUE INDEX IF NOT EXISTS "report_archives_active_retry_child_unique"
  ON "report_archives" ("retry_of_archive_id")
  WHERE "retry_of_archive_id" IS NOT NULL AND "status" IN ('generating','completed');
