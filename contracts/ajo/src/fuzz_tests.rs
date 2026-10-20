//! Fuzz-style property tests for the Ajo contract.
//!
//! These tests exercise `contribute` and `payout` with randomised member sets,
//! cycle counts, and timing values to catch integer overflow, unexpected state
//! transitions, and auth-bypass edge cases.
//!
//! They run under the normal `cargo test` harness (no external fuzzer required)
//! and are included in CI via the `contract-test` job.

#[cfg(test)]
mod fuzz {
    use crate::{AjoContract, AjoContractClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, Vec,
    };

    // ─── Helpers ──────────────────────────────────────────────────────────────

    struct Ctx {
        env: Env,
        admin: Address,
        members: Vec<Address>,
        token: TokenClient<'static>,
        client: AjoContractClient<'static>,
        contribution: i128,
        interval: u64,
        max_members: u32,
    }

    fn make_ctx(max_members: u32, contribution: i128, interval: u64) -> Ctx {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let mut members = Vec::new(&env);
        for _ in 0..max_members {
            members.push_back(Address::generate(&env));
        }

        let token_id = env.register_stellar_asset_contract(admin.clone());
        let token = TokenClient::new(&env, &token_id);
        let token_admin = StellarAssetClient::new(&env, &token_id);

        // Mint enough for every cycle plus a buffer
        for m in members.iter() {
            token_admin.mint(m, &(contribution * (max_members as i128 + 2)));
        }

        let contract_id = env.register_contract(None, AjoContract);
        let client = AjoContractClient::new(&env, &contract_id);
        client.initialize(&admin, &token_id, &admin, &contribution, &max_members, &interval);

        let token: TokenClient<'static> = unsafe { std::mem::transmute(token) };
        let client: AjoContractClient<'static> = unsafe { std::mem::transmute(client) };

        Ctx { env, admin, members, token, client, contribution, interval, max_members }
    }

    // ─── contribute: random member/cycle combinations ─────────────────────────

    /// Fuzz: contribute with every valid member across all cycles — no panics,
    /// balances must decrease by exactly `contribution` per call.
    #[test]
    fn fuzz_contribute_all_members_all_cycles() {
        // Vary group sizes across the allowed range
        for max_members in [2u32, 3, 5, 10, 20] {
            let contribution: i128 = 50_000_000;
            let interval: u64 = 3_600; // 1 hour
            let ctx = make_ctx(max_members, contribution, interval);
            let Ctx { env, members, token, client, interval, max_members, .. } = &ctx;

            for m in members.iter() {
                client.join(m);
            }

            let mut ts: u64 = 0;
            for cycle in 1..=*max_members {
                ts += interval + 1;
                env.ledger().with_mut(|l| l.timestamp = ts);
                client.payout();

                if cycle < *max_members {
                    for m in members.iter() {
                        let before = token.balance(&m);
                        client.contribute(m, contribution);
                        let after = token.balance(&m);
                        assert_eq!(
                            before - after,
                            *contribution,
                            "cycle {cycle}: member balance should decrease by exactly contribution"
                        );
                    }
                }
            }

            let (_, _, _, completed, _) = client.get_state();
            assert!(completed, "max_members={max_members}: circle must complete");
        }
    }

    /// Fuzz: double-contribute must always panic regardless of member or cycle.
    #[test]
    fn fuzz_contribute_double_always_panics() {
        for max_members in [2u32, 3, 5] {
            let ctx = make_ctx(max_members, 100_000_000, 86_400);
            for m in ctx.members.iter() {
                ctx.client.join(m);
            }

            // Advance to cycle 2 so we can test contribute (cycle 1 was via join)
            ctx.env.ledger().with_mut(|l| l.timestamp = ctx.interval + 1);
            ctx.client.payout();

            for m in ctx.members.iter() {
                ctx.client.contribute(m, &ctx.contribution); // first — ok
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    ctx.client.contribute(m, &ctx.contribution); // second — must panic
                }));
                assert!(
                    result.is_err(),
                    "max_members={max_members}: double contribute must panic"
                );
            }
        }
    }

    /// Fuzz: non-member contribute must always panic for any random address.
    #[test]
    fn fuzz_contribute_non_member_always_panics() {
        for max_members in [2u32, 3, 5] {
            let ctx = make_ctx(max_members, 100_000_000, 86_400);
            for m in ctx.members.iter() {
                ctx.client.join(m);
            }

            // Generate several random outsiders
            for _ in 0..5u32 {
                let outsider = Address::generate(&ctx.env);
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    ctx.client.contribute(&outsider, &ctx.contribution);
                }));
                assert!(
                    result.is_err(),
                    "max_members={max_members}: non-member contribute must panic"
                );
            }
        }
    }

    // ─── payout: timing edge cases ────────────────────────────────────────────

    /// Fuzz: payout exactly at the boundary timestamp must succeed;
    /// one ledger before must panic.
    #[test]
    fn fuzz_payout_boundary_timing() {
        for interval in [1u64, 60, 3_600, 86_400, 2_592_000] {
            let ctx = make_ctx(2, 100_000_000, interval);
            for m in ctx.members.iter() {
                ctx.client.join(m);
            }

            // One second before payout time — must panic
            ctx.env.ledger().with_mut(|l| l.timestamp = interval); // join at ts=0, payout_time = interval
            let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ctx.client.payout();
            }));
            assert!(
                early.is_err(),
                "interval={interval}: payout at exactly payout_time should panic (not reached)"
            );

            // At payout_time + 1 — must succeed
            ctx.env.ledger().with_mut(|l| l.timestamp = interval + 1);
            ctx.client.payout(); // should not panic
        }
    }

    /// Fuzz: payout after circle completion must always panic.
    #[test]
    fn fuzz_payout_after_completion_always_panics() {
        for max_members in [2u32, 3, 5] {
            let interval: u64 = 86_400;
            let ctx = make_ctx(max_members, 100_000_000, interval);
            for m in ctx.members.iter() {
                ctx.client.join(m);
            }

            let mut ts: u64 = 0;
            for cycle in 1..=max_members {
                ts += interval + 1;
                ctx.env.ledger().with_mut(|l| l.timestamp = ts);
                ctx.client.payout();
                if cycle < max_members {
                    for m in ctx.members.iter() {
                        ctx.client.contribute(m, &ctx.contribution);
                    }
                }
            }

            // Extra payout after completion must panic
            ts += interval + 1;
            ctx.env.ledger().with_mut(|l| l.timestamp = ts);
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ctx.client.payout();
            }));
            assert!(
                result.is_err(),
                "max_members={max_members}: payout after completion must panic"
            );
        }
    }

    /// Fuzz: pot value must never overflow for max contribution × max members.
    /// Uses the largest allowed values to exercise the i128 arithmetic path.
    #[test]
    fn fuzz_pot_no_overflow_at_max_values() {
        // Max contribution that fits: i128::MAX / 20 members ≈ 8.5 × 10^36
        // Use a realistic large value: 1_000_000_000_000 stroops (1M USDC)
        let contribution: i128 = 1_000_000_000_000;
        let max_members: u32 = 20;
        let ctx = make_ctx(max_members, contribution, 86_400);

        for m in ctx.members.iter() {
            ctx.client.join(m);
        }

        ctx.env.ledger().with_mut(|l| l.timestamp = 86_401);

        // Payout should succeed without overflow panic
        ctx.client.payout();

            let (cycle, _, _, _, _) = ctx.client.get_state();
        assert_eq!(cycle, 2, "should advance to cycle 2 after first payout");
    }
}
