// The same full cycle, but with Airtable as the store (simulated Airtable REST API).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runWorkflow } = require('../src/run');
const { mockOptions } = require('./mocks/mockEnv');
const { fakeFetch, fakeState, resetMock, MOCK_SOURCES } = require('./mocks/fakeApis');
const { makeFakeAirtable } = require('./mocks/fakeAirtable');
const { encode } = require('../src/store/codec');

const quiet = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };

test('daily -> weekly -> analytics with Airtable as the store', async () => {
  resetMock();
  const at = makeFakeAirtable('appTEST123');
  at.tables.Sources = MOCK_SOURCES.map((s, i) => ({ id: `recS${i}`, fields: encode('Sources', s) }));
  const fetchImpl = async (url, opts) => (await at.handle(url, opts)) || fakeFetch(url, opts);
  const base = mockOptions({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'aow-at-')), outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'aow-ato-')) });
  const opts = { ...base, fetchImpl, cfg: { ...base.cfg, airtable: { token: 'patTEST', baseId: 'appTEST123', throttleMs: 0 } } };

  const d = await quiet(() => runWorkflow('daily', opts));
  assert.equal(d.ok, true, d.error);
  const w = await quiet(() => runWorkflow('weekly', opts));
  assert.equal(w.status, 'draft_in_beehiiv', w.error || JSON.stringify(w));
  fakeState.sent = true;
  const a = await quiet(() => runWorkflow('analytics', opts));
  assert.deepEqual(a.updated, ['2026-10-18']);

  // Records landed in the right tables with Airtable-shaped fields.
  const stories = at.tables.Stories.map((r) => r.fields);
  assert.ok(stories.some((s) => s.status === 'duplicate'));
  assert.ok(stories.find((s) => s.story_id === '2026-10-16-northwind-atlas-3').supporting_urls.includes('wire.example'));
  assert.ok(at.tables.Research.length >= 6);
  assert.ok(JSON.parse(at.tables.Research[0].fields.claims_json).length > 0);
  const issue = at.tables.Issues[0].fields;
  assert.equal(issue.status, 'sent');
  assert.equal(issue.gate_result, 'PASS');
  assert.match(issue.beehiiv_post_id, /^post_/);
  const perf = at.tables.Performance[0].fields;
  assert.ok(perf.open_rate > 0 && perf.open_rate < 1, 'percent stored as a fraction');
  assert.equal(at.tables['Run Log'].length, 3);
  assert.ok(at.requests.every((r) => !r.body || r.body.records.length <= 10), 'batches of 10');
});
