# Payment Threat Model

Scope: everything that moves member money in Ajosave: NGN card/bank deposits through Paystack, the
conversion to USDC, contributions locked in the Ajo Soroban contract, and cycle payouts to members.
Method: STRIDE over the data flow below, plus replay/double-spend and reconciliation threats specific
to payments. Each threat lists its mitigation, the evidence (files that implement or document it) and a
status. Statuses are honest: **Partial** and **Open** entries are the backlog.

Related: [`ngn-to-usdc-flow.md`](ngn-to-usdc-flow.md), [`webhook-replay-protection.md`](webhook-replay-protection.md),
[`secure-cookies.md`](secure-cookies.md), [`external-contract-audit.md`](external-contract-audit.md),
[`transactional-outbox.md`](transactional-outbox.md).

## Assets

| Asset | Why it matters |
|---|---|
| Member funds (NGN in flight, USDC in the contract) | Direct financial loss |
| Contribution / payout ledger in PostgreSQL | Source of truth for who has paid and who is owed |
| Paystack secret key, Stellar server signing key, `NEXTAUTH_SECRET` | Forge webhooks, sign payouts, mint sessions |
| Member sessions (access JWT + refresh token) | Act as a member |
| Contract admin authority | Trigger payouts, pause, upgrade |

## Actors and trust boundaries

| Actor | Trust |
|---|---|
| Member (browser) | Untrusted input; authenticated by session |
| Circle admin / platform admin | Trusted role, but credentials can be stolen |
| Paystack | Trusted only via a valid HMAC signature on each webhook |
| Stellar network + USDC token contract | Trusted for settlement; token contract assumed correct |
| Internet attacker | Can call any public endpoint, replay traffic, flood |

## Data flow

1. Member calls `POST /api/v1/circles/[id]/contribute` (session, membership and amount checked); the API
   initialises a Paystack payment and stores a `pending` contribution with the Paystack reference.
2. Member pays on Paystack checkout.
3. Paystack calls `POST /api/v1/webhooks/paystack`; the API verifies the signature, timestamp and
   event ID, then confirms the contribution inside one DB transaction.
4. A worker locks the USDC equivalent on-chain in the circle contract.
5. Each cycle, an admin/cron triggers `payout`, which sends the pot to the cycle's recipient.

## Threats

Status: **Mitigated** (control in place and tested/documented), **Partial** (control exists with a known
gap), **Open** (no effective control yet).

| ID | STRIDE | Threat | Mitigation | Evidence | Status |
|---|---|---|---|---|---|
| PT-01 | Spoofing | Attacker posts a forged "payment succeeded" webhook | HMAC-SHA512 of the raw body compared with `timingSafeEqual` before any processing | `src/lib/webhook-replay.ts`, `src/app/api/v1/webhooks/paystack/route.ts` | Mitigated |
| PT-02 | Spoofing | Session takeover via stolen or replayed refresh token | HttpOnly + Secure + SameSite=Lax cookie, `no-store` on cookie responses, refresh token rotation, revocation on logout | `src/lib/cookies.ts`, `src/lib/refresh-tokens.ts`, `docs/secure-cookies.md` | Mitigated |
| PT-03 | Spoofing | OTP brute force to take over an account | OTP endpoints limited to 5 per 15 min per IP, fail-closed; account lockout | `src/lib/rate-limit-policies.ts`, `src/lib/lockout.ts`, `OTP_BRUTE_FORCE_PROTECTION.md` | Mitigated |
| PT-04 | Tampering | Non-member or other user contributes to / manipulates a circle | Session required, circle must be active, caller must be a member, body validated with zod, partial amounts bounded | `src/app/api/v1/circles/[id]/contribute/route.ts`, `src/lib/money.ts` | Mitigated |
| PT-05 | Tampering | Credited amount differs from what was actually paid | Credit comes from `metadata.payUsdc` set by our own initialisation and is capped at the contribution total. The webhook does not compare Paystack's `data.amount`/currency with the initialised amount, and `verifyPayment` is only used by the manual verify route | `src/app/api/v1/webhooks/paystack/route.ts`, `src/lib/paystack.ts` | Partial |
| PT-06 | Tampering | Rounding/precision errors corrupt balances | Amounts validated as `numeric(20,7)` decimals; webhook credits in integer stroops | `src/lib/money.ts`, `src/app/api/v1/webhooks/paystack/route.ts` | Mitigated |
| PT-07 | Tampering | Illegal status transition (e.g. `refunded` to `pending`) from a bug or duplicate event | DB CHECK constraint on contribution status. A transition validator exists but no runtime code calls it, and `failed` is written by the webhook but missing from the constraint | `src/lib/payment-state-machine.ts`, `migrations/1746000000000_add-refunded-contribution-status.ts` | Partial |
| PT-08 | Repudiation | Member or admin disputes a payment/payout and there is no trail | Audit service, correlation IDs on every request, full webhook payloads kept in `processed_webhooks` | `src/server/services/audit.service.ts`, `AUDIT_LOGGING_IMPLEMENTATION.md` | Mitigated |
| PT-09 | Info disclosure | Paystack / Stellar / auth secrets leak from code or CI | Secrets only from environment via server config; secret scanning in CI | `docs/secrets-security.md`, `.github/workflows/secrets-scan.yml` | Mitigated |
| PT-10 | Info disclosure | Session cookie stored by a shared cache or read by page script | `HttpOnly`, `Cache-Control: no-store` on Set-Cookie responses | `src/lib/cookies.ts`, `docs/secure-cookies.md` | Mitigated |
| PT-11 | Denial of service | Flooding of payment or webhook endpoints | Payments: 10/min per user, fail-closed. Webhooks: 300/min per IP, but fail-open if the limiter backend is down | `src/lib/rate-limit-policies.ts` | Partial |
| PT-12 | Denial of service | Paystack, Stellar or SMS outage cascades through the app | Circuit breaker per provider; transactional outbox with retry and dead-letter | `src/lib/circuit-breaker.ts`, `docs/transactional-outbox.md` | Mitigated |
| PT-13 | Elevation | Non-admin triggers or retries payouts | Admin routes wrapped in `withAdminAuth` (role check, consistent 401/403) | `src/server/middleware/authorization.ts`, `src/app/api/admin/payouts/[id]/retry/route.ts` | Mitigated |
| PT-14 | Elevation | Contract admin key stolen; malicious upgrade or forced payouts | Two-step upgrade with 48h timelock and `cancel_upgrade`, emergency `pause`, optional multisig admin. A single admin key remains a single point of failure unless multisig is deployed | `contracts/ajo/UPGRADE.md`, `docs/multisig-admin.md` | Partial |
| PT-15 | Replay | Replayed or duplicated webhook credits a contribution twice | Signature, 5 minute timestamp window, unique event ID, `processed_webhooks` insert in the same transaction as the credit | `docs/webhook-replay-protection.md`, `src/lib/webhook-replay.ts` | Mitigated |
| PT-16 | Double spend | Concurrent or repeated payout for the same cycle | `unique_payout_per_cycle` DB constraint is the real guard; the in-process lock does not protect multi-instance deployments (per its own comment) | `migrations/1745600000000_payouts-unique-cycle.ts`, `src/server/services/payout.service.ts`, `src/server/services/payout-lock.ts` | Partial |
| PT-17 | Double spend | Double click or client retry creates duplicate contribution payments | A lookup of the existing contribution for member + cycle returns the existing payment. The `withIdempotency` middleware exists but is not applied to the contribute route | `src/app/api/v1/circles/[id]/contribute/route.ts`, `src/server/middleware/index.ts` | Partial |
| PT-18 | Repudiation / integrity | Paystack, database and chain drift apart (paid but not credited, credited but not locked on-chain) undetected | A pure payment reconciliation module exists but is not scheduled or called; only KYC reconciliation runs as a cron | `src/lib/reconciliation.ts`, `src/app/api/v1/cron/kyc-reconcile/route.ts` | Open |
| PT-19 | Tampering | Stale or manipulated FX rate mis-prices contributions | Rate cached 5 minutes, last-known DB rate as fallback, rate locked per payment reference. Final fallback is a hardcoded NGN rate that can be far from market during a long feed outage | `docs/ngn-to-usdc-flow.md`, `src/lib/fx.ts` | Partial |
| PT-20 | Tampering | Contract bug locks or misroutes funds (reentrancy, bad payout) | Payout lock and checks-effects-interactions, pause/unpause, fund-locking checklist with tests, nightly fuzzing; external audit pending | `contracts/ajo/FUND_LOCKING_CHECKLIST.md`, `docs/external-contract-audit.md` | Partial |
| PT-21 | Elevation | Stellar server signing key compromised and used to sign payouts | Key only from environment, rotation procedure and reminder workflow. A single hot key signs payouts | `docs/SECRET_ROTATION.md`, `.github/workflows/secret-rotation-reminder.yml` | Partial |

## Residual risk backlog (Partial / Open)

Priority order, highest first:

1. **PT-18** Schedule payment reconciliation (Paystack vs `contributions`/`payouts` vs on-chain) and alert on
   any discrepancy. The classification logic already exists in `src/lib/reconciliation.ts`.
2. **PT-05** In the `charge.success` handler, compare `data.amount` and `data.currency` with the amount
   initialised for that reference, or call `verifyPayment`, before crediting.
3. **PT-16** Replace the in-process payout lock with a distributed lock, or document that a single instance
   runs payouts, and keep the DB constraint as the guard.
4. **PT-17** Apply `withIdempotency` to the contribute route.
5. **PT-07** Wire `payment-state-machine.ts` into the webhook and admin payout paths and add `failed` to
   the DB CHECK constraint.
6. **PT-14 / PT-21** Require multisig for the contract admin and move payout signing to a managed key/HSM.
7. **PT-11** Decide whether webhook rate limiting should fail closed; Paystack retries make fail-closed safe.
8. **PT-19** Alert when the FX hardcoded fallback is used; refuse contributions instead of using it beyond a
   maximum age.
9. **PT-20** Complete the external audit and close all Critical/High findings.

## Maintenance

Review this model when the payment flow, a provider, or the contract changes, and at least quarterly.
`src/__tests__/payment-threat-model.test.ts` fails CI if a threat row is malformed, an ID is duplicated,
a status is invalid, or a cited evidence file no longer exists, so removing a control without updating
this document is caught.

## SLO / Latency Budgets

Critical-path operations have agreed p99 latency targets enforced in CI via
`src/lib/__tests__/performance-budgets.test.ts` and the `performance-budgets` workflow.

| Operation | SLO p99 |
|---|---|
| Paystack payment initialisation | 3 000 ms |
| Paystack payment verification | 3 000 ms |
| Stellar USDC transaction submit | 5 000 ms |
| SMS / OTP send (Termii) | 2 000 ms |
| Payout cron cycle end-to-end | 10 000 ms |
| OTP verification (server-side) | 500 ms |

These SLOs are informed by the circuit-breaker timeout defaults in `src/lib/circuit-breaker.ts`
(`paystackBreaker`: 30 s reset, `stellarBreaker`: 60 s reset, `smsBreaker`: 30 s reset) and the
k6 load-test thresholds in `k6/payout-load-test.js` (p95 < 5 000 ms).

Provider availability below these SLOs triggers the circuit breaker, which fast-fails subsequent
calls for the configured reset window rather than letting slow provider responses cascade into
user-facing timeouts.
