// Regression tests for issues found in the build review (2026-10-19).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runGate } = require('../lib/quality_gate');
const { callClaude } = require('../src/claude');
const { Budget } = require('../lib/budget');
const { load } = require('../src/config');
const { runWorkflow } = require('../src/run');
const { mockOptions } = require('./mocks/mockEnv');
const { resetMock } = require('./mocks/fakeApis');

const newsletterCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/newsletter.json')));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `aow-${n}-`));
const quiet = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };

function gateCodes(markdown, resources = []) {
  // big5 carries the text under test; every other required section (from config) gets filler.
  const filler = {
    tool_of_week: "Who it's for: solo operators. Who should skip: teams needing SSO. **Verdict: Watch**",
    workflow: 'Steps 1-4. Human review: approve before anything reaches a customer.',
  };
  const others = newsletterCfg.sections.filter((s) => s.required && s.id !== 'big5').map((s) => ({ id: s.id, title: s.title, markdown: filler[s.id] || 'ok' }));
  const draft = { sections: [{ id: 'big5', title: 'Big 5', markdown }, ...others], claims_used: [] };
  return runGate({ draft, packet: { stories: [], resources }, factCheck: { verdict: 'PASS', items: [] }, newsletterCfg, window: { start: '2026-10-12', end: '2026-10-18' } }).blocking.map((b) => b.code);
}

test('GATE: ordinary phrases ("best practices", "the first time you") are not superlatives', () => {
  assert.deepEqual(gateCodes('Three best practices for prompts. The first time you run it, read every output.'), []);
});

test('GATE: real unsupported superlatives still block', () => {
  assert.ok(gateCodes('This is the best model on the market.').includes('UNSUPPORTED_SUPERLATIVE'));
  assert.ok(gateCodes('It is the first agent builder to ship this.').includes('UNSUPPORTED_SUPERLATIVE'));
});

test('GATE: bare or broken links block; markdown links pass', () => {
  const url = 'https://docs.example/guide';
  assert.ok(gateCodes(`Read ${url} today.`, [url]).includes('MALFORMED_LINK'));
  assert.ok(gateCodes('Read [the guide](docs.example/guide).', [url]).includes('MALFORMED_LINK'));
  assert.deepEqual(gateCodes(`Read [the guide](${url}).`, [url]), []);
});

test('CLAUDE: requests set effort, current web tools and the refusal fallback; a final refusal throws', async () => {
  const cfg = { ...load(), anthropic: { apiKey: 'k', baseUrl: 'https://api.anthropic.com' } };
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ headers: init.headers, body: JSON.parse(init.body) });
    return { status: 200, json: async () => ({ content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' }, usage: { input_tokens: 10, output_tokens: 0 } }) };
  };
  const { toolDefs } = require('../src/claude');
  await assert.rejects(
    callClaude({ cfg, fetchImpl, budget: new Budget({ rates: cfg.runtime.rates_usd }), step: 'fact_check', model: 'claude-opus-5-5', effort: 'high', system: 's', messages: [{ role: 'user', content: 'x' }], tools: toolDefs(cfg, { search: 2, fetch: 2 }) }),
    /declined the request \(cyber\)/,
  );
  const { body, headers } = seen[0];
  assert.deepEqual(body.output_config, { effort: 'high' });
  assert.equal(body.fallbacks, 'default');
  assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.deepEqual(body.tools.map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
});

test('WEEKLY: research saved in an earlier week is never reused for a same-named request', async () => {
  resetMock();
  const data = tmp('data'), out = tmp('out');
  const opts = mockOptions({ dataDir: data, outDir: out });
  // Last month's "req-tool-of-week" answered a different question and has no pricing (so it never looks stale).
  const old = { story_id: 'req-tool-of-week', headline: 'Old tool', verified: true, pricing: [], limitations: [],
    claims: [{ claim_id: 'req-tool-of-week:c1', text: 'BOGUS last month claim', claim_type: 'feature', status: 'confirmed', evidence_urls: ['https://old.example/x'] }] };
  fs.writeFileSync(path.join(data, 'research.json'), JSON.stringify([{ story_id: 'req-tool-of-week', checked_at: '2026-09-01T00:00:00Z', packet: old }]));
  await quiet(() => runWorkflow('daily', opts));
  const w = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w.ok, true, w.error);
  const packet = fs.readFileSync(path.join(out, '2026-10-18', 'research_packet.json'), 'utf8');
  assert.equal(packet.includes('BOGUS last month claim'), false);
});

test('WEEKLY: a sent issue is never regenerated, even with --force', async () => {
  resetMock();
  const data = tmp('data'), out = tmp('out');
  const opts = mockOptions({ dataDir: data, outDir: out });
  fs.writeFileSync(path.join(data, 'issues.json'), JSON.stringify([{ issue_date: '2026-10-18', status: 'sent', beehiiv_post_id: 'post_00000000-0000-0000-0000-00000000abcd' }]));
  const w = await quiet(() => runWorkflow('weekly', { ...opts, force: true }));
  assert.equal(w.status, 'sent');
  assert.equal(w.skipped, true);
  const issues = JSON.parse(fs.readFileSync(path.join(data, 'issues.json'), 'utf8'));
  assert.equal(issues[0].beehiiv_post_id, 'post_00000000-0000-0000-0000-00000000abcd');
});
