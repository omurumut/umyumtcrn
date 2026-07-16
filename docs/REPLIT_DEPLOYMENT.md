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

Optional startup operations, all disabled by default:

- `ENABLE_MGM_BOOTSTRAP=true`: Import/seed MGM reference data after readiness.
- `ENABLE_MGM_SCHEDULER=true`: Request the in-process MGM scheduler.
- `MGM_SCHEDULER_INSTANCE_MODE=single`: Required together with the scheduler flag. It is an explicit declaration that this process is deployed as the only scheduler instance. Any other value refuses scheduler startup.
- `ENABLE_SUPERADMIN_BOOTSTRAP=true`: Enables the existing explicit superadmin bootstrap flow and requires its associated credential environment values.

Legacy/demo flags such as `ENABLE_DEMO_SEED`, `ENABLE_SEED`, and `ENABLE_BOOTSTRAP` must remain unset or `false` in production.

For Autoscale deployments, keep the in-process scheduler disabled. Use an external scheduled job, or run it only in a separately operated single-instance deployment. The `single` declaration is an operational guard, not distributed leader election.

## Liveness, readiness, and shutdown

- `GET /api/healthz` is process liveness. It returns `200 {"status":"ok"}` during normal operation and `503 {"status":"draining"}` after shutdown begins when the listener is still reachable.
- `GET /api/readyz` checks completed startup state plus a bounded `SELECT 1` through the PostgreSQL pool. It returns `200 {"status":"ready"}` or the safe response `503 {"status":"not_ready"}`.
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
9. Verify login.
10. Verify dashboard and SPA route refresh.
11. Generate a real PDF and check logs for errors.
12. Confirm MGM bootstrap/scheduler flags match the intended autoscale policy; do not enable the in-process scheduler on ordinary Autoscale instances.
13. Send `SIGTERM` in a controlled smoke environment and confirm the listener, database pool, scheduler timers, and browser children close.

## Development

Development remains separate and does not require browser provisioning:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ems-dashboard run dev
```

The dashboard continues to use Vite HMR only in development.
