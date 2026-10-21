# Coverage Ownership

Every part of Ajosave that handles money, identity or sessions has a named owner and its own
coverage gate, so a regression in a critical area cannot be hidden by gains elsewhere.

## How it fits together

| Piece | File | Role |
|---|---|---|
| Who reviews | `.github/CODEOWNERS` | Requests review from the owner of every touched path. |
| Who is accountable for coverage | `codecov.yml` → `component_management` | One Codecov component (and project status) per area. |
| Global floor | `jest.config.js` → `coverageThreshold` | 70% lines/functions/branches/statements, enforced in `ci.yml` via `npm test -- --coverage`. |
| Guard against drift | `src/__tests__/coverage-ownership.test.ts` | Fails CI if a component path is missing on disk or has no specific CODEOWNERS rule. |

## Components

| Component (`component_id`) | Covers | Why it is critical |
|---|---|---|
| `auth-sessions` | `auth`, `tokens`, `refresh-tokens`, `sessions`, `cookies`, `lockout`, middleware, auth API routes | Identity and session takeover |
| `payments` | Paystack, payment state machine, reconciliation, money math, webhook replay protection, outbox, payout/contribution routes | Money movement |
| `circles` | Circle lifecycle, reputation, circle API routes | Contribution/payout rules |
| `stellar` | `stellar.ts`, `soroban.ts` | On-chain transactions |
| `server-platform` | `src/server`, rate limits, Redis, DB, cron routes | Platform guarantees |
| `ui` | `src/components`, `src/hooks` | User-facing behaviour |

The Rust contracts in `contracts/` are not measured by Jest/Codecov. They are owned through
CODEOWNERS and tested by `cargo test` plus the fuzzing described in `docs/contract-fuzzing.md`.
Their audit scope is in `docs/external-contract-audit.md`.

## Rules

- A component's project status is `target: auto` with a 2% threshold: coverage may not fall more than
  2 points below the base branch for that component. Patch coverage stays at 70% (5% threshold).
- Changes to `codecov.yml`, `jest.config.js` or `.github/CODEOWNERS` are themselves owner-reviewed.
- Do not lower a threshold to make a PR pass; add the missing tests or ask the owner for an exception
  in the PR description.

## Changing ownership

1. Add or edit the rule in `.github/CODEOWNERS` (owners must be `@user` or `@org/team`).
2. Add or edit the matching `paths` entry in the component in `codecov.yml`.
3. Run `npm test -- src/__tests__/coverage-ownership.test.ts`.

Currently every area is owned by the repository owner (`@joekeyz8`); replace with per-area teams as
maintainers are added. Enable "Require review from Code Owners" in branch protection
(`docs/branch-protection.md`) for the rules to be blocking rather than advisory.
