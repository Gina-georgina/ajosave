# Ajo Contract — Mainnet Deployment Checklist

The Ajo contract is a custodian: once deployed and initialized, it holds member
funds in its own token balance until `payout` distributes them. This checklist
is the sign-off artifact for promoting a WASM build to Stellar mainnet. Work
through it top to bottom and check off every box before moving to the next
section.

Detailed command sequences live in [`MAINNET_RUNBOOK.md`](../../MAINNET_RUNBOOK.md)
(step-by-step deployment) and [`UPGRADE.md`](UPGRADE.md) (upgrade governance).
Where the two documents disagree with this checklist, the contract source in
`src/lib.rs` is the authority.

---

## 1. Build and verify the WASM

- [ ] Build from a clean checkout with the pinned toolchain (`rust-toolchain.toml`):

  ```bash
  cargo clean --manifest-path contracts/ajo/Cargo.toml
  npm run contract:build
  # Artifact: contracts/target/wasm32-unknown-unknown/release/stellar_ajo.wasm
  ```

- [ ] Unit and integration tests pass for the release: `npm run contract:test`
- [ ] Record the artifact's SHA-256 and store it with the release:

  ```bash
  sha256sum contracts/target/wasm32-unknown-unknown/release/stellar_ajo.wasm
  # macOS: shasum -a 256 contracts/target/wasm32-unknown-unknown/release/stellar_ajo.wasm
  ```

- [ ] A second build from a clean tree produces the same hash (reproducible
      build — this is the hash you will compare against on-chain)
- [ ] The WASM contains no test-only entry points (e.g. `set_payout_lock`) —
      confirm against `src/lib.rs` and `cargo tree` for dev-dependencies

## 2. Verify the hash on-chain after upload

- [ ] Upload the blob (stores bytecode without deploying an instance):

  ```bash
  stellar contract upload \
    --network mainnet \
    --rpc-url "$STELLAR_RPC_URL" \
    --source <DEPLOYER_SECRET_KEY> \
    --wasm contracts/target/wasm32-unknown-unknown/release/stellar_ajo.wasm
  # Prints: <WASM_HASH>
  ```

- [ ] `<WASM_HASH>` printed by the network **equals the local SHA-256 recorded
      in step 1** — this proves the deployed bytecode is the reviewed source
- [ ] `<WASM_HASH>` recorded in the release notes / post-deployment record; it
      is also the value used for the rollback procedure (section 8)

## 3. Admin key ceremony (HSM or multisig)

The contract stores a **single `admin: Address`**. There is no on-contract
multisig list — M-of-N multisig is provided at the Stellar account layer by
making the admin address itself a multisig account. Pick exactly one option
and document the choice in the post-deployment record.

- [ ] **Option A — HSM / hardware custody:** the admin key is generated and
      held on an HSM or hardware wallet. The plaintext secret never touches
      CI, shell history, or the repository; signing happens through the HSM
      provider or `stellar` CLI signer integration.
- [ ] **Option B — Multisig account:** the admin address is a Stellar
      multisig account with an **M-of-N threshold of at least 2-of-3**.
      - [ ] Each signer's key material is on separate hardware (HSM or
            hardware wallet); signers are in distinct locations
      - [ ] Co-signing has been rehearsed on **testnet** with the same
            threshold, including the `initialize` call, which requires
            every configured signer to co-sign one transaction
- [ ] The admin address is distinct from the deployer account and from any
      member addresses (reduces blast radius of a member device compromise)
- [ ] Recovery path documented: admin rotation is two-step —
      `propose_admin(new_admin)` followed by `accept_admin()` from the new
      address. Record who holds recovery credentials for both steps.
- [ ] No admin or deployer secret key is stored in the repository, CI
      variables in plaintext, or chat logs; only the public address is
      recorded in docs

## 4. Initial parameter review

`initialize` runs exactly once (subsequent calls panic with
`"already initialized"`), so the values must be correct before signing.

| Parameter | Value to confirm | Reviewer sign-off |
|-----------|------------------|-------------------|
| `admin` | Address from section 3 (HSM key or multisig account) | [ ] |
| `token` | **Mainnet USDC token contract address** (an `C…` contract address, not the issuer `G…` account) | [ ] |
| `contribution_amount` | Per-member per-cycle amount in stroops (1 USDC = 10⁷ stroops), `> 0` | [ ] |
| `max_members` | `2–20`; also equals the number of cycles | [ ] |
| `cycle_interval_secs` | Seconds between payouts (e.g. `2592000` = 30 days) | [ ] |

- [ ] A second reviewer independently confirmed every value above (units and
      decimal placement for `contribution_amount` especially)
- [ ] The exact `initialize` command with the final values is recorded in the
      release notes:

  ```bash
  stellar contract invoke \
    --network mainnet \
    --rpc-url "$STELLAR_RPC_URL" \
    --source <SIGNER_SECRET_KEY> \
    --id "$STELLAR_AJO_CONTRACT_ID" \
    -- initialize \
    --admin <ADMIN_ADDRESS> \
    --token <USDC_TOKEN_CONTRACT> \
    --contribution_amount <STROOPS> \
    --max_members <N> \
    --cycle_interval_secs <SECONDS>
  ```

## 5. Deploy to testnet with the exact artifact

- [ ] Deploy **the same WASM binary** (same hash as section 1) to testnet:

  ```bash
  stellar contract deploy \
    --network testnet \
    --source <DEPLOYER_SECRET_KEY> \
    --wasm contracts/target/wasm32-unknown-unknown/release/stellar_ajo.wasm
  ```

- [ ] Initialize on testnet with the same parameter values planned for mainnet
- [ ] Smoke tests pass on testnet:
  - [ ] `get_state` returns a sane tuple (see section 6 for the expected shape)
  - [ ] `get_members` returns an empty vector
  - [ ] `get_token` returns the testnet token used for rehearsal
  - [ ] A full member cycle works: `join` → `contribute` → `payout`
  - [ ] `npm run contract:verify` exits 0 against the testnet contract
- [ ] Testnet contract ID and WASM hash recorded in the release notes

## 6. Deploy to mainnet

- [ ] Deployer account funded with XLM for deployment and fee headroom
- [ ] RPC endpoint and network passphrase confirmed for the public network
      (`Public Global Stellar Network ; September 2015`)
- [ ] Instance deployed from the verified hash (not the local file path, so
      the chain cannot receive different bytes):

  ```bash
  stellar contract deploy \
    --network mainnet \
    --rpc-url "$STELLAR_RPC_URL" \
    --source <DEPLOYER_SECRET_KEY> \
    --wasm-hash <WASM_HASH>   # from section 2
  ```

- [ ] Output `<CONTRACT_ID>` recorded immediately
- [ ] `initialize` executed per the section 4 command (all signers co-signed
      if the admin is a multisig account)
- [ ] Post-deployment record table filled in and committed — see the
      "Post-deployment Record" section of
      [`MAINNET_RUNBOOK.md`](../../MAINNET_RUNBOOK.md)

## 7. Post-deployment verification (on-chain)

- [ ] `get_state` returns the fresh-initial values — a 5-tuple
      `(current_cycle, max_members, next_payout_time, completed, paused)`:

  ```bash
  stellar contract invoke \
    --network mainnet \
    --rpc-url "$STELLAR_RPC_URL" \
    --source <ANY_SIGNER_SECRET_KEY> \
    --id "$STELLAR_AJO_CONTRACT_ID" \
    -- get_state
  # Expected for a new instance: (0, <max_members>, 0, false, false)
  ```

- [ ] `get_members` returns an empty vector (no members before launch)
- [ ] `get_token` returns exactly the USDC token contract from section 4
- [ ] `get_missed_policy` returns the intended default (`1`) or the reviewed
      value
- [ ] `get_payout_order` returns an empty vector
- [ ] Contract page loads on the explorer and shows the expected WASM hash:
      `https://stellar.expert/explorer/mainnet/contract/<CONTRACT_ID>`
- [ ] `npm run contract:verify` exits 0 with `STELLAR_NETWORK=mainnet`

## 8. Contract ID in environment variables

- [ ] `STELLAR_AJO_CONTRACT_ID` set in every environment that runs the
      application (`.env.production`, deployment platform secrets, CI
      secrets):

  ```
  STELLAR_NETWORK=mainnet
  STELLAR_SOROBAN_RPC_URL=<mainnet RPC endpoint>
  STELLAR_HORIZON_URL=https://horizon.stellar.org
  STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
  STELLAR_AJO_CONTRACT_ID=<CONTRACT_ID>
  STELLAR_CERTIFICATE_CONTRACT_ID=<CONTRACT_ID>   # if the certificate contract is deployed
  ```

- [ ] The `.contract-id` fallback file (read by `scripts/verify-contract.ts`
      when the env var is absent) updated or removed so it cannot shadow the
      new ID
- [ ] Secrets (`STELLAR_SERVER_SECRET_KEY`, signer keys) present in the
      secret manager only — never committed
- [ ] Application README contract table updated with the new contract ID and
      explorer link
- [ ] A read-only backend call against mainnet succeeds end to end (e.g. the
      contract event indexer logs a poll without auth errors)

## 9. Rollback procedure (upgrade to the previous WASM)

Soroban upgrades are not automatically reversible, but the contract's
two-step, timelocked upgrade flow supports rolling back to the previous
WASM. The previous WASM hash must exist **before** you need it.

- [ ] The **previous** `<WASM_HASH>` (from section 2 of the prior release)
      is recorded in the release notes — if no previous release exists, note
      "genesis — no rollback target" explicitly
- [ ] Rollback executes through the same governance path as any upgrade
      (details in [`UPGRADE.md`](UPGRADE.md)):

  ```bash
  # 1. Propose rolling back to the previous WASM (starts a 48h timelock)
  stellar contract invoke \
    --network mainnet --rpc-url "$STELLAR_RPC_URL" \
    --source <ADMIN_SIGNER> --id "$STELLAR_AJO_CONTRACT_ID" \
    -- propose_upgrade --new_wasm_hash <PREVIOUS_WASM_HASH>

  # 2. After the 48-hour timelock (UPGRADE_TIMELOCK_SECS = 172800) elapses:
  stellar contract invoke \
    --network mainnet --rpc-url "$STELLAR_RPC_URL" \
    --source <ADMIN_SIGNER> --id "$STELLAR_AJO_CONTRACT_ID" \
    -- upgrade --new_wasm_hash <PREVIOUS_WASM_HASH>   # must match the proposal
  ```

- [ ] If the release that triggered the rollback included a storage migration,
      a reverse `migrate` path for the new storage keys is identified and
      planned **before** executing the rollback (state layout changes are not
      undone by rolling back the WASM alone)
- [ ] Members are notified during the timelock window — the
      `upgrade_proposed` event is visible to any indexer monitoring the
      contract
- [ ] `cancel_upgrade` is understood as the abort path if the rollback itself
      turns out to be wrong while the proposal is pending
- [ ] Post-rollback `get_state` matches expectations: members, cycles, and
      balances are preserved across upgrades (upgrades replace code only)

---

## Sign-off

| Role | Name / address | Date |
|------|----------------|------|
| Build verified (sections 1–2) | | |
| Key ceremony completed (section 3) | | |
| Parameters reviewed (section 4) | | |
| Testnet rehearsal passed (section 5) | | |
| Mainnet deployment executed (sections 6–8) | | |
| Rollback plan confirmed (section 9) | | |
