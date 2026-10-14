#!/usr/bin/env bash
set -euo pipefail
AUD="$HOME/audit-miaouffrage-20261014"
SCR=/mnt/c/Users/thann/AppData/Local/Temp/claude/C--Users-maxim-Projects-miaouffrage/cdab460e-e4c5-4312-b7fd-cd1f131b02e3/scratchpad/audit
R="$SCR/snapshot/handoff-audit-independant/annexes/repository"
set -a; . "$AUD/status.env"; set +a
case "$API_URL" in http://127.0.0.1:*) ;; *) echo "non-loopback API_URL"; exit 2;; esac
CRON=$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)
cat > "$R/.env.local" <<ENV
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
EMAIL_FROM=audit-local@example.invalid
NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL=http://127.0.0.1:3210
CRON_SECRET=$CRON
ENV
cat > "$SCR/secrets/local-stack.env" <<ENV
API_URL=$API_URL
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
DB_URL=$DB_URL
MAILPIT_URL=${MAILPIT_URL:-}
ENV
echo "env written (values not shown)"; sed -E 's/=.*/=<set>/' "$R/.env.local"
