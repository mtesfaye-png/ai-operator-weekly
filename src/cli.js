#!/usr/bin/env node
// Usage:
//   node src/cli.js collect [--days 3]        # RSS-only: fetch public feeds, no Claude, no paid calls
//   node src/cli.js daily                     # scout today's stories
//   node src/cli.js weekly [--date 2026-10-18] [--force] [--new-beehiiv-draft]
//   node src/cli.js analytics                 # pull stats for sent issues
//   node src/cli.js doctor                    # check configuration (no paid calls)
//   add --mock to any workflow to run against simulated APIs (no keys, no cost)
// Exit codes: 0 ok, 2 issue blocked by the quality gate, 1 error.

const path = require('path');
const fs = require('fs');
const { runWorkflow } = require('./run');
const { load } = require('./config');

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  if (!cmd || flag('help')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 10).join('\n').replace(/^\/\/ ?/gm, ''));
    return 0;
  }
  if (cmd === 'doctor') return doctor();

  let opts = { issueDate: opt('date'), force: flag('force'), newBeehiivDraft: flag('new-beehiiv-draft'), lookbackDays: opt('days') ? Number(opt('days')) : undefined };
  if (flag('mock')) opts = { ...opts, ...require('../tests/mocks/mockEnv').mockOptions() };
  const result = await runWorkflow(cmd, opts);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) return 1;
  return result.status === 'blocked' ? 2 : 0;
}

function doctor() {
  const cfg = load();
  const rows = [
    ['ANTHROPIC_API_KEY', !!cfg.anthropic.apiKey, 'required for daily + weekly'],
    ['AIRTABLE_TOKEN + AIRTABLE_BASE_ID', !!(cfg.airtable.token && cfg.airtable.baseId), 'optional: without it, data is kept in data/'],
    ['BEEHIIV_API_KEY + BEEHIIV_PUBLICATION_ID', !!(cfg.beehiiv.apiKey && cfg.beehiiv.publicationId), 'optional: without it, issues export for manual paste'],
    ['BEEHIIV_POST_TEMPLATE_ID', !!cfg.beehiiv.templateId, 'optional: house template'],
    ['SLACK_WEBHOOK_URL', !!cfg.alerts.slackWebhook, 'optional: alerts go to stderr without it'],
    ['AOW_TRIGGER_TOKEN', !!cfg.server.token, 'required for the n8n trigger server'],
  ];
  for (const [k, ok, note] of rows) console.log(`${ok ? '✔' : '✘'} ${k.padEnd(42)} ${note}`);
  console.log(`\nModels: ${Object.entries(cfg.runtime.models).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  const { effectiveMaxUsd } = require('./run');
  const lim = cfg.runtime.limits;
  console.log(`Budget caps (app-side estimates, not a provider limit): daily $${effectiveMaxUsd(lim.daily.max_usd)} / ${lim.daily.max_calls} calls, weekly $${effectiveMaxUsd(lim.weekly.max_usd)} / ${lim.weekly.max_calls} calls${process.env.AOW_MAX_USD ? ' (lowered by AOW_MAX_USD)' : ''}`);
  console.log('collect (RSS-only) will contact: public RSS feeds only (+ Airtable if configured). No Anthropic, no beehiiv.');
  console.log(`Daily run will contact: Anthropic API${cfg.anthropic.apiKey ? '' : ' (no key: will fail)'}, public RSS feeds (no account)${cfg.airtable.token && cfg.airtable.baseId ? ', Airtable' : ''}${cfg.alerts.slackWebhook ? ', Slack' : ''}. beehiiv is not used by daily.`);
  console.log(`Data: ${cfg.airtable.token ? 'Airtable' : path.relative(process.cwd(), cfg.dataDir) || cfg.dataDir} · Exports: ${cfg.outDir}`);
  return cfg.anthropic.apiKey ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
