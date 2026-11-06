#!/bin/bash
# Enter API keys and passwords for AI Operator Weekly. Nothing you type is shown on screen, saved in shell
# history or sent anywhere: each value goes into the project's .env file (readable only by you).
# Press Enter on any line to skip it and keep what's already saved.
set -euo pipefail
cd "$(dirname "$0")/../.."

ask() { # name, prompt
  local v
  printf '%s\n> ' "$2"
  read -rs v; echo
  export "$1=$v"
}

echo "== AI Operator Weekly: enter secrets (input is hidden) =="
echo
ask ANTHROPIC_API_KEY "Claude API key (starts with sk-ant-), from console.anthropic.com > API keys:"
ask SMTP_PASS "Gmail app password for alert emails (16 letters), from myaccount.google.com/apppasswords:"
ask AIRTABLE_TOKEN "Airtable personal access token (starts with pat), from airtable.com/create/tokens:"
ask BEEHIIV_API_KEY "beehiiv API key, from beehiiv Settings > Integrations > API:"

AOW_SET_KEYS="ANTHROPIC_API_KEY SMTP_PASS AIRTABLE_TOKEN BEEHIIV_API_KEY" node deploy/mac/set-env.js
unset ANTHROPIC_API_KEY SMTP_PASS AIRTABLE_TOKEN BEEHIIV_API_KEY
echo
node src/cli.js doctor || true
echo
echo "Restarting the AOW service so it picks up the new values..."
launchctl kickstart -k "gui/$(id -u)/com.aiopweekly.aow" 2>/dev/null && echo "✔ restarted" || echo "(service not installed yet; run deploy/mac/setup.sh)"
