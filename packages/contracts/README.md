# @humanbase/contracts

On-chain verification of merchant **delivery proofs** for humanbase, built on
[Reclaim Protocol](https://reclaimprotocol.org/) zkTLS attestations.

**License:** BUSL-1.1 (see `LICENSE`) — same terms and licensor as
[`BackTrackCo/x402r-contracts`](https://github.com/BackTrackCo/x402r-contracts). The rest of
the humanbase repo is MIT.

## What it does

`ReclaimDeliveryVerifier` checks, on-chain, that the merchant fetched real, non-empty data
from Apollo for a paid request. The merchant generates the proof with `zkFetch` (see
`apps/merchant/src/attestation/reclaim.ts`); `transformForOnchain()` shapes it into the
`Proof` struct this contract consumes. Verification delegates to the canonical Reclaim
verifier (UUPS proxy) on Base:

| Network      | Reclaim verifier                             |
| ------------ | -------------------------------------------- |
| Base Sepolia | `0xF90085f5Fd1a3bEb8678623409b3811eCeC5f6A5` |
| Base mainnet | `0x8CDc031d5B7F148ab0435028B16c682c469CEfC3` |

The address is constructor-injected, so the same bytecode targets either chain.

## Trust model (important)

This verifies the **merchant → Apollo** leg only. A passing proof shows the merchant *obtained*
good data; it does **not** prove the buyer *received* it — only the buyer can attest its own
session. A merchant could fetch good data, mint a valid proof, and still serve the buyer
garbage. This is an intentional v1 simplification. The trustless version moves attestation to
the buyer side (prove-bad-delivery gating a refund on an x402r escrow); `verifyDelivery()` is
written as a pure, non-reverting view specifically so it can lift into an x402r `ICondition`
slot later without changes.

## Build & test

```bash
forge install foundry-rs/forge-std   # if not already vendored
forge build
forge test
```

Tests use a `MockReclaim` stand-in, so the suite runs offline without a live proof.
