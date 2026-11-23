# Plans and entitlements

Roadmap Stage 1 item 8 (WP-2; findings HC-35, HC-37, HC-40). Registry migration `3_plans`.

## Model

- **Plans** (registry table `plans`): code, name, and the limits a tenant on the plan gets: properties, users, concurrent sessions, enabled modules, largest upload (MB), imports at once. Exactly one plan is the default (`is_default`). No plan values live in code.
- **Entitlement** (registry table `tenant_entitlements`, one per tenant): the tenant's plan, its subscription dates, and its own **exceptions**: a limit set here overrides the plan's for this tenant only. Null (or an empty module list) means "as the plan".
- **Platform settings** `UPLOAD_MAX_MB` and `IMPORT_CONCURRENCY` are the ceiling for those two limits: a plan or exception can lower them, never raise them, because they protect the server. A plan that leaves them empty means "the platform setting".

`apps/api/src/modules/tenant/entitlements.ts` is the only reader. It caches a tenant's effective limits for `ENTITLEMENT_CACHE_SECONDS` (default 60) per process. A tenant without an entitlement row gets the default plan (and a warning in the log); with no default plan, reading fails.

## Where the limits apply

| Limit                                | Applied by                                                                                                                                                                                                        | Since            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Largest upload                       | `modules/tenant/upload-limit.ts`: after authentication, every POST, PUT and PATCH with a body larger than the tenant's limit gets 413 `UPLOAD_TOO_LARGE`. The platform ceiling is applied while the body is read. | 23 November 2026 |
| Imports at once                      | `jobs/transfer-desk-runner.ts`: each tenant's import worker runs at the tenant's concurrency; a change reaches a running worker at the next reconcile.                                                            | 23 November 2026 |
| Properties, users, sessions, modules | Recorded only. **Nothing enforces them yet** (as before this change).                                                                                                                                             | —                |

## Seeded plans

The migration created `TRIAL`, `STANDARD` (the default) and `ENTERPRISE`, all with the values that applied until then (10 properties, 50 users, 10 sessions; GL, AP, AR and reporting; upload and imports from the platform settings), so no tenant's limits changed. Each existing entitlement got the plan of its old licence type; values equal to the plan's became "as the plan". Tenants without an entitlement (built before provisioning recorded one, such as `demo-hotels`) got the default plan. **The plans' real values are the owner's commercial decision** and are changed in the registry.

## Provisioning

The onboarding screen loads the active plans (`GET /api/v1/platform/plans`), starts from the default plan's limits and stores only what the administrator changed. The command line takes `--plan <code>` and optional `--max-users`, `--upload-max-mb` and so on.
