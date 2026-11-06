// Run logger + alerts. Every run writes a Run Log record; failures also alert by email, Slack and/or a
// macOS notification (whichever are configured), and always to stderr.

const { makeNotifier } = require('./notify');

function makeLogger({ store, workflow, runId, alertFn }) {
  const started = new Date().toISOString();
  const lines = [];
  const log = (level, msg) => {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${workflow}: ${msg}`;
    lines.push(line);
    (level === 'error' ? console.error : console.log)(line);
  };
  return {
    info: (m) => log('info', m),
    warn: (m) => log('warn', m),
    error: (m) => log('error', m),
    alert: async (m) => { log('warn', `ALERT ${m}`); await alertFn(`[AI Operator Weekly · ${workflow}] ${m}`); },
    async finish(status, message, apiCalls = 0) {
      await store.logRun({ run_id: runId, workflow, started_at: started, status, message: [message, ...lines.slice(-40)].join('\n').slice(0, 90000), api_calls: apiCalls });
    },
  };
}

function makeAlert(cfg, fetchImpl, deps) {
  return makeNotifier(cfg, fetchImpl, deps);
}

module.exports = { makeLogger, makeAlert };
