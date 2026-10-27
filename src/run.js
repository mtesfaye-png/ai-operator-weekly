// Shared runner used by the CLI and the trigger server: builds config, store, budget and logger,
// runs one workflow, writes the Run Log record, and alerts on any crash.

const { load } = require('./config');
const { makeStore, LocalStore } = require('./store');
const { makeLogger, makeAlert } = require('./log');
const { Budget } = require('../lib/budget');
const { runId: newRunId } = require('./util');
const { daily } = require('./steps/daily');
const { weekly } = require('./steps/weekly');
const { analytics } = require('./steps/analytics');
const { collectRss } = require('./steps/collect');

const WORKFLOWS = { daily, weekly, analytics, collect: collectRss };

// Hosts that cost money. The RSS-only workflow refuses to contact them at the network layer,
// on top of having a zero-call budget and never loading the Claude client.
const PAID_HOSTS = ['api.anthropic.com', 'api.beehiiv.com'];

function guardFetch(fetchImpl, cfg) {
  const paid = new Set([...PAID_HOSTS, new URL(cfg.anthropic.baseUrl).hostname]);
  const requests = {}, blocked = [];
  const guarded = async (url, opts) => {
    const host = new URL(url).hostname;
    if (paid.has(host)) { blocked.push(host); throw new Error(`collect mode refuses paid host ${host}`); }
    requests[host] = (requests[host] || 0) + 1;
    return fetchImpl(url, opts);
  };
  return { guarded, report: () => ({ attempts_by_host: requests, paid_api_calls: 0, blocked_paid_attempts: blocked.length }) };
}

// AOW_MAX_USD can only LOWER the per-run cap from runtime.json (e.g. AOW_MAX_USD=1 for a first live test).
function effectiveMaxUsd(configured) {
  const env = Number(process.env.AOW_MAX_USD);
  return Number.isFinite(env) && env > 0 ? Math.min(configured, env) : configured;
}

async function runWorkflow(workflow, opts = {}) {
  if (!WORKFLOWS[workflow]) throw new Error(`Unknown workflow "${workflow}". Use: ${Object.keys(WORKFLOWS).join(', ')}`);
  const cfg = opts.cfg || load();
  const guard = workflow === 'collect' ? guardFetch(opts.fetchImpl || fetch, cfg) : null;
  const fetchImpl = guard ? guard.guarded : opts.fetchImpl || fetch;
  const store = makeStore(cfg, fetchImpl);
  // collect keeps its Run Log local even with Airtable connected: saves 1 API call and 1 record per run.
  if (workflow === 'collect') { const local = new LocalStore(cfg.dataDir); store.logRun = (row) => local.append('Run Log', row); }
  const lim = cfg.runtime.limits[workflow] || { max_calls: 5, max_usd: 1 };
  const budget = new Budget({ maxCalls: lim.max_calls, maxUsd: effectiveMaxUsd(lim.max_usd), rates: cfg.runtime.rates_usd });
  const runId = newRunId(workflow);
  const log = makeLogger({ store, workflow, runId, alertFn: makeAlert(cfg, fetchImpl) });
  log.info(`Run ${runId} started (store: ${store.kind})`);

  try {
    const result = await WORKFLOWS[workflow]({ cfg, fetchImpl, store, budget, log, issueDate: opts.issueDate, force: opts.force, newBeehiivDraft: opts.newBeehiivDraft, runId, lookbackDays: opts.lookbackDays, now: opts.now || new Date() });
    if (guard) result.network = guard.report();
    const status = result.status === 'blocked' ? 'warning' : 'ok';
    await log.finish(status, JSON.stringify({ ...result, gate: undefined }).slice(0, 4000), budget.calls);
    return { run_id: runId, workflow, ok: true, ...result, budget: budget.summary() };
  } catch (e) {
    log.error(e.stack || e.message);
    await log.alert(`Run failed: ${e.message}. Research and drafts saved so far are kept in the ${store.kind === 'airtable' ? 'Airtable base' : 'data/ folder'}.`);
    await log.finish('error', e.message, budget.calls).catch(() => {});
    return { run_id: runId, workflow, ok: false, error: e.message, budget: budget.summary() };
  }
}

module.exports = { runWorkflow, WORKFLOWS, effectiveMaxUsd, PAID_HOSTS };
