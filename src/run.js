// Shared runner used by the CLI and the trigger server: builds config, store, budget and logger,
// runs one workflow, writes the Run Log record, and alerts on any crash.

const { load } = require('./config');
const { makeStore } = require('./store');
const { makeLogger, makeAlert } = require('./log');
const { Budget } = require('../lib/budget');
const { runId: newRunId } = require('./util');
const { daily } = require('./steps/daily');
const { weekly } = require('./steps/weekly');
const { analytics } = require('./steps/analytics');

const WORKFLOWS = { daily, weekly, analytics };

async function runWorkflow(workflow, opts = {}) {
  if (!WORKFLOWS[workflow]) throw new Error(`Unknown workflow "${workflow}". Use: ${Object.keys(WORKFLOWS).join(', ')}`);
  const cfg = opts.cfg || load();
  const fetchImpl = opts.fetchImpl || fetch;
  const store = makeStore(cfg, fetchImpl);
  const lim = cfg.runtime.limits[workflow] || { max_calls: 5, max_usd: 1 };
  const budget = new Budget({ maxCalls: lim.max_calls, maxUsd: lim.max_usd, rates: cfg.runtime.rates_usd });
  const runId = newRunId(workflow);
  const log = makeLogger({ store, workflow, runId, alertFn: makeAlert(cfg, fetchImpl) });
  log.info(`Run ${runId} started (store: ${store.kind})`);

  try {
    const result = await WORKFLOWS[workflow]({ cfg, fetchImpl, store, budget, log, issueDate: opts.issueDate, force: opts.force, newBeehiivDraft: opts.newBeehiivDraft, now: opts.now || new Date() });
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

module.exports = { runWorkflow, WORKFLOWS };
