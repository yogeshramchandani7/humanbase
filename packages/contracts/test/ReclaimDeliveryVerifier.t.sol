// SPDX-License-Identifier: BUSL-1.1
// Copyright 2025-2026 Ali Abdoli and Vrajang Parikh
// CONTRACTS UNAUDITED: USE AT YOUR OWN RISK
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReclaimDeliveryVerifier} from "../src/ReclaimDeliveryVerifier.sol";
import {IReclaim} from "../src/IReclaim.sol";

/// @dev Stand-in for the canonical Reclaim verifier. Reverts on verifyProof when `invalid`,
///      matching the real contract's revert-on-bad-proof behavior.
contract MockReclaim is IReclaim {
    bool public invalid;

    function setInvalid(bool v) external {
        invalid = v;
    }

    function verifyProof(Proof memory) external view {
        require(!invalid, "Reclaim: invalid proof");
    }
}

contract ReclaimDeliveryVerifierTest is Test {
    MockReclaim internal reclaim;
    ReclaimDeliveryVerifier internal verifier;

    function setUp() public {
        reclaim = new MockReclaim();
        verifier = new ReclaimDeliveryVerifier(address(reclaim));
    }

    function _proof(string memory parameters, string memory context)
        internal
        pure
        returns (IReclaim.Proof memory p)
    {
        p.claimInfo = IReclaim.ClaimInfo({provider: "http", parameters: parameters, context: context});
        // signedClaim left default; the mock ignores it.
    }

    function test_constructor_rejectsZeroVerifier() public {
        vm.expectRevert(ReclaimDeliveryVerifier.ZeroVerifier.selector);
        new ReclaimDeliveryVerifier(address(0));
    }

    function test_validProof_noMarker_passes() public view {
        IReclaim.Proof memory p = _proof("{}", "{}");
        assertTrue(verifier.verifyDelivery(p, ""));
        assertTrue(verifier.isValidProof(p));
    }

    function test_invalidProof_fails_withoutReverting() public {
        reclaim.setInvalid(true);
        IReclaim.Proof memory p = _proof("{}", "{}");
        assertFalse(verifier.verifyDelivery(p, ""));
        assertFalse(verifier.isValidProof(p));
    }

    function test_marker_presentInParameters_passes() public view {
        IReclaim.Proof memory p = _proof('{"x-humanbase-query":"0xabc123"}', "{}");
        assertTrue(verifier.verifyDelivery(p, "0xabc123"));
    }

    function test_marker_presentInContext_passes() public view {
        IReclaim.Proof memory p = _proof("{}", '{"contextMessage":"0xabc123"}');
        assertTrue(verifier.verifyDelivery(p, "0xabc123"));
    }

    function test_marker_absent_fails() public view {
        IReclaim.Proof memory p = _proof('{"x-humanbase-query":"0xdeadbeef"}', "{}");
        assertFalse(verifier.verifyDelivery(p, "0xabc123"));
    }

    function test_marker_butInvalidProof_fails() public {
        reclaim.setInvalid(true);
        IReclaim.Proof memory p = _proof('{"x-humanbase-query":"0xabc123"}', "{}");
        assertFalse(verifier.verifyDelivery(p, "0xabc123"));
    }
}
