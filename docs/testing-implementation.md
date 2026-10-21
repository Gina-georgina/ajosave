# Testing Implementation Guide

This document describes the testing areas introduced in issues #91, #93, #95, and #96.

---

## #91 — Accessibility CI

**Location:** `.github/workflows/accessibility-ci.yml`, `e2e/accessibility/a11y.spec.ts`

Playwright + axe-core scans run on every PR against key pages:

| Page | Ruleset |
|------|---------|
| Landing (`/`) | WCAG 2.1 AA |
| Auth/login | WCAG 2.1 AA |
| Circles browse | WCAG 2.1 AA |
| Dashboard | WCAG 2.1 AA |

**Thresholds:**
- `categories:accessibility` ≥ 90% (Lighthouse CI, enforced as error)
- Zero critical/serious axe violations (Playwright axe-core scans)

**Run locally:**
```bash
npx playwright test e2e/accessibility/ --project=accessibility
```

---

## #93 — Property-Based API Tests

**Location:** `src/__tests__/integration/property-based-api.test.ts`

Uses [fast-check](https://github.com/dubzzz/fast-check) to generate arbitrary inputs and verify API invariants:

| Invariant | Verification |
|-----------|-------------|
| Invalid inputs → 4xx, never 5xx | `POST /api/v1/circles` with random bad fields |
| Valid inputs → 201 | Arbitrary valid circle payloads |
| Auth-protected routes → 401 when unauthenticated | All protected POST endpoints |
| Response envelope always has `{success}` | Every `/api/v1/*` response |
| Negative amounts rejected | `contributionUsdc` < 0 → 400 |
| Oversized amounts rejected | `contributionUsdc` > 1,000,000 → 400 |
| Oversized payloads → 4xx | 70 KB payload → 4xx |
| Pagination never causes 5xx | Arbitrary `page`/`limit` values |

**Run locally:**
```bash
npm test -- --testPathPattern=property-based-api
```

---

## #95 — Migration Upgrade Tests

**Location:** `src/__tests__/integration/migration-upgrade.test.ts`

Verifies database migration file correctness:

- Every `.ts` file in `migrations/` exports both `up` and `down`
- All `up` functions take at least one parameter (the `MigrationBuilder`)
- Core tables exist after baseline schema (`users`, `circles`, `members`, etc.)
- Financial columns are `NOT NULL` (`amount_usdc`, `contribution_usdc`)
- Performance indexes exist for common query patterns
- Dispute, audit log, session, and refresh token tables have required columns
- Migration filenames follow the `<13-digit-timestamp>_<name>.ts` convention

The CI `migration-tests` job in `ci.yml` runs `node-pg-migrate up` against a fresh
Postgres instance then executes the tests.

**Run locally:**
```bash
npm test -- --testPathPattern=migration-upgrade
```

---

## #96 — Dispute E2E Journey

**Location:** `e2e/dispute.spec.ts`, `.github/workflows/dispute-e2e.yml`

Full dispute lifecycle covered:

| Scenario | Assertion |
|----------|-----------|
| Member opens dispute | Button visible, form renders |
| Form validation | Empty reason → accessible error, no API call |
| Successful submission | `201` response → confirmation message |
| Duplicate dispute (`409`) | Accessible error, no crash |
| API failure (`500`) | `role="alert"` error shown |
| Unauthenticated access | Redirect to login or block |
| Admin views open disputes | Disputes list rendered |
| Admin resolves dispute | Status updates to `resolved` |
| Admin rejects dispute | Status updates to `rejected` |
| Dispute timeline | Events chronologically displayed |
| Network timeout | Error surfaced, page remains usable |

All tests use Playwright route mocking — no real backend required.

**Run locally:**
```bash
npx playwright test e2e/dispute.spec.ts --project=chromium
```
