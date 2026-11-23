# Working on HospitalityFinance Pro

Read before any task, in this order:

1. [`docs/PRODUCT-ROADMAP.md`](docs/PRODUCT-ROADMAP.md): the order of work, the settled decisions (section 2) and the current stage. Work only on the current stage.
2. [`docs/REMEDIATION-BRIEF.md`](docs/REMEDIATION-BRIEF.md): findings, work packages and acceptance criteria.
3. The specification for the area you are changing (Stage 2 documents under `docs/`, once approved). Specifications are authoritative.

The owner's blueprint in `docs/foundation/input/` is input to Stage 2, not a specification; where it differs from the roadmap, the roadmap wins.

## Rules

These are roadmap section 5 and brief section 2, kept here so they are read first. If this file and those documents disagree, the documents win; report the difference.

**Before changing anything**

- Inspect before changing. Never assume a folder is empty. Never delete, overwrite or reset without the owner's approval.
- One AI tool per folder. If files changed that you did not change, report them before doing anything else.
- Where code and an approved document disagree, report the conflict before implementing.

**Stop and ask the owner** on accounting policy, tenant security, destructive operations, database changes to existing (non-test) databases, architecture changes and paid services. One stage at a time: stop at every gate and report; do not start the next stage without the owner's go-ahead.

**Shared server.** PostgreSQL on the development server also hosts live systems: no changes to `postgresql.conf`, no restart, only `hfp_`-prefixed databases and roles, no pooler installation without asking.

**Worktrees** live under `~/projects/hfp-worktrees/`, never under `/tmp`. Commit and push completed work promptly.

**Code**

- No hard-coded business values. A value belongs in source only if it is true for every tenant, every country and every source system forever; everything else follows the placement rule in brief section 2.
- One canonical path: no second way to post, no new way to import. Extend the canonical path and delete what it replaces.
- Fail closed: authorization, approval and validation errors stop the operation. Never catch and continue on a control check.
- Type the boundaries: no `as any`; request bodies validated with Zod; service inputs use the Prisma-generated types.
- Schema changes are migrations (no `prisma db push` outside local development). Never edit an applied migration; add a corrective one.
- No dead buttons, placeholder screens or fake functionality.

**Tests gate commits**

- Every fix to posting, imports, tenancy or security needs an integration test against PostgreSQL; a mocked unit test alone does not close a finding.
- Never chain a commit or push after a failing test run.
- Before a commit: `pnpm lint`, `pnpm typecheck`, unit tests, and the integration tests that cover the change. Locally, run integration test files one at a time; CI runs them in parallel. Report any `hfp_it_` databases or roles left behind.
- Run `prettier --write` on staged files before committing; the pre-commit hook rejects unformatted files.
- Never run `next build` in `apps/web` while its dev server is running.

**Commits and pull requests**

- Branch from `main`; one finding ID per commit; conventional commit messages that name the ID.
- Do not merge pull requests; the owner merges.

## Reporting

Report every task with: what was implemented, files changed, decisions taken, tests and results, typecheck and lint, known issues, risks, and the next step. Distinguish implemented, tested, verified in a browser, incomplete and blocked.

**Definition of done:** acceptance criteria met; tests green in CI with a real database; typecheck and lint pass; migrations reviewed and reversible or backed up; tenant isolation verified; no dead buttons or placeholder screens; documents updated.
