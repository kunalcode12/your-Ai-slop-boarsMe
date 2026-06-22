#!/usr/bin/env bash
set -u
P=/mnt/c/Users/TGF/Downloads/aiSlop/programs/credits
SRV=/mnt/c/Users/TGF/Downloads/aiSlop/server-keypair.json
echo "=== program .so size ==="
ls -la "$P/target/deploy/credits.so"
bytes=$(stat -c %s "$P/target/deploy/credits.so")
echo "bytes=$bytes"
# Upgradeable deploy needs rent for ~2x program size of program-data account.
# Rough estimate: lamports = bytes * 2 * 6960 (per-byte rent) ; SOL = /1e9
est=$(awk "BEGIN{printf \"%.2f\", ($bytes*2*6960)/1e9 + 0.6}")
echo "estimated_deploy_SOL≈ $est  (program-data rent is ~2x .so size + tx/buffer overhead)"
echo
echo "=== candidate deploy wallets (devnet balances) ==="
echo -n "server-keypair 7aWiUSfU... : "; solana balance -k "$SRV" --url devnet 2>&1
echo -n "default id.json 7nr4Cox...  : "; solana balance --url devnet 2>&1
echo
echo "=== warnings in final build log ==="
grep -c "^warning" /tmp/build_er.log 2>/dev/null || echo "0"
