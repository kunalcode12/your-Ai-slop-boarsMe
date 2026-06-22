#!/usr/bin/env bash
set -eu
P=/mnt/c/Users/TGF/Downloads/aiSlop/programs/credits
C=/mnt/c/Users/TGF/Downloads/aiSlop/packages/program-client
cp "$P/target/idl/credits.json" "$C/idl/credits.json"
cp "$P/target/types/credits.ts" "$C/src/credits.ts"
echo "copied IDL + types into program-client"
grep -m1 '"address"' "$C/idl/credits.json"
echo "ER instrs in client IDL:"
grep -oE '"name": "(delegate_player|commit_player|undelegate_player)"' "$C/idl/credits.json" | sort -u
