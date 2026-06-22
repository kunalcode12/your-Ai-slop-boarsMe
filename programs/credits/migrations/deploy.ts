// Anchor deploy migration (runs on `anchor migrate`). Left as the default no-op;
// Config is initialized by the backend (PROMPT 4) via the typed client, since the
// server_authority and the @slop/shared-derived parameters live there.

import * as anchor from "@coral-xyz/anchor";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  // no-op: see apps/server bootstrap for init_config.
};
