# Payout Randomization (Verifiable On-Chain Entropy)

## Overview

Payout order randomization uses the most recent closed Stellar ledger hash as a verifiable entropy source. The seed is fetched from Horizon at circle start time, stored in the database, and verified on-chain to prevent admin manipulation.

## How It Works

1. **Entropy Source**: When a randomized payout circle starts, the backend fetches the latest closed ledger hash from the Stellar Horizon API.
2. **Seed Storage**: The ledger hash is stored in `circles.randomization_seed` and `payout_method` is set to `randomized`.
3. **Deterministic Shuffle**: Members are shuffled using Fisher-Yates algorithm seeded by the ledger hash. Identical seeds produce identical payout orders.
4. **On-Chain Verification**: The ledger hash is included in the contract initialize call for verification. The contract stores and validates the seed.
5. **Immutability**: The admin cannot override randomization without on-chain evidence - the seed is sourced from verifiable blockchain entropy.

## Implementation

- **Service**: `src/server/services/payout-randomization.service.ts`
- **Migration**: `migrations/1745592000000_add-payout-randomization.ts`
- **Shuffle Algorithm**: Fisher-Yates with hash-based PRNG seeded from the ledger hash

## API

### Fetching Ledger Hash
```typescript
import { fetchLatestLedgerHash } from "@/server/services/payout-randomization.service";
const { ledgerHash, ledgerSequence } = await fetchLatestLedgerHash();
```

### Storing Seed
```typescript
import { storeRandomizationSeed } from "@/server/services/payout-randomization.service";
await storeRandomizationSeed(circleId, ledgerHash, ledgerSequence);
```

### Shuffling
```typescript
import { shufflePayoutOrder } from "@/server/services/payout-randomization.service";
const shuffledMembers = shufflePayoutOrder(members, ledgerHash);
```

### Verification
```typescript
import { verifyRandomizationSeed } from "@/server/services/payout-randomization.service";
const isValid = await verifyRandomizationSeed(circleId, providedSeed);
```

## Reproducibility

The shuffle algorithm is deterministic:
- Given the same seed (ledger hash), the same set of items will always produce the same shuffled order
- Tests validate that identical seeds produce identical orders
- The seed can be verified against the stored value in the database

## Security

- **Verifiable Entropy**: Ledger hashes are produced by the Stellar network consensus, not controllable by the admin
- **On-Chain Verification**: The seed is passed to the smart contract during initialization for verification
- **No Admin Override**: Without the actual ledger hash from Horizon at start time, randomization cannot be manipulated
- **Audit Trail**: The seed and ledger sequence are logged and stored for transparency
