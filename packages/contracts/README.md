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

## Gating escrow on delivery (x402r `ICondition`)

`ReclaimDeliveryCondition` implements the x402r [`ICondition`](src/x402r/ICondition.sol)
interface so a delivery proof can gate **release of escrowed funds to the merchant**. Wired into
an x402r operator's `CAPTURE_PRE_ACTION_CONDITION` slot, the flow is:

1. Buyer pays through the operator with `authorize()` — USDC is held in the `AuthCaptureEscrow`,
   not yet the merchant's.
2. Merchant fetches Apollo data and mints a Reclaim proof (`apps/merchant/src/attestation`).
3. Merchant calls `capture()`; the operator calls `check(paymentInfo, amount, caller, data)`
   first, with the proof ABI-encoded as `data = (IReclaim.Proof, string marker)`.
4. `check` returns true **only** when the proof verifies *and* (with `BIND_MARKER_TO_SALT`) its
   query marker is committed in `paymentInfo.salt` — i.e. the proof was minted for *this*
   payment. No valid proof → capture reverts → funds stay escrowed and the buyer can void/refund
   after expiry. **No proof, no money.**

`check` is a non-reverting `view` (malformed `data`, a bad proof, or a marker mismatch all
return `false`), matching the x402r condition contract so a failed proof cleanly blocks capture
instead of bricking the operator call. `decodeAndVerify` is split out behind a self-call so a
bad ABI decode is caught rather than reverting. To bind a payment, the operator sets
`paymentInfo.salt = uint256(keccak256(bytes(marker)))` — see `expectedSalt(marker)`.

The `ICondition` interface and the `AuthCaptureEscrow.PaymentInfo` struct are mirrored locally
(byte-for-byte with `iConditionAbi` in `@x402r/core`) so this package implements the operator
contract without vendoring the whole x402r-contracts tree.

> **Direction of trust (still v1):** this condition releases escrow when the *merchant* proves
> good delivery — the merchant-proves-good model below. The trustless flip is the same slot
> holding the inverse: the *buyer* proves **bad** delivery to *block* capture and force a refund.
> The condition is structured as that seam.

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
