import type { LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PrivyClient } from "@privy-io/server-auth";
import { createViemAccount } from "@privy-io/server-auth/viem";

export interface AgentSigner {
  account: LocalAccount;
  mode: "privy" | "local";
  address: string;
}

/**
 * Produces a viem LocalAccount that x402 can sign EIP-3009 authorizations with.
 *
 * - "privy"  → a Privy server wallet (the hackathon path). Signing happens via
 *              Privy's API; the key never touches this process.
 * - "local"  → a raw private key (handy for fast end-to-end testing). Identical
 *              x402 flow — only the key custody differs.
 *
 * Defaults to privy when PRIVY_APP_ID is set, otherwise local.
 */
export async function buildSigner(): Promise<AgentSigner> {
  const mode = (
    process.env.SIGNER_MODE ?? (process.env.PRIVY_APP_ID ? "privy" : "local")
  ).toLowerCase();

  if (mode === "local") {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) throw new Error("SIGNER_MODE=local requires PRIVATE_KEY (a 0x… testnet key)");
    const account = privateKeyToAccount(pk as `0x${string}`);
    return { account, mode: "local", address: account.address };
  }

  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("privy mode requires PRIVY_APP_ID and PRIVY_APP_SECRET");
  }
  const authKey = process.env.PRIVY_AUTHORIZATION_KEY;
  const privy = new PrivyClient(
    appId,
    appSecret,
    authKey ? { walletApi: { authorizationPrivateKey: authKey } } : undefined,
  );

  let walletId = process.env.PRIVY_WALLET_ID;
  let address = process.env.PRIVY_WALLET_ADDRESS;
  if (!walletId || !address) {
    const wallet = await privy.walletApi.createWallet({ chainType: "ethereum" });
    walletId = wallet.id;
    address = wallet.address;
    console.log(
      `[agent] created Privy wallet ${walletId} (${address}).\n` +
        `        Fund it with Base-Sepolia USDC, then set PRIVY_WALLET_ID and ` +
        `PRIVY_WALLET_ADDRESS to reuse it.`,
    );
  }

  const account = await createViemAccount({
    walletId,
    address: address as `0x${string}`,
    // Cast around a known dual-declaration (.d.ts vs .d.mts) type-identity quirk
    // in @privy-io/server-auth; the runtime value is the correct PrivyClient.
    privy: privy as unknown as Parameters<typeof createViemAccount>[0]["privy"],
  });
  return { account, mode: "privy", address };
}
