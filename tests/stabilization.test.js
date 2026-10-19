// Regression tests for the stabilization pass (2026-10-19): request accounting, beehiiv idempotency,
// length handling, truncation. Everything runs against simulated APIs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { callClaude, askJson, toolDefs } = require('../src/claude');
const { Budget } = require('../lib/budget');
const { createDraft } = require('../lib/beehiiv');
const { runGate } = require('../lib/quality_gate');
const { load } = require('../src/config');
const { runWorkflow } = require('../src/run');
const { mockOptions } = require('./mocks/mockEnv');
const { fakeState, resetMock, streamResp } = require('./mocks/fakeApis');
const F = require('./fixtures');

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `aow-${n}-`));
const quiet = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const beehiivPosts = () => fakeState.calls.filter((c) => c.url.includes('api.beehiiv.com') && c.method === 'POST');

// ---------- 1. request accounting ----------
const baseCfg = () => { const c = load(); return { ...c, anthropic: { apiKey: 'k', baseUrl: 'https://api.anthropic.com' }, runtime: { ...c.runtime, retry_base_ms: 1, limits: { ...c.runtime.limits, max_pause_turns: 2 } } }; };
const msg = (stop, text = '', usage = { input_tokens: 100, output_tokens: 50 }) => ({ content: text ? [{ type: 'text', text }] : [], stop_reason: stop, usage });
const scripted = (responses) => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    const m = responses[Math.min(sent.length - 1, responses.length - 1)];
    return body.stream ? streamResp(m) : { status: 200, json: async () => m };
  };
  return { fetchImpl, sent };
};
const tools = (cfg) => toolDefs(cfg, { search: 2 });

test('ACCOUNTING: a pause_turn continuation is a separate call and the cap is checked before sending it', async () => {
  const cfg = baseCfg();
  const { fetchImpl, sent } = scripted([msg('pause_turn'), msg('end_turn', 'done')]);
  const budget = new Budget({ maxCalls: 1, rates: cfg.runtime.rates_usd });
  await assert.rejects(callClaude({ cfg, fetchImpl, budget, step: 'scout', model: 'claude-sonnet-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: tools(cfg) }), /BUDGET: call cap 1/);
  assert.equal(sent.length, 1, 'second request never sent');
  assert.equal(budget.calls, 1);
});

test('ACCOUNTING: every completed request is logged with its own usage', async () => {
  const cfg = baseCfg();
  const { fetchImpl, sent } = scripted([msg('pause_turn', '', { input_tokens: 1000, output_tokens: 10 }), msg('end_turn', 'done', { input_tokens: 2000, output_tokens: 20 })]);
  const budget = new Budget({ maxCalls: 5, rates: cfg.runtime.rates_usd });
  const r = await callClaude({ cfg, fetchImpl, budget, step: 'scout', model: 'claude-sonnet-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: tools(cfg) });
  assert.equal(sent.length, 2);
  assert.equal(budget.calls, 2);
  assert.deepEqual(budget.log.map((l) => [l.step, l.input_tokens]), [['scout', 1000], ['scout:continue1', 2000]]);
  assert.equal(r.usage.input_tokens, 3000);
});

test('ACCOUNTING: running out of pause_turn continuations fails instead of returning partial text', async () => {
  const cfg = baseCfg();
  const { fetchImpl, sent } = scripted([msg('pause_turn', 'partial')]);
  const budget = new Budget({ maxCalls: 10, rates: cfg.runtime.rates_usd });
  await assert.rejects(callClaude({ cfg, fetchImpl, budget, step: 'research', model: 'claude-sonnet-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: tools(cfg) }), /still paused after 2 continuations/);
  assert.equal(sent.length, 3);
  assert.equal(budget.calls, 3);
});

test('ACCOUNTING: a JSON repair request is counted', async () => {
  const cfg = baseCfg();
  const { fetchImpl, sent } = scripted([msg('end_turn', 'not json'), msg('end_turn', '{"stories": []}')]);
  const budget = new Budget({ maxCalls: 5, rates: cfg.runtime.rates_usd });
  const r = await askJson({ cfg, fetchImpl, budget, step: 'scout', model: 'claude-sonnet-5-5', system: 's', user: 'x', schema: { type: 'object', required: ['stories'] }, tools: tools(cfg) });
  assert.deepEqual(r.data, { stories: [] });
  assert.equal(sent.length, 2);
  assert.deepEqual(budget.log.map((l) => l.step), ['scout', 'scout:repair']);
});

// ---------- 4. truncation ----------
test('TRUNCATION: tool-free calls stream with the large output limit', async () => {
  const cfg = baseCfg();
  const { fetchImpl, sent } = scripted([msg('end_turn', '{"ok": true}')]);
  const r = await callClaude({ cfg, fetchImpl, budget: new Budget({ rates: cfg.runtime.rates_usd }), step: 'writer:write', model: 'claude-sonnet-5-5', system: 's', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(sent[0].stream, true);
  assert.equal(sent[0].max_tokens, cfg.runtime.limits.stream_max_output_tokens);
  assert.equal(r.text, '{"ok": true}');
});

test('TRUNCATION: max_tokens stop and a cut-off stream are errors, and the partial usage is still logged', async () => {
  const cfg = baseCfg();
  const budget = new Budget({ rates: cfg.runtime.rates_usd });
  const call = (fetchImpl) => callClaude({ cfg, fetchImpl, budget, step: 'writer:write', model: 'claude-sonnet-5-5', system: 's', messages: [{ role: 'user', content: 'x' }] });
  await assert.rejects(call(scripted([msg('max_tokens', '{"sections": [')]).fetchImpl), /max_tokens/);
  await assert.rejects(call(async () => streamResp(msg('end_turn', '{"a": 1}'), { truncated: true })), /ended before message_stop/);
  assert.deepEqual(budget.log.map((l) => l.step), ['writer:write', 'writer:write:incomplete']);
});

test('TRUNCATION: a truncated or max_tokens writer response never reaches beehiiv', async () => {
  for (const fault of ['max_tokens', 'truncated']) {
    resetMock();
    const opts = mockOptions({ dataDir: tmp('data'), outDir: tmp('out') });
    await quiet(() => runWorkflow('daily', opts));
    fakeState.writerFault = fault;
    const w = await quiet(() => runWorkflow('weekly', opts));
    assert.equal(w.ok, false, fault);
    assert.match(w.error, fault === 'max_tokens' ? /max_tokens/ : /incomplete|message_stop/);
    assert.equal(fakeState.calls.filter((c) => c.url.includes('beehiiv')).length, 0, `${fault}: no beehiiv call`);
  }
});

// ---------- 2. beehiiv idempotency ----------
const bh = (handlers) => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(init.method); return handlers[init.method](calls.filter((m) => m === init.method).length); };
  return { fetchImpl, calls };
};
const created = { status: 201, json: async () => ({ data: { id: 'post_1', preview_url: 'https://app.beehiiv.com/posts/post_1/preview' } }) };

test('BEEHIIV: an accepted post that never finishes is pending (not failed) and its id is saved before polling', async () => {
  const order = [];
  const { fetchImpl, calls } = bh({ POST: () => created, GET: () => { order.push('poll'); return { status: 202, headers: { get: () => '0' } }; } });
  const r = await createDraft({ draft: F.draft(), apiKey: 'k', publicationId: 'pub_abc', fetchImpl, sleep: async () => {}, maxPolls: 3, onAccepted: async (a) => order.push(`saved ${a.beehiiv_post_id}`) });
  assert.equal(r.status, 'draft_pending');
  assert.equal(r.beehiiv_post_id, 'post_1');
  assert.equal(order[0], 'saved post_1');
  assert.equal(calls.filter((m) => m === 'POST').length, 1);
});

test('BEEHIIV: poll network errors after acceptance are pending; a dropped create request is never retried', async () => {
  const a = bh({ POST: () => created, GET: () => { throw new Error('ECONNRESET'); } });
  assert.equal((await createDraft({ draft: F.draft(), apiKey: 'k', publicationId: 'pub_abc', fetchImpl: a.fetchImpl, sleep: async () => {}, maxPolls: 2 })).status, 'draft_pending');
  const b = bh({ POST: () => { throw new Error('socket hang up'); } });
  const r = await createDraft({ draft: F.draft(), apiKey: 'k', publicationId: 'pub_abc', fetchImpl: b.fetchImpl, sleep: async () => {} });
  assert.equal(r.status, 'manual_fallback');
  assert.equal(r.uncertain, true);
  assert.equal(b.calls.length, 1);
});

test('BEEHIIV: a pending post is checked on the next run and never duplicated', async () => {
  resetMock();
  const data = tmp('data');
  const opts = mockOptions({ dataDir: data, outDir: tmp('out') });
  await quiet(() => runWorkflow('daily', opts));
  fakeState.beehiivPending = true;
  const w1 = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w1.status, 'draft_pending');
  const id = readJson(path.join(data, 'issues.json'))[0].beehiiv_post_id;
  assert.ok(id);
  const w2 = await quiet(() => runWorkflow('weekly', { ...opts, force: true }));
  assert.equal(w2.status, 'draft_pending', 'still pending: no regeneration, no new post');
  Object.values(fakeState.posts).forEach((p) => (p.pending = false));
  const w3 = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w3.status, 'draft_in_beehiiv');
  assert.equal(w3.recovered, true);
  assert.equal(beehiivPosts().length, 1);
  assert.equal(readJson(path.join(data, 'issues.json'))[0].beehiiv_post_id, id);
});

test('BEEHIIV: --force regenerates without a second draft; only --new-beehiiv-draft creates one', async () => {
  resetMock();
  const data = tmp('data');
  const opts = mockOptions({ dataDir: data, outDir: tmp('out') });
  await quiet(() => runWorkflow('daily', opts));
  await quiet(() => runWorkflow('weekly', opts));
  const first = readJson(path.join(data, 'issues.json'))[0].beehiiv_post_id;
  const f = await quiet(() => runWorkflow('weekly', { ...opts, force: true }));
  assert.equal(f.status, 'regenerated_manual_update');
  assert.equal(beehiivPosts().length, 1);
  assert.equal(readJson(path.join(data, 'issues.json'))[0].beehiiv_post_id, first);
  assert.equal((await quiet(() => runWorkflow('weekly', opts))).skipped, true, 'plain re-run does not regenerate again');
  const n = await quiet(() => runWorkflow('weekly', { ...opts, force: true, newBeehiivDraft: true }));
  assert.equal(n.status, 'draft_in_beehiiv');
  assert.equal(beehiivPosts().length, 2);
  const issue = readJson(path.join(data, 'issues.json'))[0];
  assert.notEqual(issue.beehiiv_post_id, first);
  assert.deepEqual(issue.previous_beehiiv_post_ids, [first]);
});

test('BEEHIIV: a sent issue stays immutable even with --force --new-beehiiv-draft', async () => {
  resetMock();
  const data = tmp('data');
  const opts = mockOptions({ dataDir: data, outDir: tmp('out') });
  fs.writeFileSync(path.join(data, 'issues.json'), JSON.stringify([{ issue_date: '2026-10-18', status: 'sent', beehiiv_post_id: 'post_00000000-0000-0000-0000-00000000abcd' }]));
  const w = await quiet(() => runWorkflow('weekly', { ...opts, force: true, newBeehiivDraft: true }));
  assert.equal(w.status, 'sent');
  assert.equal(fakeState.calls.filter((c) => c.url.includes('beehiiv')).length, 0);
});

test('GATE: a quality-gate failure creates no beehiiv draft', async () => {
  resetMock();
  const opts = mockOptions({ dataDir: tmp('data'), outDir: tmp('out') });
  await quiet(() => runWorkflow('daily', opts));
  fakeState.reviseNoop = true; // the planted unsupported superlative survives revision
  const w = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w.status, 'blocked');
  assert.equal(fakeState.calls.filter((c) => c.url.includes('beehiiv')).length, 0);
});

// ---------- 3. length ----------
test('LENGTH: a short draft is expanded from research and lands in the target range', async () => {
  resetMock();
  const out = tmp('out');
  const opts = mockOptions({ dataDir: tmp('data'), outDir: out });
  await quiet(() => runWorkflow('daily', opts));
  const w = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w.status, 'draft_in_beehiiv');
  assert.ok(w.word_count >= 1500 && w.word_count <= 2200, `${w.word_count} words`);
  const steps = readJson(path.join(out, '2026-10-18', 'budget.json')).calls.map((c) => c.step);
  assert.ok(steps.indexOf('writer:expand') > steps.indexOf('writer:write') && steps.indexOf('writer:expand') < steps.indexOf('fact_check'), 'expansion is fact-checked');
  assert.equal(w.review_flags.some((f) => /^Length/.test(f)), false);
});

test('LENGTH: when research cannot support more, the short draft is kept and flagged for editorial review', async () => {
  resetMock();
  const data = tmp('data'), out = tmp('out');
  const opts = mockOptions({ dataDir: data, outDir: out });
  await quiet(() => runWorkflow('daily', opts));
  fakeState.expandInsufficient = true;
  const w = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w.status, 'draft_in_beehiiv', 'draft preserved');
  assert.ok(w.word_count < 1500);
  const lengthFlag = w.review_flags.find((f) => /^Length/.test(f));
  assert.match(lengthFlag, /under the 1500-2200 target.*Research packet supports no further material/);
  const issue = readJson(path.join(data, 'issues.json'))[0];
  assert.ok(issue.review_flags.includes(lengthFlag));
  const html = fs.readFileSync(path.join(out, '2026-10-18', 'issue.html'), 'utf8');
  assert.match(html, /EDITOR REVIEW REQUIRED/);
  const posted = Object.values(fakeState.posts)[0].body.body_content;
  assert.match(posted, /EDITOR REVIEW REQUIRED[\s\S]*under the 1500-2200 target/, 'flag is visible inside the beehiiv draft');
  assert.ok(fakeState.calls.some((c) => c.url.startsWith('https://slack.example')));
});

test('LENGTH: draft takes are highlighted as needing Mohil\'s approval; optional sections can be omitted', async () => {
  resetMock();
  const out = tmp('out');
  const opts = mockOptions({ dataDir: tmp('data'), outDir: out });
  await quiet(() => runWorkflow('daily', opts));
  const w = await quiet(() => runWorkflow('weekly', opts));
  assert.ok(w.review_flags.some((f) => /\[DRAFT TAKE\] need Mohil's approval/.test(f)));
  const html = fs.readFileSync(path.join(out, '2026-10-18', 'issue.html'), 'utf8');
  assert.match(html, /background:#fde68a[^>]*>\[DRAFT TAKE - Mohil to confirm\] \(needs Mohil's approval\)/);

  const nl = load().newsletter;
  const draft = F.draft();
  draft.sections = draft.sections.filter((s) => nl.sections.find((x) => x.id === s.id)?.required);
  const g = runGate({ draft, packet: F.packet(), factCheck: F.passFactCheck(), newsletterCfg: nl, window: F.WINDOW, now: F.NOW });
  assert.equal(g.blocking.some((b) => b.code === 'MISSING_REQUIRED_SECTION'), false);
});
