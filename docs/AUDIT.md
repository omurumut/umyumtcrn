# Central Audit Trail

Faz 3B.3 adds an append-only `audit_events` table for critical operational and ISO 50001 traceability events.

## Scope

Audited areas include authentication success/failure/logout, user create/update/delete, consumption create/update/delete/import, SEU assessment create/update/delete/acceptance decisions, targets, action plans, target progress, VAP projects, demo seed/reset, superadmin bootstrap, and MGM sync/import triggers.

Audit is a traceability layer. Existing `createdByUserId`, `updatedByUserId`, and related actor fields remain part of the domain model.

## Request Correlation

Every API request gets an `X-Request-Id` response header. A client-supplied request ID is accepted only when it is 1-64 characters and contains `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, or `-`; otherwise the server generates a UUID.

## Redaction

Audit payloads are bounded and recursively sanitized. Keys matching password, hash, token, authorization, cookie, secret, API key, database URL, connection string, raw file content, stack, or SQL are redacted. Large strings, arrays, object depth, and total JSON size are capped.

Login failures store hashed username metadata only. Raw usernames, passwords, tokens, cookies, authorization headers, password hashes, and raw IP addresses must not be stored in audit events.

## Roles

`user` cannot access audit APIs.

`admin` and `kontrol_admin` can list and read only their own company audit events. Query `companyId` does not change their scope. Optional `unitId` must belong to their company.

`superadmin` must choose an explicit context: `companyId=<id>` for tenant audit or `scope=platform` for platform-level events. Missing or mixed context fails closed.

## Import And Batch

Batch imports write one bounded summary event instead of per-row events. Summaries include totals, inserted/updated counts where available, failed count, and a bounded error preview. Raw row data and uploaded file contents are not stored.

## Transaction Semantics

Critical mutations are designed to write the business mutation and audit event in the same database transaction where the route owns the transaction. Authentication failure events and some service-managed platform sync/import triggers are best-effort or post-service audit events; these are documented technical debt for future service-level transaction integration.

## Retention And Backup

No audit deletion API exists. Audit retention is a product and compliance policy decision. Backups and restore procedures must include `audit_events`. Long-term partitioning or archive storage can be evaluated after production retention requirements are set.

## Incident Investigation

Use `GET /api/audit-events` with company/platform context, action, entity type, entity ID, actor, outcome, and date filters. Use the returned `requestId` to correlate application logs with audit events.

## Limitations

The application DB role can technically update or delete rows with direct database access. API routes expose no audit create/update/delete mutation endpoint. Database-level immutability triggers or separate audit write roles are future hardening options.
