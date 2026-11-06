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
NODE24_BIN="$WORK/runtime/node24/bin"   # n8n 2.x needs Node 24; the AOW service runs on the system Node
LOGS="$WORK/logs"
NODE="$(command -v node)"
NODE_BIN_DIR="$(dirname "$(readlink -f "$NODE" 2>/dev/null || echo "$NODE")")"
AGENTS="$HOME/Library/LaunchAgents"
UID_="$(id -u)"
ALERT_EMAIL="${ALERT_EMAIL:-guptapartnersteam@gmail.com}"

status() {
  for l in com.aiopweekly.aow com.aiopweekly.n8n com.aiopweekly.gate com.aiopweekly.maintain; do
    if launchctl print "gui/$UID_/$l" >/dev/null 2>&1; then
      st="$(launchctl print "gui/$UID_/$l" | awk '/state =/{print $3; exit}')"
      case "$l:$st" in *gate:not|*maintain:not) st="scheduled (runs on its timer)";; esac
      echo "✔ $l: $st"
    else echo "✘ $l: not installed"; fi
  done
  curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && echo "✔ AOW service answers on http://127.0.0.1:8787" || echo "✘ AOW service not answering"
  curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1 && echo "✔ n8n answers on http://localhost:5678" || echo "✘ n8n not answering"
  "$NODE" "$REPO/deploy/mac/gate.js" --status 2>/dev/null | sed 's/^/  scheduler: /' || true
}
if [ "${1:-}" = "--status" ]; then status; exit 0; fi

PAID=0; [ "${1:-}" = "--paid" ] && PAID=1
[ -x "$N8N_BIN" ] || { echo "n8n is not installed in $N8N_DIR (npm install n8n@2.44.7 there first)"; exit 1; }
[ -x "$NODE24_BIN/node" ] || { echo "Node 24 not found at $NODE24_BIN (needed by n8n)"; exit 1; }
mkdir -p "$LOGS" "$N8N_DATA" "$AGENTS"
cd "$REPO"

echo "== 1. Settings (.env) =="
envget() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }
TOKEN="$(envget AOW_TRIGGER_TOKEN)"
[ -n "$TOKEN" ] || TOKEN="$(openssl rand -hex 32)"
WORKFLOWS="collect"
# GitHub Actions does the daily collect now; keep "none" if it was chosen, so a reinstall doesn't start a second collector.
grep -q '^AOW_SERVER_WORKFLOWS=none$' "$REPO/.env" 2>/dev/null && WORKFLOWS="none"
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
    <key>PATH</key><string>$NODE24_BIN:/usr/bin:/bin:/usr/sbin:/sbin</string>
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

cat > "$AGENTS/com.aiopweekly.gate.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.aiopweekly.gate</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$REPO/deploy/mac/gate.js</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/scheduler.log</string>
  <key>StandardErrorPath</key><string>$LOGS/scheduler.log</string>
</dict></plist>
PLIST
cat > "$AGENTS/com.aiopweekly.maintain.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.aiopweekly.maintain</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$REPO/deploy/mac/maintain.js</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOGS/maintenance.log</string>
  <key>StandardErrorPath</key><string>$LOGS/maintenance.log</string>
</dict></plist>
PLIST
echo "✔ services: AOW (pipeline), n8n (orchestration), scheduler (every 5 min: 30 min active + no meeting), weekly backup + cleanup (Sun 9am or next wake)"
/usr/bin/swiftc -O "$REPO/deploy/mac/bin-src/mic-in-use.swift" -o "$REPO/deploy/mac/mic-in-use" 2>/dev/null && echo "✔ meeting check built (microphone in use)" || echo "! could not build the meeting check (needs Xcode command line tools); Zoom detection still works"

echo "== 3. n8n workflows + credential =="
launchctl bootout "gui/$UID_/com.aiopweekly.n8n" 2>/dev/null || true
for i in $(seq 1 30); do launchctl print "gui/$UID_/com.aiopweekly.n8n" >/dev/null 2>&1 || break; sleep 0.5; done
IMPORT="$(mktemp -d)"; trap 'rm -rf "$IMPORT"' EXIT
AOW_TRIGGER_TOKEN="$TOKEN" "$NODE" deploy/mac/prepare-n8n.js "$IMPORT" >/dev/null
n8n() { env PATH="$NODE24_BIN:$PATH" N8N_USER_FOLDER="$N8N_DATA" GENERIC_TIMEZONE=America/New_York N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true "$N8N_BIN" "$@"; }
n8n import:credentials --input="$IMPORT/credentials.json" >>"$LOGS/setup.log" 2>&1
for f in rss-collect daily-scout weekly-production analytics; do
  n8n import:workflow --input="$IMPORT/$f.json" >>"$LOGS/setup.log" 2>&1
done
echo "✔ imported 4 workflows and the 'AOW Trigger Token' credential"
n8n publish:workflow --id=aowRssCollect001 >>"$LOGS/setup.log" 2>&1
if [ "$PAID" = 1 ]; then
  for id in aowDailyScout001 aowWeeklyProd001 aowAnalytics0001; do n8n publish:workflow --id=$id >>"$LOGS/setup.log" 2>&1; done
  echo "✔ active: free RSS collect, daily scout, weekly issue (from Saturday), analytics"
else
  for id in aowDailyScout001 aowWeeklyProd001 aowAnalytics0001; do n8n unpublish:workflow --id=$id >>"$LOGS/setup.log" 2>&1 || true; done
  echo "✔ active: free RSS collect. Paid workflows imported but OFF (run setup.sh --paid to turn them on)."
fi

echo "== 4. Start =="
for l in com.aiopweekly.aow com.aiopweekly.n8n com.aiopweekly.gate com.aiopweekly.maintain; do
  [ "$l" = com.aiopweekly.aow ] && [ "${AOW_KEEP_RUNNING:-}" = 1 ] && continue
  launchctl bootout "gui/$UID_/$l" 2>/dev/null || true
  # bootout returns before the service is fully gone; starting too early fails with "Input/output error".
  for i in $(seq 1 20); do launchctl print "gui/$UID_/$l" >/dev/null 2>&1 || break; sleep 0.5; done
  ok=0
  for i in 1 2 3 4 5; do launchctl bootstrap "gui/$UID_" "$AGENTS/$l.plist" 2>/dev/null && { ok=1; break; }; sleep 2; done
  [ "$ok" = 1 ] || echo "✘ could not start $l (try: launchctl bootstrap gui/$UID_ $AGENTS/$l.plist)"
done
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1 && break; sleep 2; done
status
echo
echo "n8n:  http://localhost:5678   (first visit: create the owner login; it stays on this Mac)"
echo "Logs: $LOGS"
