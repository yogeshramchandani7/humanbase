// SPDX-License-Identifier: BUSL-1.1
// Copyright 2025-2026 Ali Abdoli and Vrajang Parikh
// CONTRACTS UNAUDITED: USE AT YOUR OWN RISK
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ReclaimDeliveryVerifier} from "../src/ReclaimDeliveryVerifier.sol";
import {ReclaimDeliveryCondition} from "../src/ReclaimDeliveryCondition.sol";

/**
 * @title Deploy
 * @notice Deploys {ReclaimDeliveryVerifier} (wrapping the canonical Reclaim verifier) and the
 *         x402r {ReclaimDeliveryCondition} that gates escrow release on a valid delivery proof.
 *
 * @dev Env:
 *      - RECLAIM_VERIFIER     (optional) canonical Reclaim verifier address. Defaults to the
 *                             Base Sepolia UUPS proxy. Set to the mainnet proxy for Base.
 *      - BIND_MARKER_TO_SALT  (optional) "true"/"false", default true. When true the condition
 *                             requires the proof's query marker to equal PaymentInfo.salt so a
 *                             proof can't be replayed against a different payment.
 *
 *      Run (Base Sepolia):
 *        forge script script/Deploy.s.sol:Deploy \
 *          --rpc-url base-sepolia --broadcast --private-key $DEPLOYER_PRIVATE_KEY
 *
 *      The deployed ReclaimDeliveryCondition address is what you wire into your x402r operator's
 *      releaseCondition slot (see apps/merchant deploy-operator script).
 */
contract Deploy is Script {
    // Canonical Reclaim verifier (UUPS proxy) — mirrors ReclaimDeliveryVerifier constants.
    address internal constant BASE_SEPOLIA_RECLAIM = 0xF90085f5Fd1a3bEb8678623409b3811eCeC5f6A5;

    function run() external {
        address reclaim = vm.envOr("RECLAIM_VERIFIER", BASE_SEPOLIA_RECLAIM);
        bool bindMarkerToSalt = vm.envOr("BIND_MARKER_TO_SALT", true);

        vm.startBroadcast();

        ReclaimDeliveryVerifier verifier = new ReclaimDeliveryVerifier(reclaim);
        ReclaimDeliveryCondition condition =
            new ReclaimDeliveryCondition(address(verifier), bindMarkerToSalt);

        vm.stopBroadcast();

        console2.log("Reclaim verifier (canonical):", reclaim);
        console2.log("ReclaimDeliveryVerifier:     ", address(verifier));
        console2.log("ReclaimDeliveryCondition:    ", address(condition));
        console2.log("BIND_MARKER_TO_SALT:         ", bindMarkerToSalt);
    }
}
