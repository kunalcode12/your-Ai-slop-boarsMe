#!/usr/bin/env bash
# Start a fresh local validator and deploy the credits program + a stand-in
# session program account so the mocha suite (run from Windows) can hit it.
set -uo pipefail
P=/mnt/c/Users/TGF/Downloads/aiSlop/programs/credits
LEDGER=$HOME/slop-test-ledger
SRV=/mnt/c/Users/TGF/Downloads/aiSlop/server-keypair.json

pkill -f solana-test-validator 2>/dev/null || true
sleep 1
rm -rf "$LEDGER"
nohup solana-test-validator --reset --ledger "$LEDGER" --quiet >/tmp/validator.log 2>&1 &
echo "validator pid $!"

# wait for RPC
for i in $(seq 1 30); do
  if solana cluster-version --url http://127.0.0.1:8899 >/dev/null 2>&1; then echo "validator up"; break; fi
  sleep 1
done

solana airdrop 100 "$(solana-keygen pubkey "$SRV")" --url http://127.0.0.1:8899 >/dev/null 2>&1 && echo "funded server-keypair on localnet"
solana program deploy "$P/target/deploy/credits.so" \
  --program-id "$P/target/deploy/credits-keypair.json" \
  --url http://127.0.0.1:8899 && echo "program deployed to localnet"
echo "LOCALNET_READY"
