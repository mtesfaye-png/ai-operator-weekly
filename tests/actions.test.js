// GitHub Actions cloud run: the workflow file stays free and safe (manual button + one schedule, read-only token,
// one run at a time, only Airtable secrets), and the job summary fails the run exactly when something is wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { classify, markdown } = require('../.github/scripts/collect-summary');

const ROOT = path.join(__dirname, '..');
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'rss-collect.yml'), 'utf8');

test('ACTIONS: workflow has a Run workflow button, one daily schedule, read-only permissions and no paid secrets', () => {
  assert.match(wf, /^\s{2}workflow_dispatch:/m);
  assert.equal((wf.match(/- cron:/g) || []).length, 1, 'exactly one schedule');
  assert.match(wf, /permissions:\n\s+contents: read/);
  assert.match(wf, /concurrency:\n\s+group: rss-collect\n\s+cancel-in-progress: false/);
  assert.match(wf, /timeout-minutes: 10/);
  const code = wf.replace(/^\s*#.*$/gm, '');
  assert.equal(/ANTHROPIC|BEEHIIV/i.test(code), false, 'no paid credentials reach the job');
  assert.deepEqual([...code.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]).sort(), ['AIRTABLE_BASE_ID', 'AIRTABLE_TOKEN']);
  assert.match(code, /node src\/cli\.js collect /, 'runs only the free collect command');
  assert.equal(/cli\.js (daily|weekly|analytics)/.test(code), false);
  assert.equal(/\$\{\{\s*inputs\.\w+\s*\}\}"?\s*$/m.test(code.split('run:').slice(1).join('')), false, 'inputs reach shell steps via env, not interpolation');
});

test('ACTIONS: the job summary fails the run only for real problems', () => {
  const ok = (airtable = {}, feeds = { total: 14, working: [{}], failed: [{ source: 'VentureBeat AI', error: 'HTTP 429' }] }) => ({ ok: true, feeds, airtable: { synced: 4, error: null, ...airtable }, network: { paid_api_calls: 0 } });
  assert.equal(classify(ok())[0], 'ok', 'a known-blocked feed is not a failure');
  assert.equal(classify(ok({ usage_warning: 'Airtable records ≈720/900' }))[0], 'warning');
  assert.equal(classify(ok({ skipped: 'monthly_call_budget_reached' }))[0], 'warning');
  assert.equal(classify(ok({ error: 'Airtable PATCH 422' }))[0], 'failed');
  assert.equal(classify(ok({ reconciled: false }))[0], 'failed');
  assert.equal(classify(ok({}, { total: 14, working: [], failed: [] }))[0], 'failed');
  assert.equal(classify({ ok: false, error: 'boom' })[0], 'failed');
  assert.equal(classify({ ok: true, status: 'skipped', reason: 'another collect run is in progress' })[0], 'skipped');
  const md = markdown({ ...ok(), examples: [{ title: 'A | B [x]', source: 'S', published_at: '2026-11-03T00:00:00Z', url: 'https://e.example/a' }] }, ['ok', 'fine']);
  assert.match(md, /Added to Airtable this run\*\* \| \*\*4\*\*/);
  assert.ok(md.includes('[A   B  x ](https://e.example/a)'), 'titles cannot break the table or the link');
});

test('BEEHIIV DEMO: exactly one draft, status draft, nothing scheduled; a re-run and a blocked plan create nothing', async () => {
  const os = require('os');
  const { main, buildDemoPayload } = require('../scripts/beehiiv-demo-draft');
  const env = { BEEHIIV_API_KEY: 'test-key', BEEHIIV_PUBLICATION_ID: 'pub_00000000-0000-0000-0000-000000000001' };
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aow-bh-')), 'm.json');
  const calls = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if ((opts.method || 'GET') === 'POST') return { status: 201, ok: true, json: async () => ({ data: { id: 'post_00000000-0000-0000-0000-0000000000aa' } }) };
    return { status: 200, ok: true, json: async () => ({ data: { id: 'post_00000000-0000-0000-0000-0000000000aa', status: 'draft' } }) };
  };
  const first = await main(['demo/2026-11-03', marker], { env, fetchImpl: fakeFetch });
  assert.equal(first.created, true);
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1, 'one create request, never retried');
  assert.equal(posts[0].body.status, 'draft');
  for (const k of ['scheduled_at', 'override_scheduled_at', 'recipients']) assert.equal(k in posts[0].body, false);
  assert.ok(calls.every((c) => c.method === 'POST' || /\/posts\/post_/.test(c.url)), 'only create + read-one endpoints');

  const again = await main(['demo/2026-11-03', marker], { env, fetchImpl: fakeFetch });
  assert.equal(again.created, false);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1, 're-run sends nothing');

  const blocked = await main(['demo/2026-11-03', `${marker}.2`], { env, fetchImpl: async () => ({ status: 403, ok: false, json: async () => ({ errors: [{ message: 'plan' }] }) }) });
  assert.deepEqual([blocked.created, blocked.plan_blocked], [false, true]);
  assert.equal(fs.existsSync(`${marker}.2`), false);

  const p = buildDemoPayload({ subject: 's', preview: 'p', html: 'x' });
  assert.equal(p.status, 'draft');
  assert.throws(() => require('../lib/beehiiv').assertDraftOnly({ ...p, status: 'confirmed' }), /must be "draft"/, 'a publish status is refused');
  const wf2 = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'beehiiv-draft.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
  assert.equal(/schedule:|cron:/.test(wf2), false, 'manual only');
  assert.match(wf2, /CREATE ONE DRAFT/);
});
