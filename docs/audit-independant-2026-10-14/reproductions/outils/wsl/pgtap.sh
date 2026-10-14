#!/usr/bin/env bash
set -uo pipefail
AUD="$HOME/audit-miaouffrage-20261014"; CLI="$HOME/miaouffrage-wsl/node_modules/.bin/supabase"
OUT=/mnt/c/Users/thann/AppData/Local/Temp/claude/C--Users-maxim-Projects-miaouffrage/cdab460e-e4c5-4312-b7fd-cd1f131b02e3/scratchpad/audit/out
cd "$AUD"
"$CLI" test db --local --workdir "$AUD" "$AUD/supabase/tests/database" > "$OUT/wsl-pgtap.log" 2>&1
echo "pgtap exit $?"
tail -25 "$OUT/wsl-pgtap.log"
