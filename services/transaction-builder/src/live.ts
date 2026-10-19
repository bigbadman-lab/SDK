import { Connection, PublicKey } from "@solana/web3.js";

import { AssembleError, type AssembledLaunch } from "./assemble.ts";
import { assembleLiveBuy } from "./chain.ts";
import type { Produced } from "./handle.ts";
import { simulateUnsignedTransaction } from "./simulate.ts";

export function createLiveProducer(connection: Connection) {
  return async function produce(input: {
    launch: { tokenName: string; tokenSymbol: string; metadataUri: string | null; walletAddress: string; buyAmount: string; slippageBps: number | null };
    identity: { shareholders: AssembledLaunch["shareholders"] };
    mint: PublicKey;
    parentMint: string;
    registeredTokenProgram: string | null;
  }): Promise<{ ok: true; produced: Produced } | { ok: false; code: string }> {
    try {
      if (!input.launch.metadataUri) return { ok: false, code: "not_ready" };
      const latest = await connection.getLatestBlockhash("confirmed");
      const assembled = await assembleLiveBuy({
        connection,
        parentMint: input.parentMint,
        registeredTokenProgram: input.registeredTokenProgram,
        launcher: new PublicKey(input.launch.walletAddress),
        mint: input.mint,
        name: input.launch.tokenName,
        symbol: input.launch.tokenSymbol,
        uri: input.launch.metadataUri,
        shareholders: input.identity.shareholders,
        blockhash: latest.blockhash,
        lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
        buyAmount: input.launch.buyAmount,
        slippageBps: input.launch.slippageBps,
      });
      const simulationOk = await simulateUnsignedTransaction(connection.rpcEndpoint, assembled.transaction);
      return {
        ok: true,
        produced: {
          transaction: assembled.transaction,
          transactionVersion: assembled.transactionVersion,
          encoding: assembled.encoding,
          messageHash: assembled.messageHash,
          byteLength: assembled.byteLength,
          accountCount: assembled.accountCount,
          fitsPacket: assembled.fitsPacket,
          roles: assembled.roles,
          signers: assembled.signers,
          blockhash: latest.blockhash,
          coverage: assembled.coverage,
          simulationOk,
          parentMint: assembled.quoteMint,
        },
      };
    } catch (error) {
      const code = error instanceof AssembleError ? error.code : "parent_ineligible";
      return { ok: false, code };
    }
  };
}
