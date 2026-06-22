#!/usr/bin/env bash
# Poll the deployer's devnet balance; exit 0 once it can cover the deploy (>= 3 SOL).
set -u
SRV=/mnt/c/Users/TGF/Downloads/aiSlop/server-keypair.json
PK=$(solana-keygen pubkey "$SRV")
need=3
for i in $(seq 1 150); do
  b=$(solana balance "$PK" --url devnet 2>/dev/null | awk '{print $1}')
  if [ -n "${b:-}" ] && awk "BEGIN{exit !($b+0 >= $need)}"; then
    echo "FUNDED: $b SOL on $PK"
    exit 0
  fi
  sleep 20
done
echo "TIMEOUT: last balance ${b:-unknown} SOL (need >= $need)"
exit 1
