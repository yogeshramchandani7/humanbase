// Full x402r auth-capture escrow loop on a Base Sepolia fork, gated by our ReclaimDeliveryCondition.
//   1. deploy a custom PaymentOperator (releaseCondition = our condition)
//   2. fund a buyer with USDC (anvil cheat) and authorize() funds into escrow
//   3. release() with a REAL Reclaim proof  -> capture succeeds, USDC -> receiver
//   4. negative: a payment whose salt != keccak(marker) -> release reverts, funds stay escrowed
// No real funds/keys: runs against `anvil --fork-url base-sepolia`.
import fs from "node:fs";
import {
  createPublicClient, createWalletClient, http, encodeAbiParameters, keccak256, toHex, pad,
  zeroAddress, getContract, parseAbi,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getChainConfig } from "@x402r/core";
import { deployOperator } from "@x402r/core";
import { authorize, release } from "@x402r/core";
import { signReceiveAuthorization } from "@x402r/core";

const RPC = "http://localhost:8545";
const CHAIN_ID = 84532;
const cfg = getChainConfig(CHAIN_ID);
const [VERIFIER, CONDITION] = fs.readFileSync("/tmp/hb_fork_addrs.txt", "utf8").trim().split(/\s+/);
const prov = JSON.parse(fs.readFileSync("/tmp/enrich2.json", "utf8")).provenance;
const oc = prov.onchain;
const marker = prov.marker;

// A FRESH clean EOA — plays deployer + buyer + receiver (self-pay loop). NOT an anvil default
// account: those well-known addresses are EIP-7702-delegated on Base Sepolia (23 bytes of code),
// so USDC routes ERC-3009 verification through ERC-1271 and rejects a plain ECDSA sig. A clean EOA
// (no code) uses the ecrecover path and the authorization verifies. Funded via anvil cheats below.
const account = privateKeyToAccount(generatePrivateKey());
const chain = { id: CHAIN_ID, name: "base-sepolia-fork", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain, transport: http(RPC) });

const usdc = getContract({ address: cfg.usdc, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), client: publicClient });
const bal = (a) => usdc.read.balanceOf([a]);
const rpc = (method, params) => fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then(r => r.json());

// --- proof + ABI tuples (match IReclaim.sol) ---
const claimInfoT = { name: "claimInfo", type: "tuple", components: [{ name: "provider", type: "string" }, { name: "parameters", type: "string" }, { name: "context", type: "string" }] };
const completeClaimT = { name: "claim", type: "tuple", components: [{ name: "identifier", type: "bytes32" }, { name: "owner", type: "address" }, { name: "timestampS", type: "uint32" }, { name: "epoch", type: "uint32" }] };
const signedClaimT = { name: "signedClaim", type: "tuple", components: [completeClaimT, { name: "signatures", type: "bytes[]" }] };
const proofT = { type: "tuple", components: [claimInfoT, signedClaimT] };
const proof = {
  claimInfo: oc.claimInfo,
  signedClaim: { claim: { identifier: oc.signedClaim.claim.identifier, owner: oc.signedClaim.claim.owner, timestampS: Number(oc.signedClaim.claim.timestampS), epoch: Number(oc.signedClaim.claim.epoch) }, signatures: oc.signedClaim.signatures },
};
const proofData = encodeAbiParameters([proofT, { type: "string" }], [proof, marker]);

async function fundUsdc(addr, amount) {
  // FiatTokenV2 balances live at storage slot 9: balances[addr]
  const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [addr, 9n]));
  await rpc("anvil_setStorageAt", [cfg.usdc, slot, pad(toHex(amount))]);
}

async function main() {
  console.log("operator factory:", cfg.factories.paymentOperator);
  console.log("our condition:   ", CONDITION);
  console.log("buyer (clean EOA):", account.address, "\n");

  // Fund the fresh EOA with ETH for gas (it relays the operator/authorize/release txs).
  await rpc("anvil_setBalance", [account.address, "0xDE0B6B3A7640000"]); // 1 ETH

  // 1) deploy custom operator: releaseCondition = OUR condition, everything else permissive
  const operatorConfig = {
    feeRecipient: account.address, feeCalculator: zeroAddress,
    authorizeCondition: cfg.conditions.alwaysTrue, authorizeRecorder: zeroAddress,
    chargeCondition: zeroAddress, chargeRecorder: zeroAddress,
    releaseCondition: CONDITION, releaseRecorder: zeroAddress,
    refundInEscrowCondition: cfg.conditions.alwaysTrue, refundInEscrowRecorder: zeroAddress,
    refundPostEscrowCondition: cfg.conditions.alwaysTrue, refundPostEscrowRecorder: zeroAddress,
  };
  const dep = await deployOperator(walletClient, publicClient, { factoryAddress: cfg.factories.paymentOperator, config: operatorConfig });
  const operatorAddress = dep.address;
  console.log("1. deployed operator:", operatorAddress, dep.isNew ? "(new)" : "(existed)");

  const RECEIVER = privateKeyToAccount(generatePrivateKey()).address; // distinct merchant receiver
  const now = Number((await publicClient.getBlock()).timestamp);
  const amount = 10000n; // 0.01 USDC
  const mkPaymentInfo = (salt) => ({
    operator: operatorAddress, payer: account.address, receiver: RECEIVER, token: cfg.usdc,
    maxAmount: amount, preApprovalExpiry: now + 3600, authorizationExpiry: now + 3600, refundExpiry: now + 7200,
    // x402r operator's validFees modifier requires paymentInfo.feeReceiver == the operator address.
    minFeeBps: 0, maxFeeBps: 0, feeReceiver: operatorAddress, salt,
  });

  // ---------- POSITIVE: salt = keccak(marker), real proof ----------
  await fundUsdc(account.address, amount * 10n);
  const piGood = mkPaymentInfo(BigInt(keccak256(toHex(marker))));
  const { collectorData, tokenCollector } = await signReceiveAuthorization({ account, chainId: CHAIN_ID, paymentInfo: piGood });

  const payerBefore = await bal(account.address);
  await authorize(walletClient, { operatorAddress, paymentInfo: piGood, amount, tokenCollector, collectorData });
  const payerAfterAuth = await bal(account.address);
  const escrowed = payerBefore - payerAfterAuth;
  console.log(`2. authorize(): payer USDC -${escrowed} into escrow  ${escrowed === amount ? "PASS" : "FAIL"}`);

  const recvBefore = await bal(RECEIVER);
  await release(walletClient, { operatorAddress, paymentInfo: piGood, amount, data: proofData });
  const recvAfter = await bal(RECEIVER);
  console.log(`3. release(realProof): receiver USDC +${recvAfter - recvBefore}  ${recvAfter - recvBefore === amount ? "PASS (captured)" : "FAIL"}`);

  // ---------- NEGATIVE: salt != keccak(marker) -> condition denies release ----------
  const piBad = mkPaymentInfo(99999n); // salt does NOT match the proof's marker
  const sig2 = await signReceiveAuthorization({ account, chainId: CHAIN_ID, paymentInfo: piBad });
  await authorize(walletClient, { operatorAddress, paymentInfo: piBad, amount, tokenCollector: sig2.tokenCollector, collectorData: sig2.collectorData });
  const recvBeforeBad = await bal(RECEIVER);
  let reverted = false;
  try {
    await release(walletClient, { operatorAddress, paymentInfo: piBad, amount, data: proofData });
  } catch { reverted = true; }
  const heldNotCaptured = (await bal(RECEIVER)) === recvBeforeBad;
  console.log(`4. release(wrong-salt payment): reverted=${reverted}, receiver got nothing=${heldNotCaptured}  ${reverted && heldNotCaptured ? "PASS (no proof, no money)" : "FAIL"}`);

  const allPass = (escrowed === amount) && (recvAfter - recvBefore === amount) && reverted && heldNotCaptured;
  console.log("\n" + (allPass ? "FULL ESCROW LOOP PASSED ✅" : "SOME CHECKS FAILED ❌"));
  process.exit(allPass ? 0 : 1);
}
main().catch((e) => { console.error("ERROR:", e.shortMessage || e.message); console.error("DETAILS:", e.details || e.metaMessages?.join(" | ") || e.cause?.shortMessage || e.cause?.message || ""); process.exit(1); });
