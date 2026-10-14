#!/usr/bin/env bash
# Audit indépendant 2026-10-14 : pile Supabase locale isolée (runtime natif), migrations de la copie figée.
set -euo pipefail
AUD="$HOME/audit-miaouffrage-20261014"
SCR=/mnt/c/Users/thann/AppData/Local/Temp/claude/C--Users-maxim-Projects-miaouffrage/cdab460e-e4c5-4312-b7fd-cd1f131b02e3/scratchpad/audit
SNAP="$SCR/snapshot/handoff-audit-independant/annexes/repository"
LIVE=/mnt/c/Users/maxim/Projects/miaouffrage
CLI="$HOME/miaouffrage-wsl/node_modules/.bin/supabase"
OUT="$SCR/out"

for p in 56320 56321 56322 56323 56324 56327 56329 56083; do
  if (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then echo "port $p busy"; exit 3; fi
done

rm -rf "$AUD"
mkdir -p "$AUD/supabase"
cp -r "$SNAP/supabase/migrations" "$AUD/supabase/"
cp -r "$SNAP/supabase/functions" "$AUD/supabase/"
# Absents de l'archive : config.toml (inchangé depuis le 11/08) et tests pgTAP, repris du dépôt vivant.
cp -r "$LIVE/supabase/tests" "$AUD/supabase/"
cp "$LIVE/supabase/config.toml" "$AUD/supabase/config.toml"

cfg="$AUD/supabase/config.toml"
sed -i -E 's/^project_id\s*=.*/project_id = "audit-independant-20261014"/' "$cfg"
for pair in 54320:56320 54321:56321 54322:56322 54323:56323 54324:56324 54327:56327 54329:56329 8083:56083; do
  sed -i -E "s/\b${pair%%:*}\b/${pair##*:}/g" "$cfg"
done
sed -i -E 's#^site_url = .*#site_url = "http://127.0.0.1:3210"#' "$cfg"
sed -i -E 's#http://127\.0\.0\.1:3000#http://127.0.0.1:3210#g; s#http://localhost:3000#http://localhost:3210#g' "$cfg"
sed -i -E 's/^\[experimental\]\r?$/[experimental]\nstack = true/' "$cfg"
[ "$(grep -c '^\[experimental\]' "$cfg")" = 1 ] || { echo "experimental table count != 1"; exit 6; }
grep -q '^stack = true' "$cfg" || { echo "stack flag missing"; exit 6; }
grep -nE '^project_id|port = |site_url|^\[experimental\]|^stack' "$cfg" > "$OUT/wsl-config-check.txt"

cd "$AUD"
"$CLI" --version > "$OUT/wsl-cli-version.txt"
echo "== start $(date -Is)"
"$CLI" start --runtime native --workdir "$AUD" > "$OUT/wsl-start.log" 2>&1 || { echo "start failed"; tail -40 "$OUT/wsl-start.log"; exit 4; }
echo "== reset $(date -Is)"
"$CLI" db reset --local --workdir "$AUD" > "$OUT/wsl-db-reset.log" 2>&1 || { echo "reset failed"; tail -60 "$OUT/wsl-db-reset.log"; exit 5; }
echo "== migration list $(date -Is)"
"$CLI" migration list --local --workdir "$AUD" --output-format json > "$OUT/wsl-migration-list.json" 2>&1 || true
"$CLI" status --env --workdir "$AUD" > "$AUD/status.env" 2>/dev/null
grep -E '^(API_URL|DB_URL|STUDIO_URL)=' "$AUD/status.env" | sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***@#' > "$OUT/wsl-status-public.txt"
echo "== done $(date -Is)"
