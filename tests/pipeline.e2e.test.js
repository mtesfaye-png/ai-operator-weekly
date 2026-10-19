// End-to-end: real pipeline code, simulated APIs. daily -> weekly -> analytics, plus failure paths.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runWorkflow } = require('../src/run');
const { mockOptions } = require('./mocks/mockEnv');
const { fakeState, resetMock } = require('./mocks/fakeApis');

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `aow-${n}-`));
const quiet = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };

test('full weekly cycle: daily scout -> weekly draft -> analytics', async () => {
  resetMock();
  const data = tmp('data'), out = tmp('out');
  const opts = mockOptions({ dataDir: data, outDir: out });

  const d = await quiet(() => runWorkflow('daily', opts));
  assert.equal(d.ok, true, d.error);
  assert.equal(d.out_of_window, 1, 'six-month-old story dropped by event date');
  assert.ok(d.duplicates >= 1, 'wire coverage merged into the vendor announcement');
  assert.equal(d.rss_failures, 1, 'failed feed reported, run continued');
  const stories = JSON.parse(fs.readFileSync(path.join(data, 'stories.json'), 'utf8'));
  const atlas = stories.find((s) => s.story_id === '2026-10-16-northwind-atlas-3');
  assert.ok(atlas.supporting_urls.includes('https://wire.example/2026/10/16/northwind-atlas-3'));

  const w = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w.ok, true, w.error);
  assert.equal(w.status, 'draft_in_beehiiv', JSON.stringify(w));
  assert.match(w.preview_url, /beehiiv\.com\/posts\/post_/);

  // Exported files exist and the gate passed after one revision.
  const dir = path.join(out, '2026-10-18');
  for (const f of ['issue.md', 'issue.html', 'preview.html', 'research_packet.json', 'fact_check.json', 'gate.json', 'budget.json']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  const gate = JSON.parse(fs.readFileSync(path.join(dir, 'gate.json'), 'utf8'));
  assert.equal(gate.pass, true);
  const md = fs.readFileSync(path.join(dir, 'issue.md'), 'utf8');
  assert.equal(/largest/i.test(md), false, 'unsupported superlative removed by revision');
  assert.match(md, /\(checked Oct 18\)/, 'prices carry a checked date set from the fetch time');

  // Research enforcement: a benchmark claim citing a page that was never opened is unverified.
  const packet = JSON.parse(fs.readFileSync(path.join(dir, 'research_packet.json'), 'utf8'));
  const bench = packet.stories.flatMap((s) => s.claims).find((c) => c.claim_type === 'benchmark');
  assert.equal(bench.status, 'unverified');
  assert.equal(bench.evidence_urls.length, 0);
  assert.ok(packet.stories.flatMap((s) => s.pricing || []).every((p) => p.source_is_official && p.checked_at > '2026-10-17'));

  // beehiiv received a draft and nothing else.
  const posts = fakeState.calls.filter((c) => c.url.includes('api.beehiiv.com') && c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(Object.values(fakeState.posts)[0].status, 'draft');
  assert.ok(fakeState.calls.every((c) => !/test_send|send|confirm/.test(c.url.split('?')[0].split('/posts')[1] || '')));

  // Budget logged per call.
  const budget = JSON.parse(fs.readFileSync(path.join(dir, 'budget.json'), 'utf8'));
  assert.ok(budget.calls.length >= 6 && budget.est_usd > 0);

  // Re-running the same week does not create a second draft.
  const again = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(again.skipped, true);

  // After Mohil sends it, analytics records performance and marks the issue sent.
  fakeState.sent = true;
  const a = await quiet(() => runWorkflow('analytics', opts));
  assert.deepEqual(a.updated, ['2026-10-18']);
  const perf = JSON.parse(fs.readFileSync(path.join(data, 'performance.json'), 'utf8'))[0];
  assert.equal(perf.opens, 610);
  assert.equal(perf.top_sections[0].section, 'Resources Worth Saving');
  const issue = JSON.parse(fs.readFileSync(path.join(data, 'issues.json'), 'utf8'))[0];
  assert.equal(issue.status, 'sent');
  assert.match(a.summary, /open rate 51\.3%/);

  // Every run left a Run Log record.
  const runs = JSON.parse(fs.readFileSync(path.join(data, 'run_log.json'), 'utf8'));
  assert.equal(runs.length, 4);
});

test('broken beehiiv credential: issue preserved for manual paste and alert fired', async () => {
  resetMock();
  const opts = mockOptions({ dataDir: tmp('data'), outDir: tmp('out'), failBeehiiv: true });
  await quiet(() => runWorkflow('daily', opts));
  const w = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w.status, 'manual_fallback');
  assert.ok(fakeState.calls.some((c) => c.url.startsWith('https://slack.example')));
  const issue = JSON.parse(fs.readFileSync(path.join(opts.cfg.dataDir, 'issues.json'), 'utf8'))[0];
  assert.ok(issue.body_html.length > 500 && issue.status === 'manual_fallback');
});

test('not enough stories: weekly blocks instead of writing a thin issue', async () => {
  resetMock();
  const opts = mockOptions({ dataDir: tmp('data'), outDir: tmp('out') });
  const w = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w.status, 'blocked');
  assert.equal(fakeState.calls.filter((c) => c.url.includes('beehiiv')).length, 0);
});

test('budget cap stops a run cleanly and logs the error', async () => {
  resetMock();
  const opts = mockOptions({ dataDir: tmp('data'), outDir: tmp('out') });
  opts.cfg = { ...opts.cfg, runtime: { ...opts.cfg.runtime, limits: { ...opts.cfg.runtime.limits, daily: { ...opts.cfg.runtime.limits.daily, max_usd: 0.01 } } } };
  const d = await quiet(() => runWorkflow('daily', opts));
  assert.equal(d.ok, false);
  assert.match(d.error, /BUDGET/);
});

test('no code path can publish or send', () => {
  const files = ['lib', 'src', 'src/steps', 'src/agents', 'src/store'].flatMap((d) => fs.readdirSync(path.join(__dirname, '..', d)).filter((f) => f.endsWith('.js')).map((f) => path.join(__dirname, '..', d, f)));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.equal(/status\s*:\s*['"]confirmed['"]/.test(src), false, `${f} sets confirmed`);
    assert.equal(/test_send|\/send\b|scheduled_at\s*:/.test(src.replace(/FORBIDDEN_KEYS = \[[^\]]*\]/, '')), false, `${f} references a send/schedule path`);
  }
});
