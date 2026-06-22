#!/usr/bin/env bash
# Deploy the ER credits program to devnet. Fee payer + upgrade authority = server keypair.
set -uo pipefail
P=/mnt/c/Users/TGF/Downloads/aiSlop/programs/credits
SRV=/mnt/c/Users/TGF/Downloads/aiSlop/server-keypair.json

echo "deployer: $(solana-keygen pubkey "$SRV")  balance: $(solana balance -k "$SRV" --url devnet)"
echo "program id (keypair): $(solana-keygen pubkey "$P/target/deploy/credits-keypair.json")"
ls -la "$P/target/deploy/credits.so"

solana program deploy "$P/target/deploy/credits.so" \
  --program-id "$P/target/deploy/credits-keypair.json" \
  -k "$SRV" \
  --upgrade-authority "$SRV" \
  --url devnet \
  --commitment confirmed
code=$?
echo "DEPLOY_EXIT=$code"
[ $code -eq 0 ] && solana program show "$(solana-keygen pubkey "$P/target/deploy/credits-keypair.json")" --url devnet
exit $code
