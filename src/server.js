#!/usr/bin/env node
// Trigger server for n8n (works with n8n Cloud and self-hosted). n8n's HTTP Request node calls:
//   POST /run/daily | /run/weekly | /run/analytics   (Authorization: Bearer $AOW_TRIGGER_TOKEN)
//        body (optional): { "date": "2026-10-18", "force": false }
//        -> 202 { run_id } immediately; the run continues in the background and alerts on finish.
//   GET  /runs/:run_id   -> status/result of a run
//   GET  /health         -> { ok: true }
// One run per workflow at a time. There is deliberately no endpoint that publishes or sends.

const http = require('http');
const crypto = require('crypto');
const { load } = require('./config');
const { runWorkflow, WORKFLOWS } = require('./run');

const cfg = load();
if (!cfg.server.token) { console.error('Set AOW_TRIGGER_TOKEN before starting the server.'); process.exit(1); }

const runs = new Map();     // run_id -> { status, workflow, started_at, result }
const active = new Set();   // workflows currently running

function authed(req) {
  const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(cfg.server.token);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function send(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
  if (!authed(req)) return send(res, 401, { error: 'Missing or wrong bearer token' });

  const runMatch = url.pathname.match(/^\/run\/(\w+)$/);
  if (req.method === 'POST' && runMatch) {
    const workflow = runMatch[1];
    if (!WORKFLOWS[workflow]) return send(res, 404, { error: `Unknown workflow ${workflow}` });
    if (active.has(workflow)) return send(res, 409, { error: `${workflow} is already running` });
    let body = {};
    try { body = JSON.parse(await new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d || '{}')); })); } catch { return send(res, 400, { error: 'Body must be JSON' }); }
    if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return send(res, 400, { error: 'date must be YYYY-MM-DD' });

    const id = `${workflow}-${Date.now()}`;
    runs.set(id, { status: 'running', workflow, started_at: new Date().toISOString() });
    active.add(workflow);
    runWorkflow(workflow, { issueDate: body.date, force: !!body.force })
      .then((result) => runs.set(id, { ...runs.get(id), status: result.ok ? 'finished' : 'failed', result }))
      .finally(() => active.delete(workflow));
    return send(res, 202, { run_id: id, status: 'running' });
  }

  const statusMatch = url.pathname.match(/^\/runs\/([\w-]+)$/);
  if (req.method === 'GET' && statusMatch) {
    const r = runs.get(statusMatch[1]);
    return r ? send(res, 200, r) : send(res, 404, { error: 'Unknown run id' });
  }
  send(res, 404, { error: 'Not found' });
});

server.listen(cfg.server.port, () => console.log(`AI Operator Weekly trigger server on :${cfg.server.port}`));
