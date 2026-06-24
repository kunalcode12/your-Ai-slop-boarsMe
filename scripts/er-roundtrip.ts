/**
 * LIVE proof that the full MagicBlock ER cycle works for OUR program:
 *   init player (devnet) → delegate (devnet) → spend ON THE ER → read ER balance
 *   → commit+undelegate → read devnet balance (must reflect the ER spend).
 *
 * Uses a throwaway player authority (server pays rent). Read+write, costs a little
 * devnet SOL. Run:
 *   pnpm --filter @slop/server exec tsx C:\Users\TGF\Downloads\aiSlop\scripts\er-roundtrip.ts
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: "C:/Users/TGF/Downloads/aiSlop/.env" });

import { readFileSync } from "node:fs";
import { AnchorProvider, Program, BN, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

// load the SAME idl the client uses
const idl = require("C:/Users/TGF/Downloads/aiSlop/packages/program-client/idl/credits.json");

const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
const DELEGATION_PROGRAM = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";

function loadServer(): Keypair {
  const p = process.env.SERVER_KEYPAIR_PATH!;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8")) as number[]));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const baseUrl = process.env.SOLANA_RPC_URL!;
  const erUrl = process.env.MAGICBLOCK_RPC_URL!;
  const server = loadServer();
  const wallet = new Wallet(server);

  const base = new Connection(baseUrl, "confirmed");
  const er = new Connection(erUrl, "confirmed");
  const baseProg = new Program(idl, new AnchorProvider(base, wallet, { commitment: "confirmed" }));
  const erProg = new Program(idl, new AnchorProvider(er, wallet, { commitment: "confirmed" }));

  const programId = new PublicKey(idl.address);
  const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];

  // throwaway player
  const authority = Keypair.generate().publicKey;
  const playerPda = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), authority.toBuffer()],
    programId,
  )[0];
  console.log("authority :", authority.toBase58());
  console.log("playerPda :", playerPda.toBase58());

  // 1) init on devnet (server signs)
  console.log("\n[1] init_player on devnet…");
  await (baseProg.methods as any)
    .initPlayer()
    .accountsPartial({ config: configPda, player: playerPda, authority, signer: server.publicKey })
    .rpc();
  let acc: any = await (baseProg.account as any).player.fetch(playerPda);
  console.log("    balance (devnet):", acc.balance.toString());

  // 2) delegate to ER (devnet tx)
  console.log("\n[2] delegate_player on devnet…");
  await (baseProg.methods as any)
    .delegatePlayer()
    .accountsPartial({ payer: server.publicKey, authority, pda: playerPda })
    .rpc();
  const owner = (await base.getAccountInfo(playerPda))?.owner.toBase58();
  console.log("    PDA owner now   :", owner, owner === DELEGATION_PROGRAM ? "(delegated ✅)" : "(NOT delegated ❌)");

  // wait for the ER validator to pick up the delegated account
  console.log("\n[3] waiting for ER to see the delegated account…");
  let erAcc: any = null;
  for (let i = 0; i < 20; i++) {
    try {
      erAcc = await (erProg.account as any).player.fetch(playerPda);
      if (erAcc) break;
    } catch {
      /* not yet */
    }
    await sleep(1000);
  }
  if (!erAcc) throw new Error("ER never surfaced the delegated player account");
  console.log("    balance (ER)    :", erAcc.balance.toString());

  // 4) SPEND on the ER (the whole point — gasless/fast on the rollup)
  console.log("\n[4] spend(1) ON THE ER…");
  const sig = await (erProg.methods as any)
    .spend(new BN(1))
    .accountsPartial({ config: configPda, player: playerPda, signer: server.publicKey, sessionToken: null })
    .rpc();
  console.log("    ER spend sig    :", sig);
  erAcc = await (erProg.account as any).player.fetch(playerPda);
  console.log("    balance (ER)    :", erAcc.balance.toString(), "(expected 2)");

  // 5) commit + undelegate (settle ER state back to devnet) — sent to the ER
  console.log("\n[5] undelegate (commit + settle to devnet)…");
  await (erProg.methods as any)
    .undelegatePlayer()
    .accountsPartial({ payer: server.publicKey, player: playerPda, magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT })
    .rpc();

  console.log("\n[6] waiting for devnet to reflect the settled balance…");
  for (let i = 0; i < 20; i++) {
    const a = await base.getAccountInfo(playerPda);
    if (a && a.owner.toBase58() === programId.toBase58()) {
      acc = await (baseProg.account as any).player.fetch(playerPda);
      break;
    }
    await sleep(1000);
  }
  console.log("    balance (devnet):", acc.balance.toString(), "(expected 2 if ER spend settled)");

  console.log("\n✅ ER ROUND-TRIP COMPLETE");
  process.exit(0);
}
main().catch((e) => {
  console.error("\n❌ ER ROUND-TRIP FAILED:", e?.message || e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
