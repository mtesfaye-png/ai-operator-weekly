// Acceptance tests from brief §13 that can run offline. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { dedupe } = require('../lib/dedupe');
const { filterWindow, issueWindow } = require('../lib/dates');
const { freshnessPlan, formatPrice } = require('../lib/pricing');
const { runGate } = require('../lib/quality_gate');
const { buildPayload, createDraft, assertDraftOnly, assertAllowed } = require('../lib/beehiiv');
const { Budget } = require('../lib/budget');
const { totalScore, selectStories } = require('../lib/scoring');
const F = require('./fixtures');

const newsletterCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/newsletter.json')));
const scoringCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/scoring.json')));
const gate = (o = {}) => runGate({ draft: F.draft(), packet: F.packet(), factCheck: F.passFactCheck(), newsletterCfg, window: F.WINDOW, now: F.NOW, ...o });

test('baseline fixture passes the gate', () => {
  const r = gate();
  assert.equal(r.pass, true, JSON.stringify(r.blocking));
});

test('PRICING: outdated price is flagged stale and blocks the gate', () => {
  const p = F.packet();
  p.stories[0].pricing[0].checked_at = '2026-08-01T00:00:00Z';
  const plan = freshnessPlan(p.stories[0].pricing, { now: F.NOW, maxAgeHours: 72 });
  assert.equal(plan.refresh.length, 1);
  assert.match(plan.refresh[0].issues[0], /STALE/);
  assert.equal(gate({ packet: p }).blocking.some((b) => b.code === 'PRICE_NOT_FRESH'), true);
});

test('PRICING: price in copy without a checked date blocks', () => {
  const d = F.draft();
  d.sections[1].markdown = d.sections[1].markdown.replace(' (checked Oct 17)', '');
  assert.equal(gate({ draft: d }).blocking.some((b) => b.code === 'PRICE_WITHOUT_CHECK_DATE'), true);
});

test('PRICING: formatPrice states billing basis and checked date', () => {
  assert.equal(formatPrice(F.packet().stories[0].pricing[0]), '$20/month (checked Oct 17)');
});

test('DUPLICATE: five articles on one announcement collapse to one canonical story', () => {
  const base = { companies: ['OpenAI'], event_date: '2026-10-14', category: 'frontier_models', confidence: 0.8 };
  const items = [
    { story_id: 's1', headline: 'OpenAI launches GPT-6 with longer context', primary_url: 'https://techcrunch.com/2026/10/14/openai-gpt-6', source_tier: 2 },
    { story_id: 's2', headline: 'OpenAI unveils GPT-6 with longer context window', primary_url: 'https://www.theverge.com/openai-gpt-6', source_tier: 2 },
    { story_id: 's3', headline: 'Introducing GPT-6', primary_url: 'https://openai.com/index/gpt-6?utm_source=x', source_tier: 1 },
    { story_id: 's4', headline: 'GPT-6: OpenAI releases GPT-6 longer context', primary_url: 'https://therundown.ai/p/gpt-6', source_tier: 3 },
    { story_id: 's5', headline: 'Introducing GPT-6', primary_url: 'https://openai.com/index/gpt-6', source_tier: 1, event_date: '2026-10-15' },
  ].map((x) => ({ ...base, ...x }));
  const out = dedupe(items, scoringCfg.dedupe);
  assert.equal(out.length, 1, JSON.stringify(out.map((o) => o.headline)));
  assert.match(out[0].primary_url, /openai\.com/);
  assert.ok(out[0].supporting_urls.length >= 3);
});

test('DUPLICATE: unrelated stories from the same company stay separate', () => {
  const out = dedupe([
    { story_id: 'a', headline: 'Google ships Gemini update for Sheets', companies: ['Google'], event_date: '2026-10-14', primary_url: 'https://a.example/1' },
    { story_id: 'b', headline: 'Google faces EU antitrust fine over ad tech', companies: ['Google'], event_date: '2026-10-14', primary_url: 'https://b.example/2' },
  ]);
  assert.equal(out.length, 2);
});

test('HALLUCINATION: benchmark with no source is blocked', () => {
  const d = F.draft();
  d.sections[0].markdown += '\n\nModel Z scores 92% on SWE-bench, 3x better than rivals.';
  d.claims_used.push('c-bench');
  const fc = F.passFactCheck();
  fc.verdict = 'FAIL';
  fc.items.push({ claim: 'Model Z scores 92% on SWE-bench', status: 'NEEDS_SOURCE', severity: 'high', evidence_url: null, correction: 'remove' });
  const codes = gate({ draft: d, factCheck: fc }).blocking.map((b) => b.code);
  assert.ok(codes.includes('FACT_CHECK_FAIL'));
  assert.ok(codes.includes('UNVERIFIED_CLAIM_USED'));
  assert.ok(codes.includes('UNSUPPORTED_SUPERLATIVE'));
});

test('HALLUCINATION: invented URL not in research packet is blocked', () => {
  const d = F.draft();
  d.sections[0].markdown += ' [More](https://made-up.example/story)';
  assert.ok(gate({ draft: d }).blocking.some((b) => b.code === 'UNSOURCED_URL'));
});

test('DATE WINDOW: six-month-old article with a fresh crawl date is excluded', () => {
  const w = issueWindow('2026-10-18', 7);
  assert.deepEqual(w, { start: '2026-10-12', end: '2026-10-18' });
  const { kept, dropped } = filterWindow([
    { story_id: 'old', event_date: '2026-04-10', crawled_at: '2026-10-17T09:00:00Z' },
    { story_id: 'new', event_date: '2026-10-15', crawled_at: '2026-10-15T09:00:00Z' },
  ], w);
  assert.deepEqual(kept.map((s) => s.story_id), ['new']);
  assert.equal(dropped[0].story_id, 'old');
});

test('PUBLISHER SAFETY: payload is always draft and refuses publish fields', () => {
  const p = buildPayload(F.draft(), {});
  assert.equal(p.status, 'draft');
  assert.throws(() => assertDraftOnly({ ...p, status: 'confirmed' }), /SAFETY/);
  assert.throws(() => assertDraftOnly({ ...p, scheduled_at: '2026-10-20T12:00:00Z' }), /SAFETY/);
  assert.throws(() => assertAllowed('POST', '/publications/pub_abc/posts/post_123/test_send'), /SAFETY/);
  assert.throws(() => assertAllowed('PATCH', '/publications/pub_abc/posts/post_123'), /SAFETY/);
  assert.throws(() => assertAllowed('DELETE', '/publications/pub_abc/posts/post_123'), /SAFETY/);
});

test('PUBLISHER SAFETY: no source file sets status to confirmed', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '../lib'))) {
    const src = fs.readFileSync(path.join(__dirname, '../lib', f), 'utf8');
    assert.equal(/status\s*:\s*['"]confirmed['"]/.test(src), false, `${f} sets confirmed`);
  }
});

test('FAILURE: broken credential preserves body and fires an alert', async () => {
  const alerts = [];
  const fakeFetch = async () => ({ status: 401, text: async () => 'Unauthorized' });
  const r = await createDraft({ draft: F.draft(), apiKey: 'bad', publicationId: 'pub_abc', fetchImpl: fakeFetch, alert: async (m) => alerts.push(m) });
  assert.equal(r.status, 'manual_fallback');
  assert.ok(r.html.includes('Acme shipped Model Z'));
  assert.ok(r.markdown.length > 50);
  assert.equal(alerts.length, 1);
});

test('FAILURE: async creation handles 202 then 200', async () => {
  let polls = 0;
  const fakeFetch = async (url, opts) => {
    if (opts.method === 'POST') return { status: 201, json: async () => ({ data: { id: 'post_1', preview_url: 'https://app.beehiiv.com/posts/post_1/preview' } }) };
    polls++;
    return polls < 2 ? { status: 202, headers: { get: () => '0' } } : { status: 200, json: async () => ({ data: { status: 'draft' } }) };
  };
  const r = await createDraft({ draft: F.draft(), apiKey: 'k', publicationId: 'pub_abc', fetchImpl: fakeFetch, sleep: async () => {} });
  assert.equal(r.status, 'draft_in_beehiiv');
  assert.equal(r.beehiiv_post_id, 'post_1');
});

test('COST: budget cap stops further calls and logs usage', () => {
  const b = new Budget({ maxCalls: 2, maxUsd: 1, rates: { input_per_mtok: 3, output_per_mtok: 15, per_search: 0.01 } });
  b.track('scout', { input_tokens: 10000, output_tokens: 2000, searches: 5 });
  b.track('research', { input_tokens: 10000, output_tokens: 2000 });
  assert.throws(() => b.track('writer', {}), /BUDGET/);
  assert.equal(b.log.length, 2);
  assert.ok(b.summary().est_usd > 0);
});

test('HUMAN REVIEW: workflow without a review checkpoint blocks', () => {
  const d = F.draft();
  d.sections[3].markdown = 'Steps 1-4. Fully automated.';
  assert.ok(gate({ draft: d }).blocking.some((b) => b.code === 'WORKFLOW_NO_HUMAN_REVIEW'));
});

test('SCORING: weights total 1 and selection enforces category diversity', () => {
  const sum = Object.values(scoringCfg.weights).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum * 1000), 1000);
  const mk = (id, cat, v) => ({ story_id: id, category: cat, confidence: 0.9, scores: { importance: v, usefulness: v, business_value: v, novelty: v, audience_fit: v } });
  const stories = [mk('m1', 'frontier_models', 5), mk('m2', 'frontier_models', 5), mk('m3', 'frontier_models', 5), mk('m4', 'frontier_models', 4),
    mk('t1', 'tools', 4), mk('t2', 'tools', 4), mk('t3', 'tools', 4), mk('r1', 'regulation', 2)];
  const picked = selectStories(stories, scoringCfg);
  assert.equal(picked.length, 5);
  assert.ok(picked.filter((s) => s.category === 'frontier_models').length <= 2);
  assert.ok(new Set(picked.map((s) => s.category)).size >= 3);
  assert.equal(totalScore(stories[0].scores, scoringCfg.weights), 5);
});
