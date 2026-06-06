// Fork integration check: prove our deployed ReclaimDeliveryVerifier + ReclaimDeliveryCondition
// accept a REAL Reclaim proof, verified against the REAL (forked) canonical Reclaim verifier,
// and that the salt-binding gate works. No funds required — runs against an anvil Base Sepolia fork.
import fs from "node:fs";
import { createPublicClient, http, encodeAbiParameters, keccak256, toHex, zeroAddress } from "viem";

const RPC = "http://localhost:8545";
const [VERIFIER, CONDITION] = fs.readFileSync("/tmp/hb_fork_addrs.txt", "utf8").trim().split(/\s+/);
const prov = JSON.parse(fs.readFileSync("/tmp/enrich2.json", "utf8")).provenance;
const oc = prov.onchain;
const marker = prov.marker;

// --- IReclaim.Proof tuple components (must match IReclaim.sol byte-for-byte) ---
const claimInfoT = { name: "claimInfo", type: "tuple", components: [
  { name: "provider", type: "string" }, { name: "parameters", type: "string" }, { name: "context", type: "string" },
]};
const completeClaimT = { name: "claim", type: "tuple", components: [
  { name: "identifier", type: "bytes32" }, { name: "owner", type: "address" },
  { name: "timestampS", type: "uint32" }, { name: "epoch", type: "uint32" },
]};
const signedClaimT = { name: "signedClaim", type: "tuple", components: [ completeClaimT, { name: "signatures", type: "bytes[]" } ]};
const proofT = { type: "tuple", components: [ claimInfoT, signedClaimT ]};

const proof = {
  claimInfo: oc.claimInfo,
  signedClaim: {
    claim: {
      identifier: oc.signedClaim.claim.identifier,
      owner: oc.signedClaim.claim.owner,
      timestampS: Number(oc.signedClaim.claim.timestampS),
      epoch: Number(oc.signedClaim.claim.epoch),
    },
    signatures: oc.signedClaim.signatures,
  },
};

// AuthCaptureEscrow.PaymentInfo tuple (condition only reads .salt; rest can be zero)
const paymentInfoT = { type: "tuple", components: [
  { name: "operator", type: "address" }, { name: "payer", type: "address" }, { name: "receiver", type: "address" },
  { name: "token", type: "address" }, { name: "maxAmount", type: "uint120" }, { name: "preApprovalExpiry", type: "uint48" },
  { name: "authorizationExpiry", type: "uint48" }, { name: "refundExpiry", type: "uint48" },
  { name: "minFeeBps", type: "uint16" }, { name: "maxFeeBps", type: "uint16" },
  { name: "feeReceiver", type: "address" }, { name: "salt", type: "uint256" },
]};
const mkPaymentInfo = (salt) => ({
  operator: zeroAddress, payer: zeroAddress, receiver: zeroAddress, token: zeroAddress,
  maxAmount: 0n, preApprovalExpiry: 0, authorizationExpiry: 0, refundExpiry: 0,
  minFeeBps: 0, maxFeeBps: 0, feeReceiver: zeroAddress, salt,
});

const verifierAbi = [{ type: "function", name: "verifyDelivery", stateMutability: "view",
  inputs: [ { ...proofT, name: "proof" }, { name: "marker", type: "string" } ], outputs: [{ type: "bool" }] }];
const conditionAbi = [{ type: "function", name: "check", stateMutability: "view",
  inputs: [ { ...paymentInfoT, name: "paymentInfo" }, { name: "amount", type: "uint256" },
            { name: "caller", type: "address" }, { name: "data", type: "bytes" } ], outputs: [{ name: "allowed", type: "bool" }] }];

const client = createPublicClient({ transport: http(RPC) });

const expectedSalt = BigInt(keccak256(toHex(marker)));
const data = encodeAbiParameters([proofT, { type: "string" }], [proof, marker]);

const read = (address, abi, functionName, args) => client.readContract({ address, abi, functionName, args });

console.log("marker:", marker);
console.log("verifier:", VERIFIER, "\ncondition:", CONDITION, "\n");

// 1) verifyDelivery(proof, marker) against the deployed wrapper (delegates to canonical Reclaim on the fork)
const vd = await read(VERIFIER, verifierAbi, "verifyDelivery", [proof, marker]);
console.log(`1. verifyDelivery(realProof, marker)            => ${vd}   ${vd === true ? "PASS" : "FAIL"}`);

// 2) verifyDelivery with a WRONG marker (binding check should fail)
const vdWrong = await read(VERIFIER, verifierAbi, "verifyDelivery", [proof, "0xdeadbeefdeadbeefdeadbeefdeadbeef"]);
console.log(`2. verifyDelivery(realProof, WRONG marker)      => ${vdWrong}  ${vdWrong === false ? "PASS" : "FAIL"}`);

// 3) condition.check with correct salt = keccak(marker) -> allowed
const okBound = await read(CONDITION, conditionAbi, "check", [mkPaymentInfo(expectedSalt), 0n, zeroAddress, data]);
console.log(`3. check(salt=keccak(marker), encode(proof))    => ${okBound}   ${okBound === true ? "PASS" : "FAIL"}`);

// 4) condition.check with WRONG salt -> denied (replay protection)
const okWrong = await read(CONDITION, conditionAbi, "check", [mkPaymentInfo(12345n), 0n, zeroAddress, data]);
console.log(`4. check(WRONG salt)                            => ${okWrong}  ${okWrong === false ? "PASS" : "FAIL"}`);

// 5) condition.check with empty data -> denied (no proof, no money)
const okEmpty = await read(CONDITION, conditionAbi, "check", [mkPaymentInfo(expectedSalt), 0n, zeroAddress, "0x"]);
console.log(`5. check(no proof bytes)                        => ${okEmpty}  ${okEmpty === false ? "PASS" : "FAIL"}`);

const allPass = vd === true && vdWrong === false && okBound === true && okWrong === false && okEmpty === false;
console.log("\n" + (allPass ? "ALL CHECKS PASSED ✅" : "SOME CHECKS FAILED ❌"));
process.exit(allPass ? 0 : 1);
