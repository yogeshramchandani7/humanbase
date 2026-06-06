// SPDX-License-Identifier: BUSL-1.1
// Copyright 2025-2026 Ali Abdoli and Vrajang Parikh
// CONTRACTS UNAUDITED: USE AT YOUR OWN RISK
pragma solidity ^0.8.28;

/// @title AuthCaptureEscrow (struct layout only)
/// @notice The `PaymentInfo` struct as consumed by the x402r operator/escrow stack
///         (the commerce-payments AuthCaptureEscrow). Declared here so this package can
///         implement `ICondition` without vendoring the whole x402r-contracts tree.
/// @dev Field order, types, and widths MUST match the canonical struct exactly, or the
///      `check` selector below will not match what the operator calls and the ABI decode
///      of `paymentInfo` will be garbage. Mirrors `iConditionAbi` in the x402r core package
///      (packages/core/src/abis/generated.ts).
library AuthCaptureEscrow {
    struct PaymentInfo {
        address operator;
        address payer;
        address receiver;
        address token;
        uint120 maxAmount;
        uint48 preApprovalExpiry;
        uint48 authorizationExpiry;
        uint48 refundExpiry;
        uint16 minFeeBps;
        uint16 maxFeeBps;
        address feeReceiver;
        uint256 salt;
    }
}

/// @title ICondition
/// @notice The x402r pre-action condition interface. The operator calls `check` before an
///         action (authorize / charge / capture / void / refund) and only proceeds when it
///         returns true. Wiring a condition into the operator's `CAPTURE_PRE_ACTION_CONDITION`
///         slot makes capture — i.e. releasing escrowed funds to the receiver (merchant) —
///         conditional on `check` passing.
/// @dev `check` is a `view` returning a bool; implementations should NOT revert (return false
///      to deny). The exact selector/shape is fixed by the x402r operator — do not change it.
interface ICondition {
    /// @param paymentInfo The payment being acted on (payer, receiver, token, salt, …).
    /// @param amount      The amount being captured/charged for this action.
    /// @param caller      The address invoking the operator action.
    /// @param data        Opaque per-action bytes the operator forwards to the condition.
    /// @return allowed    True iff the action is permitted to proceed.
    function check(
        AuthCaptureEscrow.PaymentInfo calldata paymentInfo,
        uint256 amount,
        address caller,
        bytes calldata data
    ) external view returns (bool allowed);
}
