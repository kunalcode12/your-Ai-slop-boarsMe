#!/usr/bin/env bash
# Stop any running local validator. Safe from a script file: the parent process
# cmdline is "bash stop-validator.sh" (no match), and pkill/pgrep skip their own PID.
pkill -f solana-test-validator
sleep 1
if pgrep -f solana-test-validator >/dev/null 2>&1; then
  echo "STILL_UP"
else
  echo "validator_stopped"
fi
