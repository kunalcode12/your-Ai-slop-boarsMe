#!/usr/bin/env bash
set -uo pipefail
cd /mnt/c/Users/TGF/Downloads/aiSlop/programs/credits
anchor build -- --features er 2>&1 | tee /tmp/build_er.log
code=${PIPESTATUS[0]}
echo "ANCHOR_BUILD_EXIT=$code"
exit "$code"
