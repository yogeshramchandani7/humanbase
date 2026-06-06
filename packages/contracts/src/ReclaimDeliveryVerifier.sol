// SPDX-License-Identifier: BUSL-1.1
// Copyright 2025-2026 Ali Abdoli and Vrajang Parikh
// CONTRACTS UNAUDITED: USE AT YOUR OWN RISK
pragma solidity ^0.8.28;

import {IReclaim} from "./IReclaim.sol";

/**
 * @title ReclaimDeliveryVerifier
 * @notice On-chain verification of a merchant's zkTLS (Reclaim) proof that an upstream
 *         data provider (Apollo.io) returned good data for a paid request.
 *
 * @dev TRUST MODEL — READ THIS. This verifies the *merchant -> Apollo* leg only. A passing
 *      proof shows the merchant fetched real, non-empty data from Apollo bound to a query
 *      marker. It does NOT prove the buyer received that data (the merchant -> buyer leg is
 *      unattested, because only the buyer can place an attestor in its own session). A
 *      merchant could fetch good data, mint a valid proof, and still serve the buyer garbage.
 *      This is an intentional v1 simplification ("good enough for now"); a future version
 *      should move attestation to the buyer side (prove-bad-delivery on a refund path).
 *
 *      Designed to fold into the x402r `ICondition` interface later: `check()` semantics map
 *      onto `verifyDelivery()` (pure view, never reverts — returns false to deny), and the
 *      verifier address is constructor-injected as an immutable so the same code targets Base
 *      Sepolia and Base mainnet.
 */
contract ReclaimDeliveryVerifier {
    /// @notice Canonical Reclaim verifier on Base Sepolia (informational; pass to constructor).
    address public constant BASE_SEPOLIA_RECLAIM = 0xF90085f5Fd1a3bEb8678623409b3811eCeC5f6A5;
    /// @notice Canonical Reclaim verifier on Base mainnet (informational; pass to constructor).
    address public constant BASE_RECLAIM = 0x8CDc031d5B7F148ab0435028B16c682c469CEfC3;

    /// @notice The Reclaim verifier this instance checks proofs against.
    IReclaim public immutable RECLAIM;

    error ZeroVerifier();

    constructor(address reclaim) {
        if (reclaim == address(0)) revert ZeroVerifier();
        RECLAIM = IReclaim(reclaim);
    }

    /**
     * @notice Verify a delivery proof and that it is bound to an expected query marker.
     * @param proof The Reclaim proof produced by the merchant's zkFetch of the Apollo call.
     * @param marker The expected query-binding marker (e.g. the hex query hash the merchant
     *        committed into the proven request) that must appear in the proof's parameters or
     *        context. Pass an empty string to skip the binding check (crypto-only).
     * @return ok True iff the proof's witness signatures verify AND the marker is present.
     * @dev Pure view, never reverts — mirrors the x402r `ICondition.check` contract so this can
     *      be lifted into a condition slot unchanged.
     */
    function verifyDelivery(IReclaim.Proof calldata proof, string calldata marker)
        external
        view
        returns (bool ok)
    {
        // Crypto check: the canonical verifier reverts on an invalid proof; swallow that.
        try RECLAIM.verifyProof(proof) {
            // verified
        } catch {
            return false;
        }

        // Binding check: the buyer's query marker must be committed inside the attested request.
        if (bytes(marker).length == 0) return true;
        return _contains(proof.claimInfo.parameters, marker) || _contains(proof.claimInfo.context, marker);
    }

    /**
     * @notice Crypto-only verification (no query binding).
     * @return ok True iff the proof's witness signatures verify.
     */
    function isValidProof(IReclaim.Proof calldata proof) external view returns (bool ok) {
        try RECLAIM.verifyProof(proof) {
            return true;
        } catch {
            return false;
        }
    }

    /// @dev Naive substring search (haystack contains needle). Deterministic and cheap for the
    ///      short markers used here. Production binding should parse a structured context field
    ///      rather than substring-match.
    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0) return true;
        if (n.length > h.length) return false;

        uint256 end = h.length - n.length;
        for (uint256 i = 0; i <= end; ++i) {
            bool matched = true;
            for (uint256 j = 0; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }
        return false;
    }
}
