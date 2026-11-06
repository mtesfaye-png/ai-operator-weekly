#!/bin/bash
# AI Operator Weekly on this Mac (no Docker): the AOW service and n8n run as two background services
# (launchd agents) that start at login and restart if they crash. Both listen on 127.0.0.1 only.
#
#   deploy/mac/setup.sh            install or update everything (safe to re-run)
#   deploy/mac/setup.sh --paid     also let n8n start the paid Claude workflows (daily, weekly, analytics)
#   deploy/mac/setup.sh --status   show what's running
#
# Paid workflows stay OFF until you run with --paid (after the Claude key is saved and the first test passed).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(cd "$REPO/.." && pwd)"
N8N_DIR="$WORK/n8n"
N8N_BIN="$N8N_DIR/node_modules/.bin/n8n"
N8N_DATA="$WORK/n8n-data"
LOGS="$WORK/logs"
NODE="$(command -v node)"
NODE_BIN_DIR="$(dirname "$(readlink -f "$NODE" 2>/dev/null || echo "$NODE")")"
AGENTS="$HOME/Library/LaunchAgents"
UID_="$(id -u)"
ALERT_EMAIL="${ALERT_EMAIL:-guptapartnersteam@gmail.com}"

status() {
  for l in com.aiopweekly.aow com.aiopweekly.n8n; do
    if launchctl print "gui/$UID_/$l" >/dev/null 2>&1; then
      echo "✔ $l: $(launchctl print "gui/$UID_/$l" | awk '/state =/{print $3; exit}')"
    else echo "✘ $l: not installed"; fi
  done
  curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && echo "✔ AOW service answers on http://127.0.0.1:8787" || echo "✘ AOW service not answering"
  curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1 && echo "✔ n8n answers on http://localhost:5678" || echo "✘ n8n not answering"
}
if [ "${1:-}" = "--status" ]; then status; exit 0; fi

PAID=0; [ "${1:-}" = "--paid" ] && PAID=1
[ -x "$N8N_BIN" ] || { echo "n8n is not installed in $N8N_DIR (npm install n8n@2.44.7 there first)"; exit 1; }
mkdir -p "$LOGS" "$N8N_DATA" "$AGENTS"
cd "$REPO"

echo "== 1. Settings (.env) =="
envget() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }
TOKEN="$(envget AOW_TRIGGER_TOKEN)"
[ -n "$TOKEN" ] || TOKEN="$(openssl rand -hex 32)"
WORKFLOWS="collect"
if [ "$PAID" = 1 ]; then
  [ -n "$(envget ANTHROPIC_API_KEY)" ] || { echo "No ANTHROPIC_API_KEY in .env yet. Run deploy/mac/set-secrets.sh first."; exit 1; }
  WORKFLOWS="collect,daily,weekly,analytics"
fi
AOW_TRIGGER_TOKEN="$TOKEN" AOW_SERVER_WORKFLOWS="$WORKFLOWS" AOW_TIMEZONE="America/New_York" PORT=8787 \
SMTP_HOST="smtp.gmail.com" SMTP_PORT=465 SMTP_USER="$ALERT_EMAIL" ALERT_EMAIL_TO="$ALERT_EMAIL" AOW_MAC_NOTIFY=1 \
AOW_SET_KEYS="AOW_TRIGGER_TOKEN AOW_SERVER_WORKFLOWS AOW_TIMEZONE PORT SMTP_HOST SMTP_PORT SMTP_USER ALERT_EMAIL_TO AOW_MAC_NOTIFY" \
  "$NODE" deploy/mac/set-env.js >/dev/null
echo "✔ .env updated (trigger token, email alerts to $ALERT_EMAIL, server may start: $WORKFLOWS)"

echo "== 2. Background services =="
cat > "$AGENTS/com.aiopweekly.aow.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.aiopweekly.aow</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$REPO/src/server.js</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_BIN_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/aow.log</string>
  <key>StandardErrorPath</key><string>$LOGS/aow.log</string>
</dict></plist>
PLIST
cat > "$AGENTS/com.aiopweekly.n8n.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.aiopweekly.n8n</string>
  <key>ProgramArguments</key><array><string>$N8N_BIN</string><string>start</string></array>
  <key>WorkingDirectory</key><string>$N8N_DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$NODE_BIN_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>N8N_USER_FOLDER</key><string>$N8N_DATA</string>
    <key>N8N_LISTEN_ADDRESS</key><string>127.0.0.1</string>
    <key>N8N_PORT</key><string>5678</string>
    <key>N8N_SECURE_COOKIE</key><string>false</string>
    <key>GENERIC_TIMEZONE</key><string>America/New_York</string>
    <key>TZ</key><string>America/New_York</string>
    <key>N8N_DIAGNOSTICS_ENABLED</key><string>false</string>
    <key>N8N_VERSION_NOTIFICATIONS_ENABLED</key><string>false</string>
    <key>N8N_PERSONALIZATION_ENABLED</key><string>false</string>
    <key>N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS</key><string>true</string>
    <key>N8N_RUNNERS_ENABLED</key><string>true</string>
    <key>EXECUTIONS_DATA_PRUNE</key><string>true</string>
    <key>EXECUTIONS_DATA_MAX_AGE</key><string>2160</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOGS/n8n.log</string>
  <key>StandardErrorPath</key><string>$LOGS/n8n.log</string>
</dict></plist>
PLIST

echo "== 3. n8n workflows + credential =="
launchctl bootout "gui/$UID_/com.aiopweekly.n8n" 2>/dev/null || true
IMPORT="$(mktemp -d)"; trap 'rm -rf "$IMPORT"' EXIT
AOW_TRIGGER_TOKEN="$TOKEN" "$NODE" deploy/mac/prepare-n8n.js "$IMPORT" >/dev/null
n8n() { env N8N_USER_FOLDER="$N8N_DATA" GENERIC_TIMEZONE=America/New_York N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true "$N8N_BIN" "$@"; }
n8n import:credentials --input="$IMPORT/credentials.json" >>"$LOGS/setup.log" 2>&1
for f in rss-collect daily-scout weekly-production analytics; do
  n8n import:workflow --input="$IMPORT/$f.json" >>"$LOGS/setup.log" 2>&1
done
echo "✔ imported 4 workflows and the 'AOW Trigger Token' credential"
"$REPO/deploy/mac/activate.sh" "$PAID" >>"$LOGS/setup.log" 2>&1 || { echo "Activation failed; see $LOGS/setup.log"; exit 1; }
if [ "$PAID" = 1 ]; then echo "✔ active: RSS collect 7:05, Daily scout 6:45, Weekly Sat 7:00, Analytics 10:00 (ET)"
else echo "✔ active: RSS collect, every day 7:05 ET (free). Paid workflows imported but OFF."; fi

echo "== 4. Start =="
for l in com.aiopweekly.aow com.aiopweekly.n8n; do
  launchctl bootout "gui/$UID_/$l" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_" "$AGENTS/$l.plist"
done
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1 && break; sleep 2; done
status
echo
echo "n8n:  http://localhost:5678   (first visit: create the owner login; it stays on this Mac)"
echo "Logs: $LOGS"
