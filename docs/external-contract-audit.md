# External Contract Audit

The Ajo contract custodies member funds (`join`/`contribute` move USDC into the contract, `payout`
moves the pot out). Before mainnet use, and again after any material change, the contracts must be
reviewed by an independent auditor. This document defines the scope, what we hand the auditor, how
findings are triaged and closed, and which CI checks keep the repository audit-ready.

Status of the audit itself is tracked in [`docs/audits/README.md`](audits/README.md).

## Scope

| In scope | Path | Notes |
|---|---|---|
| Ajo circle contract | `contracts/ajo` | Custody, payouts, admin/upgrade, pause, missed-contribution policy. `soroban-sdk` 21. |
| Certificate contract | `contracts/certificate` | Admin-minted, non-transferable completion certificates. `soroban-sdk` 20. |

Out of scope: the Next.js/API layer (covered by `docs/payment-threat-model.md`, CodeQL and dependency
scans), the underlying USDC token contract, and Paystack.

Every crate listed in `contracts/Cargo.toml` `members` must appear in the table above;
`src/__tests__/contract-audit-scope.test.ts` fails CI otherwise, so a new contract cannot ship
outside the audit scope unnoticed.

**Known item for the auditor:** the two contracts pin different `soroban-sdk` major versions (21 vs 20).
Decide with the auditor whether to align them before the audited commit is frozen.

## Focus areas

These come from the contract's own trust model (`contracts/ajo/README.md`, "Security Model") and
review checklist (`contracts/ajo/FUND_LOCKING_CHECKLIST.md`):

1. **Fund custody**: no path leaves funds stuck or double-paid; payout drains the pot exactly; the payout
   lock (`PayoutLock`) is released on every non-panicking path and covers the whole external-call window.
2. **Authorization**: `payout`, `pause`/`unpause`, `set_*`, `reinstate_member`, `propose_admin`, `migrate` and the
   upgrade functions are admin-only; `accept_admin` requires the proposed admin's signature;
   `join`/`contribute` require the member's signature.
   Confirm the test-only `set_payout_lock` helper is `#[cfg(test)]` and absent from release WASM.
3. **Upgrade governance**: `propose_upgrade` → 48h timelock (`UPGRADE_TIMELOCK_SECS`) → `upgrade`, hash
   must match the proposal, `cancel_upgrade`. See `contracts/ajo/UPGRADE.md`; also review `migrate` and
   `STORAGE_VERSION` handling.
4. **Token trust**: the contract calls `token::Client::transfer` on an admin-supplied token; review the
   validation done in `initialize`.
5. **Arithmetic and boundaries**: `overflow-checks = true` in release; member cap (20), cycle interval bounds,
   contribution amount validation, cycle/payout-order indexing.
6. **State/TTL**: instance/persistent TTL bumps and `set_ttl_config`; expiry of storage must not lose
   membership or balances mid-circle.
7. **Missed-contribution policy**: suspension/reinstatement cannot be abused to skip a payout or lock a member.
8. **Certificate contract**: only the admin can `mint`; minting is idempotent; certificates cannot be
   transferred or overwritten.

## Audit package (what we hand over)

- Commit SHA to be audited (frozen; recorded in `docs/audits/README.md`).
- `contracts/` workspace with `Cargo.lock` and `rust-toolchain.toml` (Rust 1.81.0), reproducible WASM
  from `contract-wasm-release.yml`.
- Docs: `contracts/ajo/README.md`, `EVENTS.md`, `UPGRADE.md`, `FUND_LOCKING_CHECKLIST.md`, `BENCHMARKS.md`,
  `docs/contract-fuzzing.md`, `docs/multisig-admin.md`, `docs/payment-threat-model.md`.
- Test evidence: `cargo test` results, coverage of the checklist items, and the latest nightly fuzz run
  (`contract-fuzz.yml`).
- Known issues and accepted risks list.

## Entry criteria (before engaging an auditor)

- [ ] `cargo test --workspace` passes on the frozen commit.
- [ ] `cargo audit` reports no vulnerabilities (CI: `contract-audit-readiness.yml`).
- [ ] Every item in `FUND_LOCKING_CHECKLIST.md` is checked or has a named open question.
- [ ] Nightly fuzzing has run clean for the frozen commit.
- [ ] No open `security` issues against `contracts/` that are not listed as known issues.

## Findings handling

Record every finding in `docs/audits/README.md` using `docs/audits/FINDING_TEMPLATE.md`.

| Severity | Examples | Required response |
|---|---|---|
| Critical | Loss/lock of member funds, unauthorized payout or upgrade | Fix before any mainnet deployment; auditor re-verifies |
| High | Bypass of a documented guard, permanent DoS of a circle | Fix before mainnet; auditor re-verifies |
| Medium | Recoverable DoS, missing validation with limited impact | Fix, or accept with written owner sign-off and mitigation |
| Low / Info | Hardening, gas, style | Fix opportunistically; document if declined |

Every fixed finding needs a regression test (or fuzz target) referenced from the finding entry.
Findings are closed only when the fix commit is linked and the auditor (or a second internal reviewer,
for Low/Info) confirms.

## Re-audit triggers

A change under `contracts/*/src` other than tests/benchmarks/fuzz code requires either a re-audit of the
delta or an explicit recorded decision. CI enforces the paper trail: `contract-audit-readiness.yml` fails a
PR that changes contract source without also touching `docs/external-contract-audit.md` or `docs/audits/`.
Use that update to record what changed since the audited commit and whether re-audit is required.

## CI checks

| Check | Where | What it prevents |
|---|---|---|
| `cargo audit` | `.github/workflows/contract-audit-readiness.yml` | Shipping contracts with known-vulnerable dependencies |
| Audit-trail check | same workflow | Contract source changes with no audit-status update |
| Scope test | `src/__tests__/contract-audit-scope.test.ts` | A contract crate missing from the audit scope |
| Nightly fuzzing | `.github/workflows/contract-fuzz.yml` | Regressions in boundary handling |
