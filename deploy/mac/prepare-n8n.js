#!/usr/bin/env node
// Makes Mac-ready copies of the n8n workflows for an n8n + AOW service running natively on this Mac:
//  - every call to the AOW service goes to http://127.0.0.1:8787 (no public endpoint, no Docker),
//  - every Slack/webhook alert node instead calls the AOW service's POST /alert, which emails Mohil,
//  - the credential is referenced by a fixed id so `n8n import:credentials` and the workflows line up.
// Usage: node deploy/mac/prepare-n8n.js <out-dir>
const fs = require('fs');
const path = require('path');

const AOW = 'http://127.0.0.1:8787';
const CRED = { id: 'aowTriggerToken01', name: 'AOW Trigger Token' };
const out = process.argv[2];
if (!out) { console.error('usage: prepare-n8n.js <out-dir>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

const src = path.join(__dirname, '..', '..', 'n8n');
const ids = { 'rss-collect.json': 'aowRssCollect001', 'daily-scout.json': 'aowDailyScout001', 'weekly-production.json': 'aowWeeklyProd001', 'analytics.json': 'aowAnalytics0001' };
const webhooks = { 'rss-collect.json': 'aow-collect', 'daily-scout.json': 'aow-daily', 'weekly-production.json': 'aow-weekly', 'analytics.json': 'aow-analytics' };
for (const file of Object.keys(ids)) {
  const w = JSON.parse(fs.readFileSync(path.join(src, file), 'utf8'));
  w.id = ids[file];
  w.active = false;
  // Clock schedules become webhooks: deploy/mac/gate.js starts each job once Mohil has used the Mac for
  // 30 minutes and isn't in a meeting (a sleeping Mac would miss a fixed time).
  for (const n of w.nodes) {
    if (n.type !== 'n8n-nodes-base.scheduleTrigger') continue;
    const oldName = n.name;
    n.name = 'Started by the at-the-Mac scheduler';
    n.type = 'n8n-nodes-base.webhook';
    n.typeVersion = 2;
    n.webhookId = webhooks[file];
    n.parameters = { httpMethod: 'POST', path: webhooks[file], authentication: 'headerAuth', responseMode: 'onReceived', options: {} };
    n.credentials = { httpHeaderAuth: CRED };
    if (w.connections[oldName]) { w.connections[n.name] = w.connections[oldName]; delete w.connections[oldName]; }
  }
  for (const n of w.nodes) {
    if (n.type !== 'n8n-nodes-base.httpRequest') continue;
    const p = n.parameters;
    const isAlert = /hooks\.slack\.com|REPLACE/.test(String(p.url));
    if (isAlert) {
      p.url = `${AOW}/alert`;
      p.method = 'POST';
      p.authentication = 'genericCredentialType';
      p.genericAuthType = 'httpHeaderAuth';
      n.onError = 'continueRegularOutput';
    } else {
      p.url = String(p.url).replace('https://YOUR-AOW-SERVER', AOW).replace('http://aow:8787', AOW);
    }
    n.credentials = { httpHeaderAuth: CRED };
  }
  const left = JSON.stringify(w).match(/YOUR-AOW-SERVER|hooks\.slack\.com|REPLACE-WITH|aow:8787/);
  if (left) { console.error(`${file}: placeholder left: ${left[0]}`); process.exit(1); }
  fs.writeFileSync(path.join(out, file), JSON.stringify(w, null, 2));
}
fs.writeFileSync(path.join(out, 'credentials.json'), JSON.stringify([{
  id: CRED.id, name: CRED.name, type: 'httpHeaderAuth',
  data: { name: 'Authorization', value: `Bearer ${process.env.AOW_TRIGGER_TOKEN || ''}` },
}], null, 2), { mode: 0o600 });
console.log(`Wrote ${Object.keys(ids).length} workflows + credentials.json to ${out}`);
