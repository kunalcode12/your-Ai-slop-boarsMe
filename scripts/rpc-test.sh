#!/usr/bin/env bash
# Probe MagicBlock devnet endpoints with standard Solana JSON-RPC calls.
set -u
probe() {
  local url="$1"
  echo "=== $url ==="
  echo -n "  getVersion: "
  curl -s -m 12 -X POST "$url" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}' 2>&1 | head -c 300
  echo
  echo -n "  getHealth : "
  curl -s -m 12 -X POST "$url" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>&1 | head -c 300
  echo
}
probe https://devnet-router.magicblock.app
probe https://devnet.magicblock.app
probe https://devnet-as.magicblock.app
probe https://devnet-us.magicblock.app
probe https://devnet-eu.magicblock.app
