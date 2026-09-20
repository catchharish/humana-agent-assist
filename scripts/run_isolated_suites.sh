#!/usr/bin/env bash
set -u
export ORIGIN=http://127.0.0.1:3000
LOG="runs/isolated_suites_nba_after_check.txt"
{
  echo "started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "ORIGIN=$ORIGIN"
  echo "listeners:"
  lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(3000|3002|3012)\b' || true
} > "$LOG"

run3 () {
  local name="$1"
  shift
  local pass=0
  local i
  for i in 1 2 3; do
    echo "" | tee -a "$LOG"
    echo "===== $name run $i =====" | tee -a "$LOG"
    if "$@" >>"$LOG" 2>&1; then
      echo "$name run $i PASS" | tee -a "$LOG"
      pass=$((pass + 1))
    else
      echo "$name run $i FAIL exit=$?" | tee -a "$LOG"
    fi
  done
  echo "$name PASS_COUNT $pass/3" | tee -a "$LOG"
}

run3 T01 env RUN_T01=1 npx vitest run tests/t01_main.test.ts
run3 REPLAYS npx vitest run tests/replays.test.ts
run3 CHAIN env ORIGIN=http://127.0.0.1:3000 npx tsx scripts/chain_eval.ts
run3 NOT_CANNED npx vitest run tests/not_canned.test.ts
run3 NBA_MEMBERS npx vitest run tests/nba_members.test.ts

echo "finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
