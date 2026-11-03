#!/usr/bin/env node
// Turns a `collect` result (AOW_RESULT_FILE) into the GitHub Actions job summary and decides pass/fail.
// Usage: node .github/scripts/collect-summary.js result.json [summary.md]
// Exit 1 when the run must show as failed (GitHub then emails the repo's watchers): the collect itself failed,
// Airtable refused a write or the reconcile read, or no feed could be read. Known-blocked feeds are not failures.

const fs = require('fs');

function classify(r) {
  const at = r.airtable || {};
  const working = (r.feeds?.working || []).length;
  if (!r.ok) return ['failed', `Collection failed: ${r.error || 'unknown error'}`];
  if (r.status === 'skipped') return ['skipped', r.reason || 'skipped'];
  if (at.error || at.reconciled === false) return ['failed', `Airtable sync failed (articles stay queued for the next run): ${at.error || 'reconcile failed'}`];
  if (!working) return ['failed', 'No RSS feed could be read.'];
  if (at.skipped === 'monthly_call_budget_reached') return ['warning', 'Airtable monthly call budget reached: nothing synced, resumes next month.'];
  if (at.usage_warning) return ['warning', at.usage_warning];
  return ['ok', 'Collection finished.'];
}

function markdown(r, [outcome, message]) {
  const at = r.airtable || {};
  const icon = { ok: '✅', warning: '⚠️', skipped: '⏭️', failed: '❌' }[outcome];
  const rows = [
    ['Outcome', `${icon} **${outcome}**: ${message}`],
    ['Feeds read', `${(r.feeds?.working || []).length} of ${r.feeds?.total ?? '?'}`],
    ['Feeds failed', (r.feeds?.failed || []).map((f) => `${f.source} (${f.error})`).join(', ') || 'none'],
    ['Articles in window', r.items_fetched_in_window ?? '–'],
    ['New articles (local archive)', r.new_articles ?? '–'],
    ['Already stored', r.already_stored ?? '–'],
    ['New editorial candidates', r.new_editorial_candidates ?? '–'],
    ['**Added to Airtable this run**', `**${at.synced ?? 0}**`],
    ['Queued for the next run', at.left_for_next_run ?? 0],
    ['Reconciled with Airtable first', at.reconciled ? `yes: ${at.reconciled.airtable_articles} articles already in the base` : 'not needed (archive restored from cache)'],
    ['Airtable records (estimate)', `${at.records_used_estimate ?? '–'} / ${at.record_budget ?? 900} budget (Free plan limit 1,000)`],
    ['Airtable API calls this month (this runner\'s ledger)', `${at.calls_this_month ?? '–'} / 800 budget (Free plan limit 1,000)`],
    ['Paid API calls (Anthropic, beehiiv)', `${r.network?.paid_api_calls ?? 0} (blocked attempts: ${r.network?.blocked_paid_attempts ?? 0})`],
  ];
  const out = [`## AI Operator Weekly: RSS collect`, '', '| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '\\|')} |`), ''];
  if (r.examples?.length) {
    out.push('### Newest editorial candidates', '', '| Published | Source | Title |', '|---|---|---|');
    for (const e of r.examples) out.push(`| ${String(e.published_at || '').slice(0, 10)} | ${e.source} | [${String(e.title).replace(/[|[\]]/g, ' ')}](${e.url}) |`);
    out.push('');
  }
  out.push('_Feed text is the publisher\'s own, unverified. Nothing here is ranked, researched or fact-checked yet._');
  return out.join('\n');
}

if (require.main === module) {
  const [file, summaryFile = process.env.GITHUB_STEP_SUMMARY] = process.argv.slice(2);
  let r;
  try { r = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`No collect result to summarize (${e.message})`); process.exit(1); }
  const verdict = classify(r);
  const md = markdown(r, verdict);
  if (summaryFile) fs.appendFileSync(summaryFile, `${md}\n`);
  console.log(md);
  process.exit(verdict[0] === 'failed' ? 1 : 0);
}

module.exports = { classify, markdown };
