// SPDX-License-Identifier: BUSL-1.1
// Copyright 2025-2026 Ali Abdoli and Vrajang Parikh
// CONTRACTS UNAUDITED: USE AT YOUR OWN RISK
pragma solidity ^0.8.28;

import {ICondition, AuthCaptureEscrow} from "./x402r/ICondition.sol";
import {IReclaim} from "./IReclaim.sol";
import {ReclaimDeliveryVerifier} from "./ReclaimDeliveryVerifier.sol";

/**
 * @title ReclaimDeliveryCondition
 * @notice An x402r {ICondition} that releases escrowed funds to the merchant only when a valid
 *         Reclaim (zkTLS) delivery proof is supplied — proving the merchant fetched good data
 *         from Apollo for *this* payment.
 *
 * @dev FLOW. The buyer pays via the x402r operator with `authorize()` (funds held in escrow),
 *      naming this contract as the operator's `CAPTURE_PRE_ACTION_CONDITION`. When the merchant
 *      later calls `capture()` to claim the held funds, the operator calls {check} first,
 *      forwarding the merchant's proof as `data`. Capture (and thus payout to the receiver) only
 *      goes through when {check} returns true; otherwise the funds stay escrowed and the buyer
 *      can void/refund after expiry. No proof, no money.
 *
 *      QUERY BINDING. The proof commits to a `marker` (the merchant's hash of the buyer's
 *      request — see `apps/merchant/src/attestation/reclaim.ts`). With `BIND_MARKER_TO_SALT`
 *      on (the default), {check} also requires `paymentInfo.salt == expectedSalt(marker)`, so a
 *      proof minted for one query cannot be replayed to capture a different payment. The operator
 *      must therefore set `paymentInfo.salt = uint256(keccak256(bytes(marker)))` when authorizing.
 *
 *      TRUST MODEL — unchanged from {ReclaimDeliveryVerifier}: this gates on the
 *      *merchant -> Apollo* leg only. It proves the merchant obtained good data, not that the
 *      buyer received it. Intentional v1 ("merchant proves good"); the trustless version moves
 *      attestation to the buyer side (prove-bad-delivery to *block* capture / force a refund).
 *      This contract is that seam — the same operator slot later holds the inverted condition.
 *
 *      NON-REVERTING. {check} never reverts (malformed `data`, a bad proof, or a marker mismatch
 *      all return false), matching the x402r condition contract so a failed proof cleanly blocks
 *      capture instead of bricking the operator call.
 */
contract ReclaimDeliveryCondition is ICondition {
    /// @notice Verifier that performs the crypto + marker-presence check against canonical Reclaim.
    ReclaimDeliveryVerifier public immutable VERIFIER;

    /// @notice When true, the proof's query marker must match `paymentInfo.salt` (replay binding).
    bool public immutable BIND_MARKER_TO_SALT;

    error ZeroVerifier();

    /// @param verifier The deployed {ReclaimDeliveryVerifier} (wraps the canonical Reclaim verifier).
    /// @param bindMarkerToSalt Require the proof's marker to be committed in `paymentInfo.salt`.
    constructor(address verifier, bool bindMarkerToSalt) {
        if (verifier == address(0)) revert ZeroVerifier();
        VERIFIER = ReclaimDeliveryVerifier(verifier);
        BIND_MARKER_TO_SALT = bindMarkerToSalt;
    }

    /// @notice The salt the operator must place in `PaymentInfo.salt` to bind a payment to `marker`.
    /// @dev Pure helper for the operator/SDK; mirrors the on-chain binding check below.
    function expectedSalt(string calldata marker) public pure returns (uint256) {
        return uint256(keccak256(bytes(marker)));
    }

    /// @inheritdoc ICondition
    /// @dev `data` is ABI-encoded `(IReclaim.Proof proof, string marker)`. `amount` and `caller`
    ///      are unused here — delivery is all-or-nothing and any party may submit a valid proof.
    function check(
        AuthCaptureEscrow.PaymentInfo calldata paymentInfo,
        uint256, /* amount */
        address, /* caller */
        bytes calldata data
    ) external view override returns (bool allowed) {
        if (data.length == 0) return false;
        // Decode in a self-call so malformed `data` returns false instead of reverting capture.
        try this.decodeAndVerify(paymentInfo.salt, data) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    /// @notice Decode the proof and verify it (crypto, marker presence, and optional salt binding).
    /// @dev External only so {check} can wrap it in try/catch; restricted to self-calls. View.
    function decodeAndVerify(uint256 salt, bytes calldata data) external view returns (bool) {
        require(msg.sender == address(this), "self only");
        (IReclaim.Proof memory proof, string memory marker) =
            abi.decode(data, (IReclaim.Proof, string));

        // Bind the proof to this specific payment: its query marker must equal the committed salt.
        if (BIND_MARKER_TO_SALT && uint256(keccak256(bytes(marker))) != salt) return false;

        return VERIFIER.verifyDelivery(proof, marker);
    }
}
