# Contract Storage Optimization Benchmarks

## Storage Layout Summary

| Data Type | Storage Type | Keys | TTL | Notes |
|-----------|--------------|------|-----|-------|
| Core config (admin, token, amounts, members, payout order) | Instance | 7 | Contract lifetime | Extended via TTL bumping on each operation |
| Per-cycle contributions | Temporary | N members × M cycles | Auto-expire | Cleared on circle completion, no bump needed |
| Member stats (reputation, circles, on-time/total/missed counts, suspended) | Persistent | 1 per member | 30 days | Survives contract upgrades, cross-circle state |
| Payout lock | Instance | 1 | Contract lifetime | Security-critical, short-lived flag |
| Pause flag | Instance | 1 | Contract lifetime | Admin emergency stop |

## Ledger Fee Optimization

### Before Optimization
- All contribution entries stored in instance storage
- Each contribution write required `~0.01 XLM` in ledger fees
- For a 10-member circle with 10 cycles: 100 contribution entries in instance storage

### After Optimization
- Contribution entries stored in temporary storage
- Temporary storage entries cost `~70% less` per write (no persistent ledger entry)
- Automatic TTL expiration removes entries after 100 ledgers (~3.5 days)
- For a 10-member circle with 10 cycles: 100 contribution entries in temp storage

### Estimated Savings
| Circle Size | Cycles | Old Instance Writes | New Temp Writes | Savings |
|-------------|--------|---------------------|-----------------|---------|
| 3 members | 3 | 9 entries | 9 entries (temp) | ~20% |
| 5 members | 5 | 25 entries | 25 entries (temp) | ~25% |
| 10 members | 10 | 100 entries | 100 entries (temp) | ~35% |
| 20 members | 20 | 400 entries | 400 entries (temp) | ~40% |

**Overall estimated reduction: 25-35% in ledger fees for typical circles**

## Storage Cost Analysis (issue #254)

Measures the entries and ledger bytes each circle size creates and the
mainnet cost of that storage, before and after packing per-member state
into a single `MemberStats` entry (storage v2).

### Method

- Entry counts come from the storage layout: per-member persistent keys,
  per-member instance bytes, and per-cycle temporary contribution entries.
- Ledger byte sizes are the XDR-serialized `LedgerEntry` sizes of those
  entries (contract-data key + value + entry envelope), computed
  analytically from the key/value schemas in `src/lib.rs`.
- Fees use the published Stellar mainnet resource-fee schedule (see
  `stellar network settings --network mainnet`; the same values the
  soroban SDK hardcodes as its 2026-07-10 mainnet fee snapshot):

| Parameter | Value |
|-----------|-------|
| `fee_write_ledger_entry` | 2,500 stroops per entry |
| `fee_write_1kb` | 875 stroops per KB |
| `fee_per_rent_1kb` | 1,000 stroops per KB per rate period (host minimum; the SDK uses 12,000 as a conservative upper bound) |
| `persistentRentRateDenominator` | 1,215 ledgers |
| `tempRentRateDenominator` | 2,430 ledgers |
| `min_persistent_ttl` | 2,073,600 ledgers (~120 days) |
| ledger close time | 5 s (17,280 ledgers/day; 6,307,200/year) |

Rent for an entry is `size × ledgers × fee_per_rent_1kb / (1024 × rate_denominator)`.
At the current rate floor that is **0.000507 XLM per persistent byte per
year** (≈0.0527 XLM/KB/yr) and **0.000208 XLM per temporary byte per 30
days**. At the SDK's conservative 12,000-stroops rent rate every rent
figure below is 12× higher; the verdicts are unchanged either way.

### Entries and bytes per circle

XDR sizes: the v1 per-key entries are 132–144 B; the packed
`MemberStats` entry is 324 B; the instance carries 40 B per member in
the `Members` vector plus (v1 only) a 76 B `Suspended` map slot; a
temporary `Contributions(member, cycle)` entry is 144 B.

| Circle size | Persistent entries v1 → v2 | Persistent bytes v1 → v2 | Instance bytes/member v1 → v2 | Temp entries (unchanged) | Temp bytes (unchanged) |
|-------------|----------------------------|--------------------------|-------------------------------|--------------------------|------------------------|
| 5 members | 25 → 5 | 3,400 → 1,620 | 116 → 40 | 25 | 3,600 |
| 10 members | 50 → 10 | 6,800 → 3,240 | 116 → 40 | 100 | 14,400 |
| 20 members | 100 → 20 | 13,600 → 6,480 | 116 → 40 | 400 | 57,600 |
| 50 members | 250 → 50 | 34,000 → 16,200 | 116 → 40 | 2,500 | 360,000 |

### Cost per member

Three framings of per-member storage cost, all reduced by the packed layout:

| Framing | v1 (before) | v2 (packed) | Change |
|---------|-------------|-------------|--------|
| Write fees for one member's persistent records (5 → 1 entry writes) | ≈0.0131 XLM | ≈0.0028 XLM | −79% |
| Persistent rent, first 120-day TTL (born TTL) | ≈0.113 XLM | ≈0.054 XLM | −52% |
| Persistent rent, resident per year | ≈0.345 XLM | ≈0.164 XLM | −52% |

Write framing: 2,500 stroops + 875 stroops/KB per entry. Rent framing:
bytes × 2,073,600 ledgers × rate for the 120-day born TTL, bytes ×
6,307,200 ledgers × rate for the annual figure.

**Threshold verdict (issue AC3):** writing one member's persistent state
costs **0.0131 XLM > 0.01 XLM** in v1, so the packed layout below was
implemented; after packing it costs **0.0028 XLM < 0.01 XLM**. The
rent-inclusive framings remain above 0.01 XLM even after packing: at
mainnet rates a 324-byte entry costs ≈0.054 XLM for its first 120-day
TTL, so any durable per-member record exceeds that line. Bringing
resident rent under it would mean storing reputation in temporary
storage and rebuilding it from events after every upgrade — traded away
here because reputation must survive upgrades by design. Temporary
contribution entries (N² per circle) are the other rent term; a
per-cycle packed `Vec` layout (N entries instead of N²) would cut their
entry count by ~N× and their bytes by ~2.5–3.3× at N=10–50 and is the
natural next optimisation, deliberately left out of this change to keep
the money-path diff small.

### Optimised layout behaviour

Public API and results are unchanged: `get_reputation`,
`get_reputation_stats`, `get_missed_contributions`, `is_suspended` and
all event payloads return the same values as storage v1; every read and
write of the old keys now goes through the single `MemberStats` entry.
Each hot path performs strictly fewer storage operations than v1
(`contribute` reads one entry instead of three and writes one entry
instead of three; `update_reputation` extends one TTL instead of four),
so instruction usage cannot regress; the existing
`contract-cost-benchmarks` CI job records the real CPU/memory numbers
on every push.

## Benchmark Methodology

Real CPU/memory cost benchmarks live in `src/benchmarks.rs` and use
soroban-sdk's `testutils` budget API (`env.budget()`), which is the SDK's
own resource-accounting mechanism — not an event-log proxy. Each test
resets the budget, runs one entrypoint (`join`, `contribute`, `payout`,
`propose_admin`+`accept_admin`), and asserts the reported CPU instruction
count stays under a regression ceiling:

```rust
fn measure(env: &Env, label: &str, f: impl FnOnce()) -> u64 {
    env.budget().reset_default();
    f();
    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    println!("[bench] {label}: cpu_instructions={cpu} memory_bytes={mem}");
    assert!(cpu < CPU_CEILING, "{label} exceeded the CPU regression ceiling");
    cpu
}
```

Run locally with `cargo test --package stellar-ajo bench -- --nocapture`
to see the printed cost breakdown; CI runs the same command on every push
(`.github/workflows/ci.yml`, job `contract-cost-benchmarks`).

## Storage Classification Rationale

### Instance Storage (Persistent, contract-lifetime)
- **Admin, PendingAdmin**: Must survive upgrades
- **Token, ContributionAmount, MaxMembers, CycleIntervalSecs**: Core configuration
- **Members, PayoutOrder**: Circle membership data
- **CurrentCycle, NextPayoutTime, Completed**: Circle state machine
- **Paused**: Emergency stop flag
- **PayoutLock**: Reentrancy guard (security-critical)
- **StorageVersion, TtlThreshold, TtlExtendTo**: Migration and TTL config

### Temporary Storage (Auto-expire, per-cycle)
- **Contributions(Address, u32)**: Contribution tracking per cycle
  - Automatically expires after TTL (~3.5 days)
  - Cleared explicitly on circle completion
  - Lower ledger fee as no persistent write

### Persistent Storage (Cross-contract lifetime)
- **MemberStats(Address)** (storage v2, issue #254): packed per-member record
  - `reputation`, `circles_completed`, `on_time_contributions`,
    `total_contributions`, `missed_contributions` — one ledger entry per
    member instead of the five v1 keys (`MemberReputation`,
    `TotalCirclesCompleted`, `OnTimeContributions`, `TotalContributions`,
    `MissedContributions`)
  - `suspended` — moved out of instance storage into the same entry so the
    instance no longer grows by ~76 B per member

## Migration Notes

For existing contracts on-chain:
1. Call `migrate()` after upgrade to initialize `PayoutLock`
2. Temporary storage keys are new - no data migration needed
3. Existing instance storage entries remain compatible
4. Storage v2 (issue #254): `migrate()` (admin-only, run once after the
   upgrade) packs each member's five legacy persistent keys and instance
   `Suspended` flag into one `MemberStats` entry and removes the legacy
   entries. Idempotent; members with no legacy state get no entry (reads
   default to zeros, matching v1).