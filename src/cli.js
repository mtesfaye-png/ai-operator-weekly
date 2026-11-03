#!/usr/bin/env node
// Usage:
//   node src/cli.js collect [--days 3] [--max-sync 10]  # RSS-only; no Claude, no paid calls
//   node src/cli.js daily                     # scout today's stories
//   node src/cli.js weekly [--date 2026-10-18] [--force] [--new-beehiiv-draft]
//   node src/cli.js analytics                 # pull stats for sent issues
//   node src/cli.js doctor                    # check configuration (no paid calls)
//   node src/cli.js airtable-check            # read back synced Articles (1 Airtable call per 100 rows)
//   node src/cli.js airtable-status           # records + API calls vs the Free limits; notes archived rows (≈10 calls)
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
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 12).join('\n').replace(/^\/\/ ?/gm, ''));
    return 0;
  }
  if (cmd === 'doctor') return doctor();
  if (cmd === 'airtable-check') return airtableCheck();
  if (cmd === 'airtable-status') return airtableStatus();

  let opts = { issueDate: opt('date'), force: flag('force'), newBeehiivDraft: flag('new-beehiiv-draft'), lookbackDays: opt('days') ? Number(opt('days')) : undefined, maxSync: opt('max-sync') !== undefined ? Number(opt('max-sync')) : undefined };
  if (flag('mock')) opts = { ...opts, ...require('../tests/mocks/mockEnv').mockOptions() };
  const result = await runWorkflow(cmd, opts);
  console.log(JSON.stringify(result, null, 2));
  // Machine-readable copy for CI (GitHub Actions job summary); stdout also carries log lines.
  if (process.env.AOW_RESULT_FILE) fs.writeFileSync(process.env.AOW_RESULT_FILE, JSON.stringify(result, null, 2));
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
  console.log(`Trigger server can start: ${process.env.AOW_SERVER_WORKFLOWS || 'collect'} (AOW_SERVER_WORKFLOWS; paid workflows only if listed there)`);
  console.log(`Daily run will contact: Anthropic API${cfg.anthropic.apiKey ? '' : ' (no key: will fail)'}, public RSS feeds (no account)${cfg.airtable.token && cfg.airtable.baseId ? ', Airtable' : ''}${cfg.alerts.slackWebhook ? ', Slack' : ''}. beehiiv is not used by daily.`);
  if (cfg.airtable.token) console.log(`Airtable API calls this month (this app, local count): ${require('./store/usage').usedThisMonth(cfg.dataDir)} / budget ${cfg.runtime.airtable.monthly_call_budget} (Free plan: 1,000 per workspace)`);
  console.log(`Data: ${cfg.airtable.token ? 'Airtable' : path.relative(process.cwd(), cfg.dataDir) || cfg.dataDir} · Exports: ${cfg.outDir}`);
  return cfg.anthropic.apiKey ? 0 : 1;
}

// Read back what collect mirrored, filtered the way an editor would view it. Read-only.
async function airtableCheck() {
  const cfg = load();
  if (!cfg.airtable.token || !cfg.airtable.baseId) { console.log('Airtable is not configured (AIRTABLE_TOKEN + AIRTABLE_BASE_ID in .env).'); return 1; }
  const { AirtableStore, LocalStore } = require('./store');
  const usage = require('./store/usage');
  const at = new AirtableStore(cfg.airtable, fetch);
  try {
    const rows = await at.all('Articles');
    const local = (await new LocalStore(cfg.dataDir).all('Articles')).filter((a) => a.airtable_synced_at && !a.airtable_archived_at);
    const missing = local.filter((a) => !rows.some((r) => r.article_id === a.article_id));
    const dupes = rows.length - new Set(rows.map((r) => r.article_id)).size;
    const by = (k) => rows.reduce((m, r) => ({ ...m, [r[k]]: (m[r[k]] || 0) + 1 }), {});
    console.log(JSON.stringify({
      airtable_articles: rows.length, local_marked_synced: local.length, missing_in_airtable: missing.length, duplicate_article_ids: dupes,
      by_signal_type: by('signal_type'), by_ranking_status: by('ranking_status'), by_verification_status: by('verification_status'),
      sample: rows.slice(0, 5).map((r) => ({ title: r.title, source: r.source, published_date: r.published_date, url: r.url })),
    }, null, 2));
    return missing.length || dupes ? 1 : 0;
  } finally { console.log(`Airtable API calls used: ${at.calls} (this month: ${usage.addCalls(cfg.dataDir, at.calls)})`); }
}

// Real record count across all tables (the Free limit is per base) and this app's API calls this month.
// Articles deleted in the Airtable UI to free space are marked airtable_archived_at locally: they stop
// counting toward the record budget and are never re-sent. 1 call per table per 100 rows.
async function airtableStatus({ cfg = load(), fetchImpl = fetch, now = new Date() } = {}) {
  if (!cfg.airtable.token || !cfg.airtable.baseId) { console.log('Airtable is not configured (AIRTABLE_TOKEN + AIRTABLE_BASE_ID in .env).'); return 1; }
  const { AirtableStore, LocalStore } = require('./store');
  const usage = require('./store/usage');
  const syncState = require('./store/sync_state');
  const schema = require('../airtable/schema.json');
  const at = new AirtableStore(cfg.airtable, fetchImpl);
  const local = new LocalStore(cfg.dataDir);
  try {
    const tables = {};
    let ids = [];
    for (const t of schema.tables) {
      const rows = await at.all(t.name, undefined, [t.name === 'Articles' ? 'article_id' : t.fields[0].name]);
      tables[t.name] = rows.length;
      if (t.name === 'Articles') ids = rows.map((r) => r.article_id).filter(Boolean);
    }
    const have = new Set(ids);
    const archive = await local.all('Articles');
    const archived = archive.filter((a) => a.airtable_synced_at && !a.airtable_archived_at && !have.has(a.article_id));
    const found = archive.filter((a) => !a.airtable_synced_at && have.has(a.article_id));
    await local.upsert('Articles', [
      ...archived.map((a) => ({ article_id: a.article_id, airtable_archived_at: now.toISOString() })),
      ...found.map((a) => ({ article_id: a.article_id, airtable_synced_at: now.toISOString() })),
    ]);
    syncState.write(cfg.dataDir, { base_id: cfg.airtable.baseId, reconciled_at: now.toISOString(), airtable_article_count: have.size });
    const records = Object.values(tables).reduce((a, b) => a + b, 0);
    const b = cfg.runtime.airtable;
    const calls = usage.usedThisMonth(cfg.dataDir, now) + at.calls;
    console.log(JSON.stringify({
      records_total: records, records_free_limit: 1000, record_budget: b.record_budget, records_by_table: tables,
      api_calls_this_month_local_count: calls, monthly_call_budget: b.monthly_call_budget, api_calls_free_limit: 1000,
      newly_marked_archived: archived.length, newly_marked_synced: found.length,
      warning: require('./steps/collect').usageWarning({ records, calls, at: b }),
      note: 'The local call count only covers this machine. Airtable → Workspace settings → Summary shows the authoritative number.',
    }, null, 2));
    return 0;
  } finally { console.log(`Airtable API calls used: ${at.calls} (this month: ${usage.addCalls(cfg.dataDir, at.calls, now)})`); }
}

if (require.main !== module) module.exports = { airtableStatus };
else main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
