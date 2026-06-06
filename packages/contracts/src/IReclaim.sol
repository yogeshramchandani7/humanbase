// SPDX-License-Identifier: BUSL-1.1
// Copyright 2025-2026 Ali Abdoli and Vrajang Parikh
// CONTRACTS UNAUDITED: USE AT YOUR OWN RISK
pragma solidity ^0.8.28;

/// @title IReclaim
/// @notice Minimal interface + struct layout for the canonical Reclaim Protocol
///         on-chain verifier (the reclaimprotocol verifier-solidity-sdk package).
/// @dev The structs MUST match Reclaim's `Claims.sol` exactly, byte-for-byte in ABI
///      ordering, or calls to the canonical verifier will revert on decode. We define
///      them locally rather than importing the SDK because the published SDK pins
///      `pragma solidity 0.8.4`, which is incompatible with this repo's ^0.8.28.
///
///      Canonical verifier addresses (UUPS proxies, stable across upgrades):
///        Base Sepolia: 0xF90085f5Fd1a3bEb8678623409b3811eCeC5f6A5
///        Base mainnet: 0x8CDc031d5B7F148ab0435028B16c682c469CEfC3
///
///      `verifyProof` is a view function that REVERTS on an invalid proof (it does not
///      return a bool). Callers that must not revert should wrap it in try/catch.
interface IReclaim {
    struct ClaimInfo {
        string provider;
        string parameters;
        string context;
    }

    struct CompleteClaimData {
        bytes32 identifier;
        address owner;
        uint32 timestampS;
        uint32 epoch;
    }

    struct SignedClaim {
        CompleteClaimData claim;
        bytes[] signatures;
    }

    struct Proof {
        ClaimInfo claimInfo;
        SignedClaim signedClaim;
    }

    /// @notice Verify the witness signatures and claim integrity of a Reclaim proof.
    /// @dev Reverts if the proof is invalid.
    function verifyProof(Proof memory proof) external view;
}
