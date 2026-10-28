// Stage 3: free RSS-only collection scheduled by n8n on a local PC. Covers the trigger server's collect-only
// allow-list, the cross-process lock, repeated scheduled runs through the server without Airtable duplicates
// (including a fresh container), archiving old rows, the n8n workflow's outcome logic, and the localhost-only
// Docker setup. No network: feeds and Airtable are in memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const { runWorkflow } = require('../src/run');
const { load } = require('../src/config');
const { createServer, allowedWorkflows } = require('../src/server');
const lock = require('../src/store/lock');
const { usageWarning } = require('../src/steps/collect');
const { airtableStatus } = require('../src/cli');
const { makeFakeAirtable } = require('./mocks/fakeAirtable');
const { encode } = require('../src/store/codec');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'test-trigger-token-0123456789abcdef';
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `aow-s3-${n}-`));
const quiet = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };
const DAY = 86400000;
const T0 = new Date('2026-10-28T11:05:00Z');

const SOURCES = [
  { name: 'Vendor Blog', domain: 'vendor.example', tier: 1, category: 'frontier_models', rss_url: 'https://vendor.example/rss.xml', active: true },
  { name: 'Tech Site', domain: 'techsite.example', tier: 2, category: 'tools', rss_url: 'https://techsite.example/rss.xml', active: true },
];

// Feeds whose items can grow from day to day, like real ones.
function makeFeeds() {
  const items = { 'https://vendor.example/rss.xml': [], 'https://techsite.example/rss.xml': [] };
  const add = (feed, slug, title, at) => items[feed].push({ slug, title, at });
  const rss = (feed) => `<?xml version="1.0"?><rss><channel>${items[feed].map((i) => `<item><title>${i.title}</title><link>${new URL(feed).origin}/news/${i.slug}</link><pubDate>${i.at.toUTCString()}</pubDate><description>About ${i.title}</description></item>`).join('')}</channel></rss>`;
  const fetchFeed = (url) => (items[url] ? { ok: true, status: 200, text: async () => rss(url) } : null);
  return { add, fetchFeed };
}

function setup(dataDir = tmp('data')) {
  const at = makeFakeAirtable('appSTAGE3');
  at.tables.Sources = SOURCES.map((s, i) => ({ id: `recS${i}`, fields: encode('Sources', s) }));
  const feeds = makeFeeds();
  const paid = [];
  const fetchImpl = async (url, opts) => {
    if (/anthropic|beehiiv/.test(String(url))) paid.push(String(url));
    return (await at.handle(url, opts)) || feeds.fetchFeed(String(url)) || Promise.reject(new Error(`unexpected fetch ${url}`));
  };
  const cfgAt = (dir) => ({ ...load(), dataDir: dir, outDir: tmp('out'), timezone: 'America/New_York', anthropic: { apiKey: '', baseUrl: 'https://api.anthropic.com' }, airtable: { token: 'patTEST', baseId: 'appSTAGE3', throttleMs: 0 }, alerts: { slackWebhook: '' }, server: { token: TOKEN, port: 0 } });
  return { at, feeds, fetchImpl, paid, cfg: cfgAt(dataDir), cfgAt };
}

// Start the real trigger server on 127.0.0.1 with an injected runner (fake feeds + fake Airtable + clock).
async function serve({ cfg, run, allowed }) {
  const server = createServer({ cfg, runWorkflow: run, allowed: allowed || allowedWorkflows({}) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, token = TOKEN) => {
    const res = await fetch(base + p, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

const articleIds = (at) => at.tables.Articles?.map((r) => r.fields.article_id) || [];

test('SERVER: only collect is enabled by default; paid workflows are refused before anything runs', async () => {
  const started = [];
  const s = await serve({ cfg: setup().cfg, run: async (w) => { started.push(w); return { ok: true }; } });
  try {
    assert.deepEqual([...allowedWorkflows({})], ['collect']);
    for (const w of ['daily', 'weekly', 'analytics']) {
      const r = await s.call('POST', `/run/${w}`, {});
      assert.equal(r.status, 403, w);
      assert.match(r.json.error, /not enabled/);
    }
    assert.equal((await s.call('POST', '/run/publish', {})).status, 404);
    assert.deepEqual(started, [], 'no workflow was started');
    assert.throws(() => allowedWorkflows({ AOW_SERVER_WORKFLOWS: 'collect,sendall' }), /unknown workflow/);
    assert.deepEqual([...allowedWorkflows({ AOW_SERVER_WORKFLOWS: 'collect, daily' })], ['collect', 'daily'], 'paid ones only when listed explicitly');
  } finally { await s.close(); }
});

test('SERVER: bearer token required, input validated, one collect at a time, wait returns the result', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const seen = [];
  const s = await serve({ cfg: setup().cfg, run: async (w, o) => { seen.push(o); await gate; return { ok: true, run_id: 'collect-x', new_articles: 2 }; } });
  try {
    assert.equal((await s.call('GET', '/health', undefined, null)).status, 200);
    assert.equal((await s.call('POST', '/run/collect', {}, null)).status, 401);
    assert.equal((await s.call('POST', '/run/collect', {}, 'wrong-token-of-another-length')).status, 401);
    assert.equal((await s.call('POST', '/run/collect', '{nope')).status, 400);
    assert.equal((await s.call('POST', '/run/collect', JSON.stringify({ pad: 'x'.repeat(20000) }))).status, 413);
    assert.equal((await s.call('POST', '/run/collect', { days: 99 })).status, 400);
    assert.equal((await s.call('POST', '/run/collect', { max_sync: -1 })).status, 400);
    assert.equal(seen.length, 0, 'invalid requests never start a run');

    const first = s.call('POST', '/run/collect', { days: 3, max_sync: 5, wait: true });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await s.call('POST', '/run/collect', { wait: true })).status, 409, 'second concurrent run refused');
    release();
    const r = await first;
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'finished');
    assert.equal(r.json.result.new_articles, 2);
    assert.deepEqual({ days: seen[0].lookbackDays, max: seen[0].maxSync }, { days: 3, max: 5 });
    assert.equal((await s.call('GET', `/runs/${r.json.run_id}`)).json.status, 'finished');
  } finally { await s.close(); }
});

test('LOCK: a second collect process is skipped without fetching anything; a stale lock is taken over', async () => {
  const env = setup();
  const release = lock.acquire(env.cfg.dataDir, 'collect');
  assert.ok(release);
  assert.equal(lock.acquire(env.cfg.dataDir, 'collect'), null);
  let fetched = 0;
  const r = await quiet(() => runWorkflow('collect', { cfg: env.cfg, fetchImpl: async () => { fetched++; }, now: T0 }));
  assert.deepEqual([r.ok, r.status, fetched], [true, 'skipped', 0]);
  release();
  fs.writeFileSync(path.join(env.cfg.dataDir, 'collect.lock'), JSON.stringify({ at: new Date(Date.now() - lock.STALE_MS - 1000).toISOString() }));
  const again = lock.acquire(env.cfg.dataDir, 'collect');
  assert.ok(again, 'stale lock from a crash is replaced');
  again();
  assert.equal(fs.existsSync(path.join(env.cfg.dataDir, 'collect.lock')), false);
});

test('REPEATED RUNS via the n8n trigger: new articles are added each day, nothing is ever duplicated, even after a fresh container', async () => {
  const env = setup();
  let now = T0;
  let cfg = env.cfg;
  const run = (w, o) => runWorkflow(w, { ...o, cfg, fetchImpl: env.fetchImpl, now });
  const s = await serve({ cfg, run });
  const collect = async () => (await quiet(() => s.call('POST', '/run/collect', { days: 3, wait: true }))).json.result;
  const assertNoDupes = () => assert.equal(new Set(articleIds(env.at)).size, articleIds(env.at).length, 'no duplicate article_id in Airtable');
  try {
    const V = 'https://vendor.example/rss.xml', TS = 'https://techsite.example/rss.xml';
    env.feeds.add(V, 'a1', 'Vendor launches agent toolkit for developers', new Date(T0 - 3600000));
    env.feeds.add(TS, 'b1', 'Startup ships open source eval harness', new Date(T0 - 7200000));
    let r = await collect();
    assert.deepEqual([r.ok, r.new_articles, r.airtable.synced], [true, 2, 2]);
    assert.equal(articleIds(env.at).length, 2);

    // Day 2: same items again plus one new legitimate article.
    now = new Date(T0.getTime() + DAY);
    env.feeds.add(V, 'a2', 'Vendor cuts API prices for batch jobs', new Date(now - 3600000));
    r = await collect();
    assert.deepEqual([r.new_articles, r.already_stored, r.airtable.synced], [1, 2, 1]);
    assert.equal(articleIds(env.at).length, 3);
    assertNoDupes();

    // Day 3: nothing new, n8n retries the same trigger twice.
    now = new Date(T0.getTime() + 2 * DAY);
    for (let i = 0; i < 2; i++) { r = await collect(); assert.equal(r.airtable.synced, 0); }
    assert.equal(articleIds(env.at).length, 3);

    // Day 4: the Docker volume was lost (new PC, `down -v`): empty data folder, plus one new article.
    now = new Date(T0.getTime() + 3 * DAY);
    cfg = env.cfgAt(tmp('fresh'));
    env.feeds.add(TS, 'b2', 'Robotics company raises Series B for warehouse agents', new Date(now - 3600000));
    env.at.requests.length = 0;
    r = await collect();
    assert.equal(r.airtable.reconciled.airtable_articles, 3, 'reads what Airtable already has before writing');
    const order = env.at.requests.map((q) => `${q.method} ${q.table}`);
    assert.ok(order.indexOf('GET Articles') >= 0 && order.indexOf('GET Articles') < order.indexOf('PATCH Articles'), `read before write: ${order}`);
    assert.equal(articleIds(env.at).length, 4, 'only the genuinely new article is added');
    assertNoDupes();
    assert.deepEqual(env.paid, [], 'no Anthropic or beehiiv call on any run');
  } finally { await s.close(); }
});

test('ARCHIVE: rows deleted in the Airtable UI stop counting and are never re-sent', async () => {
  const env = setup();
  const V = 'https://vendor.example/rss.xml';
  for (let i = 0; i < 5; i++) env.feeds.add(V, `n${i}`, `Vendor news item number ${i} about agents`, new Date(T0 - (i + 1) * 3600000));
  const first = await quiet(() => runWorkflow('collect', { cfg: env.cfg, fetchImpl: env.fetchImpl, now: T0 }));
  assert.equal(first.airtable.records_used_estimate, 2 + 5);

  // Editor archives 3 old rows (export CSV, then delete in the UI).
  env.at.tables.Articles.splice(0, 3);
  let out = '';
  const l = console.log; console.log = (s) => { out += `${s}\n`; };
  try { assert.equal(await airtableStatus({ cfg: env.cfg, fetchImpl: env.fetchImpl, now: T0 }), 0); } finally { console.log = l; }
  const status = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  assert.equal(status.records_total, 2 + 2);
  assert.equal(status.records_by_table.Articles, 2);
  assert.equal(status.newly_marked_archived, 3);
  assert.equal(Object.keys(status.records_by_table).length, 10, 'every table counts toward the Free limit');

  const next = await quiet(() => runWorkflow('collect', { cfg: env.cfg, fetchImpl: env.fetchImpl, now: new Date(T0.getTime() + 3600000) }));
  assert.equal(next.airtable.synced, 0, 'archived rows are not sent back');
  assert.equal(next.airtable.records_used_estimate, 2 + 2, 'freed records are available again');
});

test('LIMITS: usage warning at 80% of the app budgets (which sit below the Free plan limits)', () => {
  const at = { record_budget: 900, monthly_call_budget: 800 };
  assert.equal(usageWarning({ records: 100, calls: 100, at }), null);
  assert.match(usageWarning({ records: 720, calls: 10, at }), /records ≈720\/900/);
  assert.match(usageWarning({ records: 10, calls: 640, at }), /calls this month 640\/800/);
  const rt = load().runtime.airtable;
  assert.ok(rt.record_budget < 1000 && rt.monthly_call_budget < 1000);
});

test('N8N: the RSS workflow only calls /run/collect on the local collector and classifies every outcome', () => {
  const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n', 'rss-collect.json'), 'utf8'));
  const text = JSON.stringify(wf);
  assert.equal(/anthropic|beehiiv|\/run\/(daily|weekly|analytics)/i.test(text), false);
  assert.equal(wf.active, false);
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger'), 'manual test trigger');
  const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  const trigger = http.find((n) => n.parameters.url === 'http://aow:8787/run/collect');
  assert.ok(trigger, 'collector is reached on the private Docker network');
  assert.equal(trigger.credentials.httpHeaderAuth.name, 'AOW Trigger Token');
  assert.deepEqual(http.filter((n) => n !== trigger).map((n) => n.disabled), [true], 'the only other request is the optional alert, off by default');

  const code = wf.nodes.find((n) => n.type === 'n8n-nodes-base.code').parameters.jsCode;
  const run = (json) => vm.runInNewContext(`(function(){${code}})()`, { $input: { first: () => ({ json }) } })[0].json;
  const ok = (extra = {}) => ({ statusCode: 200, body: { result: { ok: true, new_articles: 4, feeds: { working: [{}], failed: [{ source: 'VentureBeat AI', error: 'HTTP 429' }] }, airtable: { synced: 4, error: null, ...extra }, network: { paid_api_calls: 0 } } } });
  assert.equal(run(ok()).outcome, 'ok', 'one known-broken feed is not an alert');
  assert.equal(run(ok()).synced_to_airtable, 4);
  assert.equal(run(ok({ usage_warning: 'Airtable records ≈800/900' })).outcome, 'warning');
  assert.equal(run(ok({ error: 'Airtable PATCH 422' })).outcome, 'failed');
  assert.equal(run(ok({ reconciled: false })).outcome, 'failed');
  assert.equal(run({ statusCode: 409, body: { error: 'collect is already running' } }).outcome, 'skipped');
  assert.equal(run({ statusCode: 200, body: { result: { ok: true, status: 'skipped' } } }).outcome, 'skipped');
  assert.equal(run({ statusCode: 401, body: {} }).outcome, 'failed');
  assert.equal(run({ statusCode: 403, body: { error: 'not enabled' } }).outcome, 'failed');
  assert.equal(run({ statusCode: 200, body: { result: { ok: false, error: 'boom' } } }).outcome, 'failed');
  assert.equal(run({ error: { message: 'connect ECONNREFUSED' } }).outcome, 'failed');
  assert.equal(run({ statusCode: 200, body: { result: { ok: true, feeds: { working: [], failed: [] }, airtable: {} } } }).outcome, 'failed');
});

test('DEPLOY: localhost-only ports, collect-only server, no paid keys, pinned n8n, secrets kept out of the image', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'deploy', 'windows', 'docker-compose.yml'), 'utf8');
  const ports = compose.match(/^\s+- "[^"]*:\d+"$/gm).map((s) => s.trim());
  assert.deepEqual(ports, ['- "127.0.0.1:8787:8787"', '- "127.0.0.1:5678:5678"']);
  assert.match(compose, /AOW_SERVER_WORKFLOWS: collect\n/);
  assert.equal(/ANTHROPIC|BEEHIIV|env_file/i.test(compose.replace(/^#.*$/gm, '')), false);
  assert.match(compose, /image: n8nio\/n8n:\d+\.\d+\.\d+\n/, 'n8n version pinned, never latest');
  assert.match(compose, /AIRTABLE_BASE_ID: \$\{AIRTABLE_BASE_ID:\?/, 'uses the existing base; never creates one');
  const ignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').split('\n');
  for (const p of ['.env', 'data', '.git', 'deploy/windows/.env']) assert.ok(ignore.includes(p), p);
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.match(docker, /^USER node$/m);
  assert.equal(/setup_airtable|airtable:setup/.test(compose + fs.readFileSync(path.join(ROOT, 'deploy', 'windows', 'setup.ps1'), 'utf8')), false, 'the Windows setup never creates a base');
});
