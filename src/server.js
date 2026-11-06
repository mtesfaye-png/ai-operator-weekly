#!/usr/bin/env node
// Trigger server for n8n (works with n8n Cloud and self-hosted). n8n's HTTP Request node calls:
//   POST /run/collect | /run/daily | /run/weekly | /run/analytics   (Authorization: Bearer $AOW_TRIGGER_TOKEN)
//        body (optional): { "date": "2026-10-18", "force": false }
//        collect also takes { "days": 3, "max_sync": 10, "wait": true }
//        -> 202 { run_id } immediately; the run continues in the background and alerts on finish.
//        -> with "wait": true, 200 with the finished run's result instead (collect only).
//   GET  /runs/:run_id   -> status/result of a run
//   GET  /health         -> { ok: true }
//   POST /alert  { "text": "..." } -> sends an alert through the configured channels (email/Slack/macOS);
//        lets n8n's own failure branches reach Mohil the same way the pipeline's alerts do.
// Only the workflows in AOW_SERVER_WORKFLOWS can be started (default: collect, the free RSS-only run).
// The paid ones (daily, weekly, analytics) must be listed there explicitly. Listens on 127.0.0.1 unless
// HOST is set (the Docker image sets 0.0.0.0 inside the container; compose publishes it to localhost only).
// One run per workflow at a time. There is deliberately no endpoint that publishes or sends.

const http = require('http');
const crypto = require('crypto');
const { load } = require('./config');
const { runWorkflow: defaultRun, WORKFLOWS } = require('./run');
const { makeNotifier } = require('./notify');

const MAX_BODY = 10000;

function allowedWorkflows(env = process.env) {
  const list = String(env.AOW_SERVER_WORKFLOWS || 'collect').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = list.filter((w) => !WORKFLOWS[w]);
  if (unknown.length) throw new Error(`AOW_SERVER_WORKFLOWS has unknown workflow(s): ${unknown.join(', ')}`);
  return new Set(list);
}

// Validates the optional JSON body; returns [error, options].
function parseOptions(workflow, body) {
  if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return ['date must be YYYY-MM-DD'];
  const opts = { issueDate: body.date, force: !!body.force };
  if (workflow !== 'collect') return body.wait ? ['wait is only supported for collect'] : [null, opts];
  if (body.days !== undefined && !(Number.isInteger(body.days) && body.days >= 1 && body.days <= 14)) return ['days must be an integer from 1 to 14'];
  if (body.max_sync !== undefined && !(Number.isInteger(body.max_sync) && body.max_sync >= 0)) return ['max_sync must be a non-negative integer'];
  return [null, { ...opts, lookbackDays: body.days, maxSync: body.max_sync }];
}

function createServer({ cfg = load(), runWorkflow = defaultRun, allowed = allowedWorkflows(), alert = makeNotifier(cfg) } = {}) {
  if (!cfg.server.token) throw new Error('Set AOW_TRIGGER_TOKEN before starting the server.');
  const runs = new Map();     // run_id -> { status, workflow, started_at, result }
  const active = new Set();   // workflows currently running

  function authed(req) {
    const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(cfg.server.token);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  function send(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

  // Oversized bodies are drained and discarded (so the client still gets an answer), never buffered.
  const readBody = (req) => new Promise((resolve, reject) => {
    let d = '', size = 0;
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) d += c; });
    req.on('end', () => resolve(size > MAX_BODY ? null : d || '{}'));
    req.on('error', reject);
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
    if (!authed(req)) return send(res, 401, { error: 'Missing or wrong bearer token' });

    if (req.method === 'POST' && url.pathname === '/alert') {
      const raw = await readBody(req).catch(() => null);
      if (raw === null) return send(res, 413, { error: 'Body too large (at most 10 kB)' });
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Body must be JSON' }); }
      const text = String((body && body.text) || '').trim();
      if (!text) return send(res, 400, { error: 'text is required' });
      const channels = await alert(text.startsWith('[AI Operator Weekly') ? text : `[AI Operator Weekly · n8n] ${text}`);
      return send(res, 200, { ok: true, channels });
    }

    const runMatch = url.pathname.match(/^\/run\/(\w+)$/);
    if (req.method === 'POST' && runMatch) {
      const workflow = runMatch[1];
      if (!WORKFLOWS[workflow]) return send(res, 404, { error: `Unknown workflow ${workflow}` });
      if (!allowed.has(workflow)) return send(res, 403, { error: `${workflow} is not enabled on this server (AOW_SERVER_WORKFLOWS=${[...allowed].join(',')})` });
      if (active.has(workflow)) return send(res, 409, { error: `${workflow} is already running` });
      let body;
      const raw = await readBody(req).catch(() => null);
      if (raw === null) return send(res, 413, { error: 'Body too large (at most 10 kB)' });
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Body must be JSON' }); }
      const [err, opts] = parseOptions(workflow, body || {});
      if (err) return send(res, 400, { error: err });

      const id = `${workflow}-${Date.now()}`;
      runs.set(id, { status: 'running', workflow, started_at: new Date().toISOString() });
      active.add(workflow);
      const done = runWorkflow(workflow, opts)
        .catch((e) => ({ ok: false, error: e.message }))
        .then((result) => { runs.set(id, { ...runs.get(id), status: result.ok ? 'finished' : 'failed', result }); return runs.get(id); })
        .finally(() => active.delete(workflow));
      if (body.wait) return send(res, 200, { run_id: id, ...(await done) });
      return send(res, 202, { run_id: id, status: 'running' });
    }

    const statusMatch = url.pathname.match(/^\/runs\/([\w-]+)$/);
    if (req.method === 'GET' && statusMatch) {
      const r = runs.get(statusMatch[1]);
      return r ? send(res, 200, r) : send(res, 404, { error: 'Unknown run id' });
    }
    send(res, 404, { error: 'Not found' });
  });
}

if (require.main === module) {
  let server;
  const cfg = load();
  try { server = createServer({ cfg }); } catch (e) { console.error(e.message); process.exit(1); }
  const host = process.env.HOST || '127.0.0.1';
  server.listen(cfg.server.port, host, () => console.log(`AI Operator Weekly trigger server on ${host}:${cfg.server.port} (workflows: ${[...allowedWorkflows()].join(', ')})`));
}

module.exports = { createServer, allowedWorkflows, parseOptions };
