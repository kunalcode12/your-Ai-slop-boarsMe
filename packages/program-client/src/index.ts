/**
 * @slop/program-client — typed client for the credits Anchor program.
 *
 * The backend (apps/server) instantiates `CreditsClient` with a devnet Connection
 * and the SERVER keypair (which must equal `Config.server_authority`). In plain
 * devnet mode the server signs every credit mutation on the player's behalf, so
 * users never see a wallet popup. ER/session-key helpers are present but only
 * functional once the program + IDL are rebuilt with `--features er` (see README).
 *
 * (Optional future migration: @solana/kit + Codama. Not required now — this uses
 * @coral-xyz/anchor + web3.js v1 for the fastest reliable path.)
 */

import { AnchorProvider, Program, BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  type Commitment,
  type TransactionSignature,
} from "@solana/web3.js";
import {
  CREDIT_COST_TEXT,
  CREDIT_COST_IMAGE,
  REFILL_AMOUNT,
  REFILL_INTERVAL_MS,
  MAX_CREDITS,
  STARTING_CREDITS,
} from "@slop/shared";
import type { Credits } from "./credits";

// Loaded at runtime (kept out of tsc's rootDir on purpose). dist/index.js -> ../idl.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const idl = require("../idl/credits.json") as Credits;

export type { Credits } from "./credits";
export { BN } from "@coral-xyz/anchor";

export const CONFIG_SEED = Buffer.from("config");
export const PLAYER_SEED = Buffer.from("player");

/** Decoded Player account (credits are small, safely represented as numbers). */
export interface PlayerAccount {
  authority: PublicKey;
  balance: number;
  /** Unix seconds of the last refill. */
  lastRefill: number;
  answersGiven: number;
  promptsSent: number;
  bump: number;
}

export interface CreditsConfigParams {
  serverAuthority: PublicKey;
  creditCostText: number;
  creditCostImage: number;
  refillAmount: number;
  refillIntervalSecs: number;
  maxCredits: number;
  startingBalance: number;
}

/**
 * Config params derived from @slop/shared (the canonical source for these
 * numbers). Note the program stores the refill interval in SECONDS while shared
 * expresses it in MS.
 */
export function defaultConfigParams(serverAuthority: PublicKey): CreditsConfigParams {
  return {
    serverAuthority,
    creditCostText: CREDIT_COST_TEXT,
    creditCostImage: CREDIT_COST_IMAGE,
    refillAmount: REFILL_AMOUNT,
    refillIntervalSecs: Math.floor(REFILL_INTERVAL_MS / 1000),
    maxCredits: MAX_CREDITS,
    startingBalance: STARTING_CREDITS,
  };
}

export interface CreditsClientOptions {
  commitment?: Commitment;
  /** MagicBlock ephemeral-rollup RPC. When set, ER helpers can route txs there. */
  ephemeralRpcUrl?: string;
}

/** MagicBlock fixed accounts needed by commit/undelegate (ER mode). */
export interface MagicAccounts {
  magicContext: PublicKey;
  magicProgram: PublicKey;
}

export class CreditsClient {
  readonly connection: Connection;
  readonly program: Program<Credits>;
  readonly serverKeypair: Keypair;
  readonly programId: PublicKey;
  private readonly ephemeralConnection: Connection | null;
  private readonly commitment: Commitment;

  constructor(
    connection: Connection,
    serverKeypair: Keypair,
    opts: CreditsClientOptions = {},
  ) {
    this.connection = connection;
    this.serverKeypair = serverKeypair;
    this.commitment = opts.commitment ?? "confirmed";

    const provider = new AnchorProvider(connection, new Wallet(serverKeypair), {
      commitment: this.commitment,
    });
    this.program = new Program<Credits>(idl, provider);
    this.programId = this.program.programId;
    this.ephemeralConnection = opts.ephemeralRpcUrl
      ? new Connection(opts.ephemeralRpcUrl, this.commitment)
      : null;
  }

  // -------------------------------------------------------------------------
  // PDAs
  // -------------------------------------------------------------------------

  configPda(): PublicKey {
    return PublicKey.findProgramAddressSync([CONFIG_SEED], this.programId)[0];
  }

  playerPda(authority: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [PLAYER_SEED, authority.toBuffer()],
      this.programId,
    )[0];
  }

  private mutateAccounts(authority: PublicKey) {
    return {
      config: this.configPda(),
      player: this.playerPda(authority),
      signer: this.serverKeypair.publicKey,
    };
  }

  // -------------------------------------------------------------------------
  // Admin / lifecycle
  // -------------------------------------------------------------------------

  /** Initialize the singleton Config (admin = server keypair). Run once. */
  async initConfig(params: CreditsConfigParams): Promise<TransactionSignature> {
    return this.program.methods
      .initConfig({
        serverAuthority: params.serverAuthority,
        creditCostText: new BN(params.creditCostText),
        creditCostImage: new BN(params.creditCostImage),
        refillAmount: new BN(params.refillAmount),
        refillInterval: new BN(params.refillIntervalSecs),
        maxCredits: new BN(params.maxCredits),
        startingBalance: new BN(params.startingBalance),
      })
      .accountsPartial({
        config: this.configPda(),
        admin: this.serverKeypair.publicKey,
      })
      .rpc();
  }

  /** Create a Player PDA for `authority` (signed by server_authority). */
  async initPlayer(authority: PublicKey): Promise<TransactionSignature> {
    return this.program.methods
      .initPlayer()
      .accountsPartial({
        config: this.configPda(),
        player: this.playerPda(authority),
        authority,
        signer: this.serverKeypair.publicKey,
      })
      .rpc();
  }

  // -------------------------------------------------------------------------
  // Credit movements (server signs as referee in plain mode)
  // -------------------------------------------------------------------------

  async refill(authority: PublicKey): Promise<TransactionSignature> {
    return this.program.methods
      .refill()
      .accountsPartial(this.mutateAccounts(authority))
      .rpc();
  }

  async spend(authority: PublicKey, amount: number): Promise<TransactionSignature> {
    return this.program.methods
      .spend(new BN(amount))
      .accountsPartial(this.mutateAccounts(authority))
      .rpc();
  }

  async earn(authority: PublicKey): Promise<TransactionSignature> {
    return this.program.methods
      .earn()
      .accountsPartial(this.mutateAccounts(authority))
      .rpc();
  }

  async refund(authority: PublicKey, amount: number): Promise<TransactionSignature> {
    return this.program.methods
      .refund(new BN(amount))
      .accountsPartial(this.mutateAccounts(authority))
      .rpc();
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getPlayer(authority: PublicKey): Promise<PlayerAccount | null> {
    const acc = await this.program.account.player.fetchNullable(
      this.playerPda(authority),
    );
    if (!acc) return null;
    return {
      authority: acc.authority,
      balance: acc.balance.toNumber(),
      lastRefill: acc.lastRefill.toNumber(),
      answersGiven: acc.answersGiven.toNumber(),
      promptsSent: acc.promptsSent.toNumber(),
      bump: acc.bump,
    };
  }

  async getConfig() {
    return this.program.account.config.fetchNullable(this.configPda());
  }

  // -------------------------------------------------------------------------
  // ER mode helpers (deferred). Functional ONLY when the program + IDL were
  // built with `--features er` and the regenerated IDL copied back into this
  // package. Until then these throw a clear error — the app runs on plain devnet.
  // -------------------------------------------------------------------------

  /** Whether the loaded IDL includes the ER delegation instructions. */
  get erEnabled(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof (this.program.methods as any).delegatePlayer === "function";
  }

  private assertEr(): void {
    if (!this.erEnabled) {
      throw new Error(
        "ER mode not enabled: rebuild programs/credits with `--features er`, " +
          "regenerate the IDL, and copy it into @slop/program-client/idl.",
      );
    }
  }

  /** The MagicBlock ephemeral-rollup connection (throws if not configured). */
  ephemeral(): Connection {
    if (!this.ephemeralConnection) {
      throw new Error("ephemeralRpcUrl was not provided to CreditsClient.");
    }
    return this.ephemeralConnection;
  }

  /** Delegate a Player PDA to the ephemeral rollup (ER mode). */
  async delegatePlayer(
    authority: PublicKey,
    validator?: PublicKey,
  ): Promise<TransactionSignature> {
    this.assertEr();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = this.program.methods as any;
    const builder = methods
      .delegatePlayer()
      .accountsPartial({
        payer: this.serverKeypair.publicKey,
        authority,
        pda: this.playerPda(authority),
      });
    if (validator) builder.remainingAccounts([{ pubkey: validator, isSigner: false, isWritable: false }]);
    return builder.rpc();
  }

  /** Commit a delegated Player PDA's state back to devnet (stays delegated). */
  async commitPlayer(
    authority: PublicKey,
    magic: MagicAccounts,
  ): Promise<TransactionSignature> {
    this.assertEr();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .commitPlayer()
      .accountsPartial({
        payer: this.serverKeypair.publicKey,
        player: this.playerPda(authority),
        magicContext: magic.magicContext,
        magicProgram: magic.magicProgram,
      })
      .rpc();
  }

  /** Commit + undelegate a Player PDA (return ownership to this program). */
  async undelegatePlayer(
    authority: PublicKey,
    magic: MagicAccounts,
  ): Promise<TransactionSignature> {
    this.assertEr();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .undelegatePlayer()
      .accountsPartial({
        payer: this.serverKeypair.publicKey,
        player: this.playerPda(authority),
        magicContext: magic.magicContext,
        magicProgram: magic.magicProgram,
      })
      .rpc();
  }
}
