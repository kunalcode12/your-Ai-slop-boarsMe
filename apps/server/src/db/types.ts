/**
 * Hand-written `Database` type for the Supabase JS client generics.
 *
 * Enum columns reuse the unions from @slop/shared so the DB layer and the wire
 * contracts can never drift. (You may later replace this file with
 * `supabase gen types typescript` output — see supabase/README.md.)
 */

import type {
  PromptType,
  AnswerType,
  PromptStatus,
  CreditChangeReason,
} from "@slop/shared";

// Report enums are DB-local (not part of the wire contract yet).
export type ReportTargetType = "prompt" | "answer";
export type ReportStatus = "open" | "actioned" | "dismissed";

// ---------------------------------------------------------------------------
// Row shapes (snake_case, exactly as stored). timestamptz -> ISO string.
// ---------------------------------------------------------------------------

// NOTE: these are `type` aliases, not `interface`s, on purpose. Interfaces have
// no implicit index signature and so are NOT assignable to `Record<string,
// unknown>`, which is what Supabase's `GenericTable` constraint requires for
// `Row`/`Insert`/`Update`. Using `type` keeps the schema satisfying GenericSchema
// (otherwise the client silently degrades to `never`). Generated supabase types
// use `type` for the same reason.

export type PlayerRow = {
  id: string;
  wallet_pubkey: string;
  credits_cached: number;
  last_refill_at: string;
  answers_given: number;
  prompts_sent: number;
  reputation: number;
  claim_cooldown_until: string | null;
  banned: boolean;
  created_at: string;
};

export type PromptRow = {
  id: string;
  requester_id: string;
  type: PromptType;
  body: string;
  status: PromptStatus;
  credits_cost: number;
  claimed_by: string | null;
  claimed_at: string | null;
  expires_at: string;
  created_at: string;
};

export type AnswerRow = {
  id: string;
  prompt_id: string;
  answerer_id: string;
  type: AnswerType;
  body_text: string | null;
  image_url: string | null;
  time_taken_ms: number;
  delivered: boolean;
  flagged: boolean;
  created_at: string;
};

export type CreditLedgerRow = {
  id: string;
  player_id: string;
  delta: number;
  reason: CreditChangeReason;
  onchain_sig: string | null;
  created_at: string;
};

export type ReportRow = {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  reporter_id: string;
  reason: string | null;
  status: ReportStatus;
  created_at: string;
};

export type SessionRow = {
  id: string;
  player_id: string;
  session_pubkey: string;
  expires_at: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Insert/Update helpers — columns with DB defaults are optional on insert.
// ---------------------------------------------------------------------------

type PlayerInsert = { wallet_pubkey: string } & Partial<
  Omit<PlayerRow, "wallet_pubkey">
>;
type PromptInsert = Pick<
  PromptRow,
  "requester_id" | "type" | "body" | "credits_cost" | "expires_at"
> &
  Partial<Omit<PromptRow, "requester_id" | "type" | "body" | "credits_cost" | "expires_at">>;
type AnswerInsert = Pick<
  AnswerRow,
  "prompt_id" | "answerer_id" | "type"
> &
  Partial<Omit<AnswerRow, "prompt_id" | "answerer_id" | "type">>;
type CreditLedgerInsert = Pick<CreditLedgerRow, "player_id" | "delta" | "reason"> &
  Partial<Omit<CreditLedgerRow, "player_id" | "delta" | "reason">>;
type ReportInsert = Pick<ReportRow, "target_type" | "target_id" | "reporter_id"> &
  Partial<Omit<ReportRow, "target_type" | "target_id" | "reporter_id">>;
type SessionInsert = Pick<SessionRow, "player_id" | "session_pubkey" | "expires_at"> &
  Partial<Omit<SessionRow, "player_id" | "session_pubkey" | "expires_at">>;

interface TableDef<Row, Insert> {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
}

// ---------------------------------------------------------------------------
// Database — fed to createClient<Database>(...)
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      players: TableDef<PlayerRow, PlayerInsert>;
      prompts: TableDef<PromptRow, PromptInsert>;
      answers: TableDef<AnswerRow, AnswerInsert>;
      credit_ledger: TableDef<CreditLedgerRow, CreditLedgerInsert>;
      reports: TableDef<ReportRow, ReportInsert>;
      sessions: TableDef<SessionRow, SessionInsert>;
    };
    Views: Record<string, never>;
    Functions: {
      apply_credit_delta: {
        Args: {
          p_player_id: string;
          p_delta: number;
          p_reason: CreditChangeReason;
          p_onchain_sig?: string | null;
        };
        Returns: number;
      };
      adjust_reputation: {
        Args: { p_player_id: string; p_delta: number };
        Returns: number;
      };
      create_prompt: {
        Args: {
          p_requester_id: string;
          p_type: PromptType;
          p_body: string;
          p_credits_cost: number;
          p_expires_at: string;
        };
        Returns: PromptRow[];
      };
      claim_next_prompt: {
        Args: { p_answerer_id: string };
        Returns: PromptRow[];
      };
      submit_answer: {
        Args: {
          p_prompt_id: string;
          p_answerer_id: string;
          p_type: AnswerType;
          p_body_text: string | null;
          p_image_url: string | null;
          p_time_taken_ms: number;
          p_time_limit_ms: number;
        };
        Returns: AnswerRow[];
      };
      expire_stale_prompts: {
        Args: Record<string, never>;
        Returns: PromptRow[];
      };
      get_undelivered_answers_for_requester: {
        Args: { p_requester_id: string };
        Returns: AnswerRow[];
      };
      hide_target_if_over_threshold: {
        Args: {
          p_target_type: ReportTargetType;
          p_target_id: string;
          p_threshold: number;
        };
        Returns: boolean;
      };
    };
    Enums: {
      prompt_type: PromptType;
      answer_type: AnswerType;
      prompt_status: PromptStatus;
      credit_reason: CreditChangeReason;
      report_target: ReportTargetType;
      report_status: ReportStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
