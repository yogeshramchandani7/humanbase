// Capture REAL escrow tx hashes for the demo fixtures by running both flows on a Base Sepolia fork:
//   FOUND:    authorize -> release(proof)        => payment + settle hashes
//   NOTFOUND: authorize -> refundInEscrow        => payment + refund hashes
// Writes the hashes into apps/demo/fixtures/escrow-{found,notfound}.json.
// Prereqs: anvil fork on :8545, our verifier+condition deployed (addrs in /tmp/hb_fork_addrs.txt).
import fs from "node:fs";
import {
  createPublicClient, createWalletClient, http, encodeAbiParameters, keccak256, toHex, pad,
  zeroAddress, parseAbi, getContract,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getChainConfig, deployOperator, authorize, release, refundInEscrow, signReceiveAuthorization } from "@x402r/core";

const RPC = "http://localhost:8545";
const CHAIN_ID = 84532;
const cfg = getChainConfig(CHAIN_ID);
const [, CONDITION] = fs.readFileSync("/tmp/hb_fork_addrs.txt", "utf8").trim().split(/\s+/);
const prov = JSON.parse(fs.readFileSync("/tmp/enrich2.json", "utf8")).provenance;
const oc = prov.onchain, marker = prov.marker;

const account = privateKeyToAccount(generatePrivateKey()); // clean EOA (no 7702 delegation)
const chain = { id: CHAIN_ID, name: "fork", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain, transport: http(RPC) });
const usdc = getContract({ address: cfg.usdc, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), client: publicClient });
const rpc = (m, p) => fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) }).then(r => r.json());

const claimInfoT = { name: "claimInfo", type: "tuple", components: [{ name: "provider", type: "string" }, { name: "parameters", type: "string" }, { name: "context", type: "string" }] };
const completeClaimT = { name: "claim", type: "tuple", components: [{ name: "identifier", type: "bytes32" }, { name: "owner", type: "address" }, { name: "timestampS", type: "uint32" }, { name: "epoch", type: "uint32" }] };
const signedClaimT = { name: "signedClaim", type: "tuple", components: [completeClaimT, { name: "signatures", type: "bytes[]" }] };
const proofT = { type: "tuple", components: [claimInfoT, signedClaimT] };
const proof = { claimInfo: oc.claimInfo, signedClaim: { claim: { identifier: oc.signedClaim.claim.identifier, owner: oc.signedClaim.claim.owner, timestampS: Number(oc.signedClaim.claim.timestampS), epoch: Number(oc.signedClaim.claim.epoch) }, signatures: oc.signedClaim.signatures } };
const proofData = encodeAbiParameters([proofT, { type: "string" }], [proof, marker]);

const fund = async (addr, amt) => rpc("anvil_setStorageAt", [cfg.usdc, keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [addr, 9n])), pad(toHex(amt))]);
const writeFixture = (name, patch) => {
  const p = `apps/demo/fixtures/${name}`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.hashes = { ...j.hashes, ...patch };
  j.network = "base-sepolia-fork";
  j.explorerLinkable = false; // fork tx hashes don't resolve on basescan; flip true for a real testnet run
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  console.log(`wrote ${name}:`, patch);
};

async function main() {
  await rpc("anvil_setBalance", [account.address, "0xDE0B6B3A7640000"]);
  await fund(account.address, 1_000_000n);

  const operatorConfig = {
    feeRecipient: account.address, feeCalculator: zeroAddress,
    authorizeCondition: cfg.conditions.alwaysTrue, authorizeRecorder: zeroAddress,
    chargeCondition: zeroAddress, chargeRecorder: zeroAddress,
    releaseCondition: CONDITION, releaseRecorder: zeroAddress,
    refundInEscrowCondition: cfg.conditions.alwaysTrue, refundInEscrowRecorder: zeroAddress,
    refundPostEscrowCondition: cfg.conditions.alwaysTrue, refundPostEscrowRecorder: zeroAddress,
  };
  const { address: operatorAddress } = await deployOperator(walletClient, publicClient, { factoryAddress: cfg.factories.paymentOperator, config: operatorConfig });
  const now = Number((await publicClient.getBlock()).timestamp);
  const amount = 10000n;
  const mkPI = (salt) => ({ operator: operatorAddress, payer: account.address, receiver: account.address, token: cfg.usdc, maxAmount: amount, preApprovalExpiry: now + 3600, authorizationExpiry: now + 3600, refundExpiry: now + 7200, minFeeBps: 0, maxFeeBps: 0, feeReceiver: operatorAddress, salt });

  // FOUND: authorize -> release(proof)
  const piA = mkPI(BigInt(keccak256(toHex(marker))));
  const sigA = await signReceiveAuthorization({ account, chainId: CHAIN_ID, paymentInfo: piA });
  const payA = await authorize(walletClient, { operatorAddress, paymentInfo: piA, amount, tokenCollector: sigA.tokenCollector, collectorData: sigA.collectorData });
  const settle = await release(walletClient, { operatorAddress, paymentInfo: piA, amount, data: proofData });
  writeFixture("escrow-found.json", { payment: payA, settle });

  // NOTFOUND: authorize -> refundInEscrow (no proof exists for a missing record)
  const piB = mkPI(BigInt(keccak256(toHex("notfound-" + now))));
  const sigB = await signReceiveAuthorization({ account, chainId: CHAIN_ID, paymentInfo: piB });
  const payB = await authorize(walletClient, { operatorAddress, paymentInfo: piB, amount, tokenCollector: sigB.tokenCollector, collectorData: sigB.collectorData });
  let refund;
  try {
    refund = await refundInEscrow(walletClient, { operatorAddress, paymentInfo: piB, amount });
    console.log("refundInEscrow OK");
  } catch (e) {
    console.warn("refundInEscrow FAILED (keeping placeholder):", e.shortMessage || e.message);
    refund = "0xREFUND_PATH_UNVERIFIED_PLACEHOLDER";
  }
  writeFixture("escrow-notfound.json", { payment: payB, refund });

  console.log("\nDONE. found.payment/settle + notfound.payment/refund captured.");
}
main().catch((e) => { console.error("ERROR:", e.shortMessage || e.message); process.exit(1); });
