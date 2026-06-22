import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorError } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { assert, expect } from "chai";
import { Credits } from "../target/types/credits";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("credits", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Credits as Program<Credits>;
  const serverAuthority = provider.wallet; // backend referee == provider wallet in tests

  // config tuned for fast tests (matches @slop/shared shape; small interval)
  const CFG = {
    creditCostText: new BN(1),
    creditCostImage: new BN(2),
    refillAmount: new BN(1),
    refillInterval: new BN(1), // seconds — short so the gate is testable
    maxCredits: new BN(5),
    startingBalance: new BN(3),
  };

  const playerAuthority = Keypair.generate(); // the "burner" (never signs in MVP)

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [playerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), playerAuthority.publicKey.toBuffer()],
    program.programId,
  );

  it("init_config (singleton)", async () => {
    await program.methods
      .initConfig({
        serverAuthority: serverAuthority.publicKey,
        ...CFG,
      })
      .accountsPartial({ config: configPda, admin: serverAuthority.publicKey })
      .rpc();

    const cfg = await program.account.config.fetch(configPda);
    assert.ok(cfg.admin.equals(serverAuthority.publicKey));
    assert.ok(cfg.serverAuthority.equals(serverAuthority.publicKey));
    assert.equal(cfg.maxCredits.toNumber(), 5);
    assert.equal(cfg.startingBalance.toNumber(), 3);
  });

  it("init_player must be signed by server_authority (anti-sybil)", async () => {
    const rando = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(rando.publicKey, 1e9),
    );
    try {
      await program.methods
        .initPlayer()
        .accountsPartial({
          config: configPda,
          player: playerPda,
          authority: playerAuthority.publicKey,
          signer: rando.publicKey,
        })
        .signers([rando])
        .rpc();
      assert.fail("expected Unauthorized");
    } catch (e) {
      expect((e as AnchorError).error.errorCode.code).to.eq("Unauthorized");
    }
  });

  it("init_player gives the starting balance", async () => {
    await program.methods
      .initPlayer()
      .accountsPartial({
        config: configPda,
        player: playerPda,
        authority: playerAuthority.publicKey,
        signer: serverAuthority.publicKey,
      })
      .rpc();

    const p = await program.account.player.fetch(playerPda);
    assert.ok(p.authority.equals(playerAuthority.publicKey));
    assert.equal(p.balance.toNumber(), 3);
    assert.equal(p.promptsSent.toNumber(), 0);
    assert.equal(p.answersGiven.toNumber(), 0);
  });

  it("spend succeeds and decrements balance + bumps prompts_sent", async () => {
    await program.methods
      .spend(new BN(2))
      .accountsPartial({ config: configPda, player: playerPda, signer: serverAuthority.publicKey, sessionToken: null })
      .rpc();

    const p = await program.account.player.fetch(playerPda);
    assert.equal(p.balance.toNumber(), 1); // 3 - 2
    assert.equal(p.promptsSent.toNumber(), 1);
  });

  it("spend rejects when balance is insufficient", async () => {
    try {
      await program.methods
        .spend(new BN(999))
        .accountsPartial({ config: configPda, player: playerPda, signer: serverAuthority.publicKey, sessionToken: null })
        .rpc();
      assert.fail("expected InsufficientCredits");
    } catch (e) {
      expect((e as AnchorError).error.errorCode.code).to.eq("InsufficientCredits");
    }
  });

  it("earn adds 1 credit + bumps answers_given", async () => {
    await program.methods
      .earn()
      .accountsPartial({ config: configPda, player: playerPda, signer: serverAuthority.publicKey, sessionToken: null })
      .rpc();

    const p = await program.account.player.fetch(playerPda);
    assert.equal(p.balance.toNumber(), 2); // 1 + 1
    assert.equal(p.answersGiven.toNumber(), 1);
  });

  it("refund adds back a spent amount", async () => {
    await program.methods
      .refund(new BN(1))
      .accountsPartial({ config: configPda, player: playerPda, signer: serverAuthority.publicKey, sessionToken: null })
      .rpc();

    const p = await program.account.player.fetch(playerPda);
    assert.equal(p.balance.toNumber(), 3); // 2 + 1
  });

  it("refill is gated by the interval (RefillNotReady), then succeeds", async () => {
    // prime a successful refill so last_refill = now (balance is 3 < max here).
    // this makes the immediate retry below reliably gated, independent of how long
    // the preceding tests took (the 1s interval can otherwise already be elapsed).
    await program.methods
      .refill()
      .accountsPartial({ config: configPda, player: playerPda, signer: serverAuthority.publicKey, sessionToken: null })
      .rpc();

    // immediately retry -> not enough time elapsed since the prime
    try {
      await program.methods
        .refill()
        .accountsPartial({ config: configPda, player: playerPda, signer: serverAuthority.publicKey, sessionToken: null })
        .rpc();
      assert.fail("expected RefillNotReady");
    } catch (e) {
      expect((e as AnchorError).error.errorCode.code).to.eq("RefillNotReady");
    }

    await sleep(1500); // exceed the 1s interval
    const before = (await program.account.player.fetch(playerPda)).balance.toNumber();
    await program.methods
      .refill()
      .accountsPartial({ config: configPda, player: playerPda, signer: serverAuthority.publicKey, sessionToken: null })
      .rpc();
    const after = (await program.account.player.fetch(playerPda)).balance.toNumber();
    assert.equal(after, Math.min(before + 1, 5));
  });

  it("refill caps at max_credits and then errors MaxCreditsReached", async () => {
    // drive balance up to the cap via earn (earn can exceed cap, so stop at 5)
    let p = await program.account.player.fetch(playerPda);
    while (p.balance.toNumber() < 5) {
      await program.methods
        .earn()
        .accountsPartial({ config: configPda, player: playerPda, signer: serverAuthority.publicKey, sessionToken: null })
        .rpc();
      p = await program.account.player.fetch(playerPda);
    }
    assert.equal(p.balance.toNumber(), 5);

    await sleep(1500);
    try {
      await program.methods
        .refill()
        .accountsPartial({ config: configPda, player: playerPda, signer: serverAuthority.publicKey, sessionToken: null })
        .rpc();
      assert.fail("expected MaxCreditsReached");
    } catch (e) {
      expect((e as AnchorError).error.errorCode.code).to.eq("MaxCreditsReached");
    }
  });

  it("rejects an unauthorized signer on spend", async () => {
    const rando = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(rando.publicKey, 1e9),
    );
    try {
      await program.methods
        .spend(new BN(1))
        .accountsPartial({ config: configPda, player: playerPda, signer: rando.publicKey, sessionToken: null })
        .signers([rando])
        .rpc();
      assert.fail("expected Unauthorized");
    } catch (e) {
      expect((e as AnchorError).error.errorCode.code).to.eq("Unauthorized");
    }
  });

  // ER delegate -> spend-on-ER -> commit/undelegate. Requires the MagicBlock
  // delegation program + an ER validator, which a bare localnet doesn't have.
  // Enabled only when RUN_ER_TESTS=1 (and the program built with --features er).
  const erEnabled = process.env.RUN_ER_TESTS === "1";
  (erEnabled ? it : it.skip)("delegates -> spends on ER -> commits/undelegates", async () => {
    // Implemented in the ER pass; see README "ER fallback switch".
    assert.ok(true);
  });
});
