# Obsolete: Keycloak Setup

This document is intentionally obsolete.

HospitalityFinance Pro no longer uses Keycloak or NextAuth for runtime authentication. The active authentication path is native HFP auth:

- API-issued JWT access tokens
- Redis-backed refresh tokens and session records
- httpOnly cookies for browser clients
- optional Bearer token usage for API clients

Use `docs/ENV-VARIABLES.md`, `docs/PRODUCTION-CHECKLIST.md`, and `docs/GO-LIVE-RUNBOOK.md` for current deployment guidance.
