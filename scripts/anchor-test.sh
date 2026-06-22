#!/usr/bin/env bash
set -uo pipefail
cd /mnt/c/Users/TGF/Downloads/aiSlop/programs/credits
anchor test --validator legacy --skip-build --provider.cluster localnet 2>&1 | tee /tmp/anchor_test.log
echo "ANCHOR_TEST_EXIT=${PIPESTATUS[0]}"
