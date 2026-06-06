// SPDX-License-Identifier: BUSL-1.1
// Copyright 2025-2026 Ali Abdoli and Vrajang Parikh
// CONTRACTS UNAUDITED: USE AT YOUR OWN RISK
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReclaimDeliveryCondition} from "../src/ReclaimDeliveryCondition.sol";
import {ReclaimDeliveryVerifier} from "../src/ReclaimDeliveryVerifier.sol";
import {ICondition, AuthCaptureEscrow} from "../src/x402r/ICondition.sol";
import {IReclaim} from "../src/IReclaim.sol";

/// @dev Stand-in for the canonical Reclaim verifier; reverts on verifyProof when `invalid`.
contract MockReclaim is IReclaim {
    bool public invalid;

    function setInvalid(bool v) external {
        invalid = v;
    }

    function verifyProof(Proof memory) external view {
        require(!invalid, "Reclaim: invalid proof");
    }
}

contract ReclaimDeliveryConditionTest is Test {
    MockReclaim internal reclaim;
    ReclaimDeliveryVerifier internal verifier;
    ReclaimDeliveryCondition internal boundCond; // BIND_MARKER_TO_SALT = true
    ReclaimDeliveryCondition internal looseCond; // BIND_MARKER_TO_SALT = false

    string internal constant MARKER = "0xabc1230000000000000000000000000000";

    function setUp() public {
        reclaim = new MockReclaim();
        verifier = new ReclaimDeliveryVerifier(address(reclaim));
        boundCond = new ReclaimDeliveryCondition(address(verifier), true);
        looseCond = new ReclaimDeliveryCondition(address(verifier), false);
    }

    // --- helpers ---------------------------------------------------------------

    function _payment(uint256 salt) internal pure returns (AuthCaptureEscrow.PaymentInfo memory p) {
        p.operator = address(0xA11CE);
        p.payer = address(0xB0B);
        p.receiver = address(0xACE);
        p.token = address(0x0DDC);
        p.maxAmount = 1_000_000;
        p.salt = salt;
        // remaining fields default to zero — irrelevant to delivery gating.
    }

    /// @dev Encode `data` the way the merchant/operator would: (proof, marker), with `marker`
    ///      committed into the proof's context so the verifier's presence check passes.
    function _data(string memory marker, bool markerInProof) internal pure returns (bytes memory) {
        IReclaim.Proof memory p;
        p.claimInfo = IReclaim.ClaimInfo({
            provider: "http",
            parameters: "{}",
            context: markerInProof ? string.concat('{"contextMessage":"', marker, '"}') : "{}"
        });
        return abi.encode(p, marker);
    }

    // --- tests -----------------------------------------------------------------

    function test_constructor_rejectsZeroVerifier() public {
        vm.expectRevert(ReclaimDeliveryCondition.ZeroVerifier.selector);
        new ReclaimDeliveryCondition(address(0), true);
    }

    function test_implementsICondition() public view {
        // Compiles/links through the interface type — the operator calls it this way.
        ICondition c = ICondition(address(boundCond));
        assertFalse(c.check(_payment(0), 0, address(0), ""));
    }

    function test_noData_denies() public view {
        assertFalse(boundCond.check(_payment(boundCond.expectedSalt(MARKER)), 0, address(0), ""));
    }

    function test_validProof_boundSalt_allows() public view {
        uint256 salt = boundCond.expectedSalt(MARKER);
        bytes memory data = _data(MARKER, true);
        assertTrue(boundCond.check(_payment(salt), 0, address(0), data));
    }

    function test_validProof_wrongSalt_denies() public view {
        // Proof is valid and marker present, but salt does not commit to this marker.
        bytes memory data = _data(MARKER, true);
        assertFalse(boundCond.check(_payment(uint256(0xDEAD)), 0, address(0), data));
    }

    function test_invalidProof_denies() public {
        reclaim.setInvalid(true);
        uint256 salt = boundCond.expectedSalt(MARKER);
        bytes memory data = _data(MARKER, true);
        assertFalse(boundCond.check(_payment(salt), 0, address(0), data));
    }

    function test_markerAbsentFromProof_denies() public view {
        // Salt commits to the marker, but the proof itself doesn't carry it → not bound.
        uint256 salt = boundCond.expectedSalt(MARKER);
        bytes memory data = _data(MARKER, false);
        assertFalse(boundCond.check(_payment(salt), 0, address(0), data));
    }

    function test_looseVariant_ignoresSalt_allows() public view {
        // Binding off: any salt is fine as long as the proof is valid and carries the marker.
        bytes memory data = _data(MARKER, true);
        assertTrue(looseCond.check(_payment(uint256(0xBEEF)), 0, address(0), data));
    }

    function test_malformedData_deniesWithoutReverting() public view {
        bytes memory garbage = hex"deadbeefdeadbeef";
        assertFalse(boundCond.check(_payment(0), 0, address(0), garbage));
    }

    function test_expectedSalt_matchesKeccak() public view {
        assertEq(boundCond.expectedSalt(MARKER), uint256(keccak256(bytes(MARKER))));
    }

    function test_decodeAndVerify_isSelfOnly() public {
        bytes memory data = _data(MARKER, true);
        uint256 salt = boundCond.expectedSalt(MARKER);
        vm.expectRevert(bytes("self only"));
        boundCond.decodeAndVerify(salt, data);
    }
}
