// Email alerts (SMTP), the /alert endpoint for n8n, and the required-section setting.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const path = require('path');

const { sendMail, makeNotifier, subjectFor } = require('../src/notify');
const { createServer } = require('../src/server');

// A tiny fake SMTP server: records every command and the message body.
function fakeSmtp({ authOk = true } = {}) {
  const seen = { commands: [], data: '' };
  const server = net.createServer((sock) => {
    let inData = false, buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 queued\r\n'); } else seen.data += `${line}\n`;
          continue;
        }
        seen.commands.push(line);
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (verb === 'AUTH') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (seen.commands.length === 3) sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (seen.commands.length === 4) sock.write(authOk ? '235 ok\r\n' : '535 bad credentials\r\n');
        else if (verb === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (verb === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

const opts = (port) => ({ host: '127.0.0.1', port, secure: false, requireTls: false, user: 'me@gmail.com', pass: 'app-pass', from: 'me@gmail.com', to: ['me@gmail.com'] });

test('EMAIL: sends an alert over SMTP with login, recipient and a readable subject', async () => {
  const { server, seen, port } = await fakeSmtp();
  try {
    await sendMail(opts(port), { subject: 'AI Operator Weekly · test', text: 'Draft ready for review.' });
    assert.ok(seen.commands.includes('AUTH LOGIN'));
    assert.ok(seen.commands.includes(Buffer.from('app-pass').toString('base64')));
    assert.ok(seen.commands.includes('RCPT TO:<me@gmail.com>'));
    assert.match(seen.data, /Subject: AI Operator Weekly · test|Subject: =\?UTF-8\?B\?/);
    const body = Buffer.from(seen.data.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString();
    assert.equal(body, 'Draft ready for review.');
  } finally { server.close(); }
});

test('EMAIL: refuses to send a password without TLS unless explicitly allowed (tests only)', async () => {
  const { server, port } = await fakeSmtp();
  try {
    await assert.rejects(sendMail({ ...opts(port), requireTls: undefined }, { subject: 's', text: 't' }), /STARTTLS/);
  } finally { server.close(); }
});

test('EMAIL: a failing channel never throws out of the notifier; other channels still run', async () => {
  const { server, port } = await fakeSmtp({ authOk: false });
  const slack = [];
  const err = console.error; console.error = () => {};
  try {
    const cfg = { alerts: { email: opts(port), slackWebhook: 'https://hooks.slack.example/x', macNotify: false } };
    const channels = await makeNotifier(cfg, async (url, o) => { slack.push(JSON.parse(o.body).text); return { ok: true }; })('[AI Operator Weekly · weekly] Run failed: boom.');
    assert.deepEqual(channels, ['slack']);
    assert.equal(slack.length, 1);
  } finally { console.error = err; server.close(); }
});

test('EMAIL: subject names the workflow and the first sentence', () => {
  assert.equal(subjectFor('[AI Operator Weekly · weekly] Draft ready for review: "X". Review it.'), 'AI Operator Weekly · weekly: Draft ready for review: "X".');
});

test('SERVER: POST /alert needs the token, validates text, and routes through the notifier', async () => {
  const sent = [];
  const cfg = { server: { token: 'secret-token', port: 0 }, alerts: {} };
  const server = createServer({ cfg, runWorkflow: async () => ({ ok: true }), allowed: new Set(['collect']), alert: async (t) => { sent.push(t); return ['email']; } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, token = 'secret-token') => fetch(`${base}/alert`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
  try {
    assert.equal((await post('{"text":"x"}', 'wrong')).status, 401);
    assert.equal((await post('{}')).status, 400);
    const ok = await post(JSON.stringify({ text: 'weekly could not start' }));
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).channels, ['email']);
    assert.deepEqual(sent, ['[AI Operator Weekly · n8n] weekly could not start']);
  } finally { server.close(); }
});

test('CONFIG: every issue must cover tools + pricing, a workflow, ROI and risks', () => {
  const nl = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/newsletter.json')));
  const required = nl.sections.filter((s) => s.required).map((s) => s.id);
  for (const id of ['big5', 'tool_of_week', 'build_better', 'workflow', 'roi', 'what_not', 'one_thing']) assert.ok(required.includes(id), id);
});

test('EMAIL: a rejected login never puts the password (or its base64) in the error', async () => {
  const { server, port } = await (async () => {
    const s = net.createServer((sock) => {
      sock.write('220 x\r\n'); let n = 0;
      sock.on('data', () => { n++; sock.write(n === 1 ? '250 AUTH LOGIN\r\n' : n < 4 ? '334 ok\r\n' : '535 bad credentials\r\n'); });
    });
    return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ server: s, port: s.address().port })));
  })();
  try {
    const err = await sendMail(opts(port), { subject: 's', text: 't' }).catch((e) => e);
    assert.match(err.message, /login \(password\) failed: 535/);
    assert.ok(!err.message.includes('app-pass') && !err.message.includes(Buffer.from('app-pass').toString('base64')));
  } finally { server.close(); }
});

test('SCOUT: extra fields from the model are dropped, required fields still enforced', () => {
  const { stripUnknown } = require('../src/agents/scout');
  const { loadSchema, validate } = require('../src/validate');
  const schema = loadSchema('scout_output').properties.stories.items;
  const story = {
    story_id: '2026-11-05-acme-model', headline: 'Acme ships a model', event_date: '2026-11-05', category: 'frontier_models',
    companies: ['Acme'], primary_url: 'https://acme.example/news', supporting_urls: [], factual_summary: 'x', why_it_might_matter: 'y',
    pricing_change: false, scores: { importance: 4, usefulness: 3, business_value: 3, novelty: 4, audience_fit: 4, extra: 1 },
    confidence: 0.8, unresolved_questions: [], source: 'acme.example', notes: 'model added this',
  };
  assert.equal(validate(schema, story).valid, false);
  assert.equal(validate(schema, stripUnknown(schema, story)).valid, true);
  const { headline, ...missing } = story;
  assert.equal(validate(schema, stripUnknown(schema, missing)).valid, false);
});

test('SCOUT: near-miss categories are mapped to the allowed ids, unknown ones are left to fail validation', () => {
  const { normalizeCategory } = require('../src/agents/scout');
  const allowed = ['frontier_models', 'tools', 'enterprise', 'business', 'regulation', 'open_source', 'workflow', 'infrastructure'];
  assert.equal(normalizeCategory('Frontier Models', allowed), 'frontier_models');
  assert.equal(normalizeCategory('open-source', allowed), 'open_source');
  assert.equal(normalizeCategory('Policy', allowed), 'regulation');
  assert.equal(normalizeCategory('acquisition', allowed), 'business');
  assert.equal(normalizeCategory('Chips', allowed), 'infrastructure');
  assert.equal(normalizeCategory('astrology', allowed), 'astrology');
});

test('JSON REPAIR: near-miss enum labels are fixed; price-like labels are always "pricing"; statuses are never guessed', () => {
  const { coerce, validate, loadSchema } = require('../src/validate');
  const schema = loadSchema('research_packet');
  const claim = (claim_type, status = 'confirmed') => ({ claim_type, status });
  const claimSchema = schema.properties.stories.items.properties.claims.items;
  assert.equal(coerce(claimSchema, claim('Release')).claim_type, 'release');
  assert.equal(coerce(claimSchema, claim('price_change')).claim_type, 'pricing');
  assert.equal(coerce(claimSchema, claim('Pricing Update')).claim_type, 'pricing');
  assert.equal(coerce(claimSchema, claim('funding_round')).claim_type, 'funding');
  assert.equal(coerce(claimSchema, claim('acquisition')).claim_type, 'other');
  assert.equal(coerce(claimSchema, claim('release', 'probably')).status, 'probably'); // no "other": left to fail
  const fc = loadSchema('fact_check_report');
  assert.equal(coerce(fc.properties.verdict, 'pass'), 'PASS');
  assert.equal(coerce(fc.properties.verdict, 'looks fine'), 'looks fine');
  assert.equal(validate(fc.properties.verdict, 'looks fine').valid, false);
});

test('JSON: an answer whose strings contain code fences (prompt templates) is still read as the whole object', () => {
  const { extractJson } = require('../src/claude');
  const obj = { sections: [{ id: 'workflow', markdown: 'Prompt:\n```\nYou are a support agent. Reply politely.\n```\nHuman review: approve.' }] };
  const raw = JSON.stringify(obj);
  assert.deepEqual(extractJson(raw), obj);
  assert.deepEqual(extractJson('```json\n' + JSON.stringify(obj, null, 2) + '\n```'), obj);
  assert.deepEqual(extractJson('Here you go:\n' + raw + '\nDone.'), obj);
  assert.deepEqual(extractJson('Note\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('no json here'));
});
