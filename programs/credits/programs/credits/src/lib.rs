//! your ai slop bores me — on-chain credit economy.
//!
//! This program is the SOURCE OF TRUTH for player credit balances. Everything
//! else (queue, prompts, drawings, timers) is off-chain; only credits live here.
//!
//! TRUST MODEL (MVP / plain devnet)
//! --------------------------------
//! `Config.server_authority` is the backend's keypair. It is the trusted referee:
//!   * `init_player` may ONLY be signed by `server_authority` (anti-sybil: stops
//!     anyone from minting free starting credits into keypairs they generate).
//!   * `refill`/`spend`/`earn`/`refund` accept EITHER the player's own authority
//!     (or its session key, in ER mode) OR the `server_authority`. In plain MVP
//!     mode the backend signs these on the player's behalf so users never see a
//!     wallet popup. As we move to ER + session keys the player can sign directly.
//! Costs/intervals/caps are seeded from @slop/shared constants at `init_config`
//! time — @slop/shared remains the canonical reference for those numbers.
//!
//! EPHEMERAL ROLLUP (ER) FALLBACK SWITCH
//! ------------------------------------
//! The core program compiles and runs on PLAIN DEVNET with no MagicBlock deps.
//! Delegation / commit / undelegate live behind the `er` Cargo feature (see the
//! bottom of this file). PROMPT 4 runs plain-devnet mode first; ER is a separate,
//! opt-in pass. The app must never be blocked on ER.

use anchor_lang::prelude::*;

#[cfg(feature = "er")]
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
#[cfg(feature = "er")]
use ephemeral_rollups_sdk::cpi::DelegateConfig;
#[cfg(feature = "er")]
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("FunwpPA4fah5czxHfhbDD6iQE9L3wPUvuEzUkd5gL6Fv");

pub const CONFIG_SEED: &[u8] = b"config";
pub const PLAYER_SEED: &[u8] = b"player";

// `#[ephemeral]` (ER mode only) injects the undelegation callback handler the
// MagicBlock delegation program calls when committing state back to devnet.
#[cfg_attr(feature = "er", ephemeral)]
#[program]
pub mod credits {
    use super::*;

    /// Initialize the singleton Config PDA. Callable once. The signer becomes admin.
    pub fn init_config(ctx: Context<InitConfig>, args: InitConfigArgs) -> Result<()> {
        require!(
            args.max_credits > 0 && args.refill_interval > 0,
            CreditsError::InvalidConfig
        );

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.server_authority = args.server_authority;
        config.credit_cost_text = args.credit_cost_text;
        config.credit_cost_image = args.credit_cost_image;
        config.refill_amount = args.refill_amount;
        config.refill_interval = args.refill_interval;
        config.max_credits = args.max_credits;
        config.starting_balance = args.starting_balance;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Create a Player PDA for `authority` with a small starting balance.
    /// MUST be signed by `server_authority` (anti-sybil — see trust model above).
    pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            ctx.accounts.signer.key(),
            config.server_authority,
            CreditsError::Unauthorized
        );

        let player = &mut ctx.accounts.player;
        player.authority = ctx.accounts.authority.key();
        player.balance = config.starting_balance;
        player.last_refill = Clock::get()?.unix_timestamp;
        player.answers_given = 0;
        player.prompts_sent = 0;
        player.bump = ctx.bumps.player;
        Ok(())
    }

    /// Passive refill: if at least `refill_interval` seconds have elapsed, add
    /// `refill_amount` (clamped to `max_credits`) and reset the clock.
    pub fn refill(ctx: Context<Mutate>) -> Result<()> {
        let config = &ctx.accounts.config;
        require_authorized(&ctx.accounts.signer, &ctx.accounts.player, config)?;

        let player = &mut ctx.accounts.player;
        require!(player.balance < config.max_credits, CreditsError::MaxCreditsReached);

        let now = Clock::get()?.unix_timestamp;
        let elapsed = now
            .checked_sub(player.last_refill)
            .ok_or(CreditsError::MathOverflow)?;
        require!(elapsed >= config.refill_interval, CreditsError::RefillNotReady);

        let raised = player
            .balance
            .checked_add(config.refill_amount)
            .ok_or(CreditsError::MathOverflow)?;
        player.balance = raised.min(config.max_credits);
        player.last_refill = now;
        Ok(())
    }

    /// Spend `amount` credits (a prompt submission). Errors if balance is too low.
    pub fn spend(ctx: Context<Mutate>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require_authorized(&ctx.accounts.signer, &ctx.accounts.player, config)?;

        let player = &mut ctx.accounts.player;
        require!(player.balance >= amount, CreditsError::InsufficientCredits);

        player.balance = player
            .balance
            .checked_sub(amount)
            .ok_or(CreditsError::MathOverflow)?;
        player.prompts_sent = player
            .prompts_sent
            .checked_add(1)
            .ok_or(CreditsError::MathOverflow)?;
        Ok(())
    }

    /// Earn 1 credit for an accepted answer. Earned credits may exceed the refill
    /// cap (the cap only limits passive accrual; you actively earned these).
    pub fn earn(ctx: Context<Mutate>) -> Result<()> {
        let config = &ctx.accounts.config;
        require_authorized(&ctx.accounts.signer, &ctx.accounts.player, config)?;

        let player = &mut ctx.accounts.player;
        player.balance = player
            .balance
            .checked_add(1)
            .ok_or(CreditsError::MathOverflow)?;
        player.answers_given = player
            .answers_given
            .checked_add(1)
            .ok_or(CreditsError::MathOverflow)?;
        Ok(())
    }

    /// Refund `amount` previously-spent credits (an unclaimed prompt expired).
    pub fn refund(ctx: Context<Mutate>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require_authorized(&ctx.accounts.signer, &ctx.accounts.player, config)?;

        let player = &mut ctx.accounts.player;
        player.balance = player
            .balance
            .checked_add(amount)
            .ok_or(CreditsError::MathOverflow)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // ER MODE instructions (feature = "er"). Delegate a Player PDA to the
    // ephemeral rollup, commit its state back to devnet, and undelegate.
    // While delegated, spend/earn execute on the ER (gasless, ~<50ms) against
    // the same account; state settles to devnet on commit/undelegate.
    // -----------------------------------------------------------------------

    /// Delegate the Player PDA to the ephemeral rollup.
    #[cfg(feature = "er")]
    pub fn delegate_player(ctx: Context<DelegatePlayer>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[PLAYER_SEED, ctx.accounts.authority.key.as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Commit the delegated Player PDA's current state back to devnet (stays delegated).
    #[cfg(feature = "er")]
    pub fn commit_player(ctx: Context<CommitPlayer>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.player.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Commit and undelegate the Player PDA (return ownership to this program on devnet).
    #[cfg(feature = "er")]
    pub fn undelegate_player(ctx: Context<CommitPlayer>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.player.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Authority helper
// ---------------------------------------------------------------------------

/// spend/earn/refund/refill are authorized by the player's own authority OR the
/// trusted server authority. (In ER mode a registered session key signs as the
/// authority — see SESSION KEYS note below.)
fn require_authorized(signer: &Signer, player: &Player, config: &Config) -> Result<()> {
    let k = signer.key();
    require!(
        k == player.authority || k == config.server_authority,
        CreditsError::Unauthorized
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPlayer<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = signer,
        space = 8 + Player::INIT_SPACE,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,
    /// CHECK: only used as the PDA seed and recorded as the player's authority.
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Shared accounts for refill/spend/earn/refund. `player` is located via its own
/// stored `authority`, so the backend doesn't need to pass it separately.
#[derive(Accounts)]
pub struct Mutate<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PLAYER_SEED, player.authority.as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,
    pub signer: Signer<'info>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub server_authority: Pubkey,
    pub credit_cost_text: u64,
    pub credit_cost_image: u64,
    pub refill_amount: u64,
    pub refill_interval: i64,
    pub max_credits: u64,
    pub starting_balance: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub authority: Pubkey,
    pub balance: u64,
    pub last_refill: i64,
    pub answers_given: u64,
    pub prompts_sent: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitConfigArgs {
    pub server_authority: Pubkey,
    pub credit_cost_text: u64,
    pub credit_cost_image: u64,
    pub refill_amount: u64,
    pub refill_interval: i64,
    pub max_credits: u64,
    pub starting_balance: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum CreditsError {
    #[msg("not enough credits for this action 💀")]
    InsufficientCredits,
    #[msg("refill isn't ready yet, touch grass")]
    RefillNotReady,
    #[msg("signer is not authorized for this action")]
    Unauthorized,
    #[msg("already at max credits")]
    MaxCreditsReached,
    #[msg("arithmetic overflow")]
    MathOverflow,
    #[msg("invalid config parameters")]
    InvalidConfig,
}

// ===========================================================================
// ER MODE accounts (feature = "er")
// ===========================================================================

/// Delegate the Player PDA. `#[delegate]` injects the delegation buffer/record/
/// metadata/program accounts; `del` marks the PDA being delegated.
#[cfg(feature = "er")]
#[delegate]
#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: player authority, used to derive the Player PDA seeds.
    pub authority: AccountInfo<'info>,
    /// CHECK: the Player PDA being delegated (validated by seeds inside the SDK).
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
}

/// Commit / undelegate. `#[commit]` wires the MagicBlock context + program.
#[cfg(feature = "er")]
#[commit]
#[derive(Accounts)]
pub struct CommitPlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the delegated Player PDA whose state is being committed.
    #[account(mut)]
    pub player: AccountInfo<'info>,
    /// CHECK: MagicBlock magic context account.
    pub magic_context: AccountInfo<'info>,
    /// CHECK: MagicBlock magic program.
    pub magic_program: AccountInfo<'info>,
}

// ===========================================================================
// SESSION KEYS (deferred — documented integration)
// ===========================================================================
//
// To let a player approve ONCE and have a session key sign spend/earn on the ER
// without popups, add the MagicBlock `session-keys` crate (latest 3.1.1) and:
// (NOTE: like ephemeral-rollups-sdk 0.15.5, session-keys targets Anchor 1.0 /
//  Solana 3.x — it will not link against anchor-lang 0.32.1. Enabling it requires
//  the same Anchor 1.0 + Solana 3.x migration as the `er` feature.)
//
//   use session_keys::{Session, SessionError, SessionToken, session_auth_or};
//
//   #[derive(Accounts, Session)]
//   pub struct Mutate<'info> {
//       // ...config + player...
//       pub signer: Signer<'info>,
//       #[session(signer = signer, authority = player.authority.key())]
//       pub session_token: Option<Account<'info, SessionToken>>,
//   }
//
//   // on spend/earn:
//   #[session_auth_or(
//       ctx.accounts.player.authority == ctx.accounts.signer.key()
//           || ctx.accounts.config.server_authority == ctx.accounts.signer.key(),
//       CreditsError::Unauthorized
//   )]
//   pub fn spend(ctx: Context<Mutate>, amount: u64) -> Result<()> { /* ... */ }
//
// This is intentionally NOT enabled yet: it alters the spend/earn account layout
// and requires the session-keys program available on the target cluster. It is a
// clean, separable follow-up to the `er` pass and does not block plain devnet.
