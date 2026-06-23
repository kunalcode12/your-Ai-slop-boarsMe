# Moderation & Safety — your ai slop bores me

This is a devnet toy where strangers answer each other in real time, so moderation
is mandatory, not optional. This document describes the policy, the layered
defenses actually implemented, the takedown path, and what production would need.

> TL;DR: hard-blocked content is **never stored** (rejected at creation). Everything
> user-generated stays **off-chain** — the only thing on-chain is an integer credit
> count. Reports + an auto-hide threshold + a protected admin takedown API are the
> second line of defense.

---

## Policy

**Hard-blocked (never created, never stored):**
- Slurs / hate terms (race, sexuality, etc.).
- Sexual content involving minors — zero tolerance. (The wordlist is a crude first
  pass; see "What production needs" for real CSAM handling.)
- Content matching the maintained bla­cklist in
  [`apps/server/src/services/moderation.ts`](apps/server/src/services/moderation.ts).

**Discouraged / removable on report:** harassment, doxxing, spam, anything a
reasonable mod would take down. Handled by reports → auto-hide → manual review.

**Allowed:** edgy/absurd humor, the whole "pretend to be a bored AI" bit. The point
of the app is dumb fun; moderation targets abuse, not vibes.

---

## Defense layers (implemented)

1. **Hard block at creation — content is never persisted.**
   - `submitPrompt` calls `moderation.checkText(body)` *before* spending credits or
     creating the prompt → blocked content returns `moderation_blocked` and **nothing
     is written** (no DB row, no credit charged).
   - `submitAnswer` checks text answers the same way, and decodes/size-checks image
     answers, before any DB write or storage upload.
   - Verified by tests: `hard-blocked prompt is never stored and never charged`.

2. **Minimum-effort gates** — `hasMinEffortText` (rejects empty/punctuation-only) and
   `hasMinEffortDrawing` (rejects near-blank PNGs) stop zero-effort spam. Blocked →
   `moderation_blocked`, and the answerer's claim **survives** so they can submit a
   real answer (tested: `zero-effort answer → moderation_blocked, claim survives`).

3. **Image handling** — drawings are decoded server-side, size-capped at
   `MAX_DRAWING_BYTES` (2 MB), and stored in a **private** Supabase bucket. Delivery
   uses short-lived **signed URLs** (1h). Hiding an answer simply stops minting URLs,
   so the image becomes inaccessible immediately.

4. **User reports + auto-hide.** Any viewer can report a prompt or an answer
   (`report` event). Reports are deduped per `(reporter, target)`. At
   `AUTO_HIDE_REPORT_COUNT` (3) distinct reports a target is auto-hidden
   (`answers.flagged = true` / `prompts.status = 'flagged'`) and the **author** loses
   `REPUTATION_REPORT_PENALTY` (10) reputation — the **author**, never the reporter
   (tested: `reporting an answer past threshold auto-hides it + penalizes the answerer`).
   - **Important nuance:** delivery is ~1:1 (a prompt is shown to one claimer at a
     time; an answer is shown to one requester). So in practice a single piece of
     content is usually seen by **one** person → the auto-hide threshold of 3 is
     rarely reached. **Manual admin review is the primary path for answers**; the
     threshold is a safety net for content that gets seen repeatedly (e.g. a prompt
     re-queued and claimed by several larpers who each report it).

5. **Manual admin takedown (protected REST API).** A human mod reviews and actions
   reports via [`apps/server/src/admin/routes.ts`](apps/server/src/admin/routes.ts):
   - `GET /admin/reports?status=open|actioned|dismissed|all` — list reports with a
     content preview and the author's pubkey.
   - `POST /admin/reports/:id/action` with `{ "action": "dismiss" | "hide" | "ban" }`
     — `dismiss` closes the report; `hide` takes the content down; `ban` takes it down
     **and** bans the author (rejected at the socket handshake thereafter).
   - **Auth:** a single static bearer token, `ADMIN_TOKEN`. If unset, every `/admin`
     route returns `503` (disabled) — safe local default. Tested in
     [`apps/server/test/admin.test.ts`](apps/server/test/admin.test.ts).

6. **Reputation & shadow-throttle.** Ghosting a claim (-5) and upheld reports (-10)
   lower reputation; at/below `REPUTATION_SHADOW_THROTTLE_THRESHOLD` (50) a player is
   shadow-throttled (tighter rate limits, de-prioritised) but still playable.

7. **Rate limits** (`apps/server/src/services/ratelimit.ts`): prompts 5/min, claims
   10/min, reports 10/min per player (tighter when shadow-throttled) — basic
   anti-bot/anti-spam. Over the limit → `rate_limited`.

8. **Bans.** A banned player is rejected at the socket handshake with
   `moderation_blocked` and disconnected (tested: `banned player is rejected on
   connect`).

---

## Nothing user-generated is ever on-chain

The Anchor program stores **only**: a global config (costs/caps) and per-player
counters (`balance`, `last_refill`, `answers_given`, `prompts_sent`). Prompt text,
answers, and drawings exist **only** off-chain (Postgres + private storage). There is
no path that writes UGC to Solana, so there is nothing to take down on-chain — chain
takedowns are impossible and unnecessary by design.

---

## Takedown path (operational)

1. A user taps "report" on an answer (sends `answerId`) or a prompt is reported.
2. The report is recorded; if it crosses the auto-hide threshold it's hidden
   immediately and the author is penalised.
3. A moderator hits `GET /admin/reports` (with the `ADMIN_TOKEN` bearer), reviews the
   preview, and `POST`s an action: `dismiss`, `hide`, or `ban`.
4. Hidden answers stop being delivered and their signed URLs stop being minted; hidden
   prompts leave the queue; banned authors can't reconnect.

To enable admin in a deployment: set `ADMIN_TOKEN` to a long random string and call
the endpoints over HTTPS (e.g. `curl -H "Authorization: Bearer $ADMIN_TOKEN"
https://<server>/admin/reports`).

---

## What production would need next

This is deliberately minimal for a devnet demo. Before anything real:

- **Real text moderation** — replace the wordlist with a maintained classifier /
  moderation API (context-aware, multilingual), with tunable thresholds.
- **Real image moderation** — automated NSFW/violence classification on every upload,
  **and CSAM detection via perceptual hashing** (e.g. PhotoDNA / NCMEC hash matching)
  with mandatory reporting workflows. The current 2 MB + min-bytes check is **not**
  safety moderation.
- **A human moderation team** + on-call, an **audit log** of every mod action, an
  **appeals** flow, and per-moderator accountability (the current admin API is a
  single shared token with no audit trail).
- **Legal/compliance** — Terms of Service, DMCA/notice-and-takedown, age gating,
  regional content law, data-retention and deletion (GDPR/CCPA) policies.
- **Stronger identity / anti-abuse** — burner pubkeys are sybil-cheap; production
  would want proof-of-work, attestation, or funded-wallet gating to make ban-evasion
  costly, plus IP/device signals.
- **Scale** — move presence/queue/rate-limits to Redis, run multiple server
  instances, and add observability/alerting on moderation metrics.
