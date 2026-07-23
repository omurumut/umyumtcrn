# AI Production Pilot Runbook

## Production Data Gate

Real Gemini calls from persisted customer analysis require all of these controls:

- `AI_ENABLED=true`
- `AI_PROVIDER=gemini`
- `GEMINI_API_KEY` configured in the runtime secret store
- `GEMINI_MODEL` configured
- company AI policy `dataPolicy=production_allowed`
- `AI_PRODUCTION_DATA_ENABLED=true`

The last flag defaults to false. Keep it false for normal tests, demo-only runs, and pre-pilot verification.

## Secrets

Do not log API keys, database URLs, prompts, full context payloads, provider responses, or authorization headers. Diagnostics expose only booleans such as `secretConfigured` and `modelConfigured`.

Rotate a Gemini key by deploying a new runtime secret first, verifying synthetic smoke, then disabling the old key after the new deployment is confirmed. Billing alerts and API-key restrictions should be configured in Google Cloud or AI Studio.

## Gemini Billing Notes

The local pricing catalog is versioned as `gemini-pricing-2026-07-23` and estimates only explicitly listed text models. Unknown models return `estimatedCost=null` rather than guessing.

Current catalog entries:

- `gemini-2.5-flash`: input `$0.30`, cached input `$0.03`, output/thinking `$2.50` per 1M tokens.
- `gemini-2.5-flash-lite`: input `$0.10`, cached input `$0.01`, output/thinking `$0.40` per 1M tokens.

Refresh this catalog before changing `GEMINI_MODEL`; Gemini pricing and limits can change.

## Readiness And Diagnostics

- `/api/healthz`: liveness only.
- `/api/readyz`: readiness, DB/schema/browser/frontend/report-storage plus safe AI readiness summary.
- `/api/admin/ai/diagnostics`: superadmin-only operational view. It must not include prompt, context, result JSON, headers, database URLs, or secret values.

AI diagnostics should be checked before enabling pilot traffic:

- provider selected intentionally
- secret and model configured booleans are true for Gemini
- `productionDataEnabled` matches the pilot decision
- circuit breaker states are not unexpectedly open
- stale processing count is acceptable
- retention cleanup last run is known

## Circuit Breaker

Circuit state is stored in `ai_provider_circuit_state` by provider/model. This makes the breaker shared across multiple API instances. Half-open probes are leased so only one instance tests recovery at a time.

Operational response:

- `open`: keep fallback enabled and review provider status/rate limits.
- `half_open`: wait for the leased probe result.
- repeated failures: lower traffic, increase cooldown, or switch `AI_PROVIDER=mock` for a no-billing fallback.

## Retention Cleanup

AI retention uses `company_ai_settings.retention_days`. The cleanup CLI defaults to dry-run:

```powershell
pnpm.cmd run ai:retention-cleanup -- --company-id 1
```

Execution requires an explicit acknowledgement:

```powershell
pnpm.cmd run ai:retention-cleanup -- --company-id 1 --execute --ack EXECUTE_AI_RETENTION_CLEANUP_1
```

The cleanup skips processing analyses, analyses linked to approved/draft actions, and source analyses referenced by cache-hit records. Last run metadata is stored in `ai_operational_state` without prompt/context/result content.

## Outage And Rollback

- Disable real customer Gemini traffic: set `AI_PRODUCTION_DATA_ENABLED=false`.
- Disable AI analysis entirely: set `AI_ENABLED=false`.
- Avoid production Gemini spend while keeping UI flows testable: set `AI_PROVIDER=mock` only where `AI_ALLOW_MOCK_PROVIDER=true` is intentionally approved.
- Keep fallback enabled for pilot companies unless testing primary-provider failure behavior.

## Pre-Pilot Checklist

- Migrations applied through `0040_ai_production_readiness`.
- `/api/readyz` is ready and AI summary contains no secrets.
- Superadmin diagnostics are accessible only to superadmin users.
- `pnpm.cmd run test:ai-production-readiness` passes.
- `pnpm.cmd run test:ai-resilience` passes.
- `pnpm.cmd run test:ai-analysis-persistence` passes.
- `RUN_GEMINI_SMOKE=true pnpm.cmd run test:gemini-smoke` is run only with approved synthetic smoke data and an approved key.
