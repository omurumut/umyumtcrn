# Replit Production Deployment

Replit Autoscale deployment has one authoritative runtime command:

```bash
pnpm run start:prod
```

This command only starts prebuilt production artifacts. It does not install packages, build, import MGM data, seed demo data, or start Vite.

## Build and runtime contract

The `.replit` deployment configuration performs these phases separately:

1. `pnpm install --frozen-lockfile`
2. `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright pnpm run install:browser`
3. `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright pnpm run verify:browser`
4. `pnpm run build`
5. `NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright pnpm run start:prod`

The API runs migrations before opening the listener. A migration failure prevents readiness. The same API process serves `/api/*` and the built dashboard from one `PORT`; production does not use the Vite development server.

## Required deployment environment

- `DATABASE_URL`: PostgreSQL connection URL, stored only as a Replit deployment secret.
- `PORT`: Public application port supplied by Replit. The checked-in port mapping uses `8080`.
- `NODE_ENV=production`: Set by the deployment run command.
- `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright`: Shared build/runtime browser cache location.

Optional PDF settings:

- `PDF_CHROMIUM_EXECUTABLE_PATH`: Explicit executable override. Leave unset to use the provisioned Playwright Chromium. Invalid or non-executable paths fail safely.
- `PDF_CHROMIUM_NO_SANDBOX=true`: Adds Chromium no-sandbox flags. It is disabled by default. Enable only when the deployment runtime demonstrably cannot launch the sandbox, because it weakens browser process isolation.

Required report archive storage settings:

- `REPORT_STORAGE_PROVIDER`: Must be set before production readiness is expected to pass. The checked-in local adapter is for development, tests, and disposable production-like smoke only.
- `REPORT_STORAGE_PROVIDER=s3`: Enables the S3-compatible object storage adapter for AWS S3, Cloudflare R2, or another private S3 API compatible service.
- `REPORT_STORAGE_BUCKET`: Required for `s3`. Keep the bucket private; the app does not set `public-read` ACLs or issue public/signed URLs.
- `REPORT_STORAGE_REGION`: Required for `s3`. For S3-compatible services that use a synthetic region, set the provider-documented value.
- `REPORT_STORAGE_ENDPOINT`: Optional custom S3-compatible endpoint. Leave unset for standard AWS S3 endpoint resolution.
- `REPORT_STORAGE_ACCESS_KEY_ID` and `REPORT_STORAGE_SECRET_ACCESS_KEY`: Optional explicit credential pair. If one is set, both must be set. If neither is set, the runtime AWS credential chain is used.
- `REPORT_STORAGE_SESSION_TOKEN`: Optional temporary credential token.
- `REPORT_STORAGE_FORCE_PATH_STYLE=true|false`: Strict boolean. Use only when the S3-compatible provider requires path-style addressing.
- `REPORT_STORAGE_PREFIX`: Optional server-controlled object key prefix. Leading/trailing slashes are normalized; `..`, backslashes, and control characters are rejected.
- `REPORT_STORAGE_REQUEST_TIMEOUT_MS`: Optional bounded request timeout, default `5000`.
- `REPORT_STORAGE_MAX_DOWNLOAD_BYTES`: Optional bounded max archive object size, default 50 MiB.
- `REPORT_STORAGE_LOCAL_ROOT`: Required only when `REPORT_STORAGE_PROVIDER=local`. Do not point this at an ephemeral production path for real customer archives.
- `REPORT_ARCHIVE_STORAGE_REQUIRED`: Defaults to required. Setting it to `false` makes readiness skip archive storage and should be limited to a documented temporary diagnostic window.
- `REPORT_STORAGE_LOCAL_PRODUCTION_ACK=disposable-test`: Allows the local adapter only for disposable production-like tests that also set `TEST_DB_DISPOSABLE=true`; it is not a real production storage approval.

Archive downloads are served through authenticated API endpoints. Responses never expose storage keys, bucket names, or local filesystem paths. The application verifies stored object size and SHA-256 checksum before completing archive metadata.

Optional S3 write smoke:

- `pnpm run test:report-storage-s3-smoke` is skipped by default.
- It writes to remote storage only when `REPORT_STORAGE_PROVIDER=s3`, `REPORT_STORAGE_S3_SMOKE_ENABLE=true`, and `REPORT_STORAGE_S3_SMOKE_ACK=test-bucket` are all set.
- Run it only against an explicitly approved non-production test bucket. The smoke uses a generated key, validates put/head/get/checksum/delete, and treats cleanup failure as failure.

## CORS and HTTP security policy

Production uses an exact CORS allowlist from `CORS_ALLOWED_ORIGINS`. The value is a comma-separated list of canonical `http://` or `https://` origins without paths, query strings, fragments, credentials, trailing slashes, or wildcards:

```text
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

The value is not a secret, but its entries are not logged. Duplicate entries are removed. Invalid entries make production startup fail. An unset or empty allowlist is a supported same-origin-only mode: requests without an `Origin` header and browser requests whose Origin host exactly matches the request Host continue to work, while other origins are rejected. Same-host HTTP/HTTPS schemes are both recognized so TLS termination does not require broad proxy trust. This preserves CLI, health, readiness, same-origin module assets, navigation, and server-to-server access without creating an open fallback.

Development accepts only `http://localhost:5000` and `http://127.0.0.1:5000`. These origins are never added to production automatically. Allowed browser requests may use `GET`, `POST`, `PATCH`, `PUT`, `DELETE`, and `OPTIONS`, with only `Authorization` and `Content-Type` request headers. `Content-Disposition` and `Retry-After` are exposed. Cookie credentials are disabled because authentication uses a Bearer token.

Production responses enforce:

- CSP with same-origin scripts/API connections, no `unsafe-eval`, no objects, and no framing. Runtime inline styles remain allowed because the React/Radix UI generates style attributes and style elements. Google Fonts is the only external style/font source.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` without `preload`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- A Permissions Policy denying camera, microphone, geolocation, payment, and USB.

HSTS is emitted only by the production application and is honored by browsers only over HTTPS. Replit terminates TLS at its reverse proxy, so deployment smoke testing must confirm the public HTTPS response retains this header. The application does not enable broad Express `trust proxy`: before relying on `req.ip` for externally observed client identity, verify Replit's forwarding chain in staging and configure only a documented trusted hop policy. Never enable unrestricted `trust proxy = true` merely to accept `X-Forwarded-For`.

Optional startup operations, all disabled by default:

- `ENABLE_MGM_BOOTSTRAP=true`: Import/seed MGM reference data after readiness.
- `ENABLE_MGM_SCHEDULER=true`: Request the in-process MGM scheduler.
- `MGM_SCHEDULER_INSTANCE_MODE=single`: Required together with the scheduler flag. It is an explicit declaration that this process is deployed as the only scheduler instance. Any other value refuses scheduler startup.
- `ENABLE_SUPERADMIN_BOOTSTRAP=true`: Enables the existing explicit superadmin bootstrap flow and requires its associated credential environment values.

Legacy/demo flags such as `ENABLE_DEMO_SEED`, `ENABLE_SEED`, and `ENABLE_BOOTSTRAP` must remain unset or `false` in production.

## Shared authentication state

Sessions and login rate-limit counters are stored in PostgreSQL, so all Autoscale instances observe the same authentication state. Only a SHA-256 hash of each bearer token is stored; the raw token is returned once at login and remains compatible with the existing frontend Bearer-token contract.

- `AUTH_SESSION_TTL_HOURS`: Session lifetime in hours. Default: `24`; accepted range: `1`-`720`.
- `LOGIN_RATE_LIMIT_WINDOW_MS`: Shared failed-login window. Default: `900000`.
- `LOGIN_RATE_LIMIT_IP_MAX`: Maximum failed attempts per hashed client-IP key in a window. Default: `20`.
- `LOGIN_RATE_LIMIT_USERNAME_MAX`: Maximum failed attempts per normalized, hashed username key in a window. Default: `8`.

Authentication and login fail closed with a safe `503` response if PostgreSQL is unavailable. Logout revokes the shared session, so the token is rejected by every instance. Successful login clears only the matching username limiter; it does not erase the shared IP limiter.

Expired/revoked sessions and stale rate-limit rows can be removed in bounded batches with:

```bash
ENABLE_AUTH_MAINTENANCE=true pnpm run auth:cleanup
```

The exact opt-in flag is required. Schedule this command externally; do not run cleanup in every Autoscale process.

Migration `0023_shared_auth_state` adds the shared authentication tables and indexes. Before deploying over an existing database, take the normal managed-database backup, verify the current migration history ends at `0022`, deploy the migration, and confirm readiness before increasing instance count. The migration does not convert in-memory sessions: users holding a pre-deployment process-local token must sign in again after rollout.

For Autoscale deployments, keep the in-process scheduler disabled. Use an external scheduled job, or run it only in a separately operated single-instance deployment. The `single` declaration is an operational guard, not distributed leader election.

## Liveness, readiness, and shutdown

- `GET /api/healthz` is process liveness. It returns `200 {"status":"ok"}` during normal operation and `503 {"status":"draining"}` after shutdown begins when the listener is still reachable.
- `GET /api/readyz` checks completed startup state plus bounded DB, schema, browser executable, report archive storage, and production frontend artifact readiness. It returns a safe summary with `status`, `service`, `timestamp`, `checks.*`, and elapsed time. It never returns `DATABASE_URL`, DB host/user, SQL, stack traces, tenant data, storage key, bucket name, or local executable/storage paths. Readiness failures return `503`.
- Migrations finish before the listener opens and before readiness becomes true.
- `SIGTERM` and `SIGINT` mark the process not ready, stop the scheduler, stop accepting new HTTP connections, wait for active requests, and close the PostgreSQL pool.
- Graceful shutdown is bounded to 15 seconds. A second signal or timeout forces a non-zero exit.
- The pool currently uses the `pg` defaults because no tuning values are configured. Capacity and timeout tuning remain a separate operational decision.

## Static serving and PDF guarantees

- `/api/*` is resolved before SPA fallback; unknown API routes return JSON `404`.
- `/`, `/login`, and client routes return the built SPA.
- Hashed `/assets/*` responses receive immutable caching; `index.html` receives `no-cache`.
- Dotfiles and path traversal are not served.
- PDF pages run with JavaScript disabled and non-data network/file requests blocked.
- Browser executable paths and internal stack information are not returned to clients.

## Deployment checklist

1. Configure `DATABASE_URL` and required application secrets.
2. Confirm frozen dependency installation succeeds.
3. Confirm Chromium provisioning succeeds.
4. Confirm browser launch/PDF verification succeeds.
5. Build production artifacts.
6. Confirm runtime migrations finish before readiness.
7. Start `pnpm run start:prod` with `NODE_ENV=production`.
8. Check `/api/healthz` and `/api/readyz`.
9. Run `pnpm run test:operational-readiness` only against a confirmed local/disposable or explicitly acknowledged staging clone DB.
10. Verify login.
11. Verify dashboard and SPA route refresh.
12. Generate a real PDF and check logs for errors.
13. Confirm the report archive list shows the generated report and the authenticated download succeeds.
14. Confirm MGM bootstrap/scheduler flags match the intended autoscale policy; do not enable the in-process scheduler on ordinary Autoscale instances.
15. Send `SIGTERM` in a controlled smoke environment and confirm the listener, database pool, scheduler timers, and browser children close.

## Development

Development remains separate and does not require browser provisioning:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ems-dashboard run dev
```

The dashboard continues to use Vite HMR only in development.
