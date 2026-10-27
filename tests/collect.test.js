// RSS-only collection: fixture feeds in, normalized + deduplicated articles out, and no paid host ever
// contacted. Feeds are served from memory, so these tests need no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runWorkflow } = require('../src/run');
const { load } = require('../src/config');
const { AirtableStore } = require('../src/store');
const { makeFakeAirtable } = require('./mocks/fakeAirtable');
const { encode } = require('../src/store/codec');

const NOW = new Date('2026-10-27T12:00:00Z');
const quiet = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `aow-${n}-`));

const SOURCES = [
  { name: 'Vendor Blog', domain: 'vendor.example', tier: 1, category: 'frontier_models', rss_url: 'https://vendor.example/rss.xml', active: true },
  { name: 'Tech Site', domain: 'techsite.example', tier: 2, category: 'tools', rss_url: 'https://techsite.example/atom', active: true },
  { name: 'Broken Feed', domain: 'broken.example', tier: 2, category: 'business', rss_url: 'https://broken.example/feed', active: true },
  { name: 'No Feed', domain: 'nofeed.example', tier: 2, category: 'business', rss_url: '', active: true },
];

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Vendor ships Model X-9 to all API customers</title><link>https://vendor.example/news/x9</link><pubDate>Mon, 26 Oct 2026 15:00:00 GMT</pubDate><description><![CDATA[<p>Model X-9 is now generally available &amp; priced per token.</p>]]></description></item>
<item><title>Vendor ships Model X-9 to all API customers</title><link>https://www.vendor.example/news/x9/?utm_source=rss</link><pubDate>Mon, 26 Oct 2026 15:00:00 GMT</pubDate></item>
<item><title>Old post outside the window</title><link>https://vendor.example/news/old</link><pubDate>Mon, 12 Oct 2026 15:00:00 GMT</pubDate></item>
<item><title>Undated changelog entry for agents</title><link>https://vendor.example/changelog/agents</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Vendor Ships Model X-9 to All API Customers!</title><link rel="alternate" href="https://techsite.example/2026/10/26/x9"/><updated>2026-10-26T18:00:00Z</updated><summary>Coverage of the X-9 launch.</summary></entry>
<entry><title>Startup raises seed round for eval tooling</title><link href="https://techsite.example/2026/10/25/evals"/><published>2026-10-25T09:00:00Z</published></entry>
</feed>`;

function feeds(extra = () => null) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(String(url));
    const hit = await extra(url, opts);
    if (hit) return hit;
    const body = { 'https://vendor.example/rss.xml': RSS, 'https://techsite.example/atom': ATOM }[url];
    if (body) return { ok: true, status: 200, text: async () => body };
    if (String(url).startsWith('https://broken.example')) return { ok: false, status: 503, text: async () => '' };
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchImpl, calls };
}

function cfgFor(dataDir, airtable = { token: '', baseId: '' }) {
  const c = load();
  fs.writeFileSync(path.join(dataDir, 'sources.json'), JSON.stringify(SOURCES));
  return { ...c, dataDir, outDir: tmp('out'), timezone: 'America/New_York', anthropic: { apiKey: '', baseUrl: 'https://api.anthropic.com' }, airtable, alerts: { slackWebhook: '' } };
}
const articles = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'articles.json'), 'utf8'));

test('COLLECT: normalizes, dedupes by URL and exact title, reports sources, and labels Claude fields as pending', async () => {
  const dir = tmp('collect');
  const { fetchImpl, calls } = feeds();
  const r = await quiet(() => runWorkflow('collect', { cfg: cfgFor(dir), fetchImpl, now: NOW }));
  assert.equal(r.ok, true, r.error);

  assert.deepEqual(r.feeds.working.map((f) => f.source).sort(), ['Tech Site', 'Vendor Blog']);
  assert.deepEqual(r.feeds.failed.map((f) => [f.source, f.error]), [['Broken Feed', 'HTTP 503']]);
  assert.deepEqual(r.sources_without_rss, ['No Feed']);
  assert.equal(r.items_fetched_in_window, 5, 'old post dropped, undated kept');
  assert.equal(r.url_duplicates_in_run, 1, 'utm/www/trailing-slash copy is the same URL');
  assert.equal(r.title_duplicates, 1, 'same headline on another site');
  assert.equal(r.new_articles, 3);
  assert.equal(r.undated_items, 1);
  assert.equal(r.saved_records, 4);
  assert.deepEqual(r.date_range, { oldest: '2026-10-25T09:00:00.000Z', newest: '2026-10-26T18:00:00.000Z' });

  const rows = articles(dir);
  const x9 = rows.find((a) => a.url === 'https://vendor.example/news/x9');
  assert.equal(x9.status, 'collected', 'tier-1 copy is canonical');
  assert.equal(x9.feed_excerpt, 'Model X-9 is now generally available & priced per token.');
  assert.equal(x9.published_date, '2026-10-26');
  const dup = rows.find((a) => a.source === 'Tech Site' && a.status === 'duplicate');
  assert.equal(dup.duplicate_of, x9.article_id);
  assert.equal(dup.duplicate_reason, 'same_title');
  for (const a of rows) {
    assert.equal(a.claude_status, 'pending');
    assert.equal(a.verification_status, 'unverified');
    assert.match(a.requires_claude, /ai_scores/);
    for (const k of ['scores', 'total_score', 'companies', 'factual_summary', 'why_it_might_matter']) assert.ok(!(k in a), `no fabricated ${k}`);
  }

  // Zero paid calls: only feed hosts were contacted and no Claude call was budgeted.
  assert.ok(calls.every((u) => !/anthropic|beehiiv/.test(u)));
  assert.equal(r.network.paid_api_calls, 0);
  assert.equal(r.network.blocked_paid_attempts, 0);
  assert.deepEqual(Object.keys(r.network.attempts_by_host).sort(), ['broken.example', 'techsite.example', 'vendor.example']);
  assert.equal(r.budget.calls, 0);
});

test('COLLECT: a second run recognizes stored articles instead of saving them again', async () => {
  const dir = tmp('collect2');
  const cfg = cfgFor(dir);
  await quiet(() => runWorkflow('collect', { cfg, fetchImpl: feeds().fetchImpl, now: NOW }));
  const later = new Date(NOW.getTime() + 3600000);
  const r = await quiet(() => runWorkflow('collect', { cfg, fetchImpl: feeds().fetchImpl, now: later }));
  assert.equal(r.already_stored, 4);
  assert.equal(r.new_articles, 0);
  assert.equal(r.saved_records, 0);
  const rows = articles(dir);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((a) => a.first_seen_at === NOW.toISOString() && a.last_seen_at === later.toISOString()));
});

test('COLLECT: the network guard refuses paid hosts even if something tries to call them', async () => {
  const dir = tmp('guard');
  const { fetchImpl } = feeds();
  const evil = { ...SOURCES[0], name: 'Trap', domain: 'api.anthropic.com', rss_url: 'https://api.anthropic.com/v1/messages' };
  const cfg = cfgFor(dir);
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify([...SOURCES, evil]));
  const r = await quiet(() => runWorkflow('collect', { cfg, fetchImpl, now: NOW }));
  assert.equal(r.ok, true);
  assert.equal(r.network.blocked_paid_attempts, 1);
  assert.match(r.feeds.failed.find((f) => f.source === 'Trap').error, /refuses paid host api\.anthropic\.com/);
  assert.ok(!('api.anthropic.com' in r.network.attempts_by_host));
});

test('COLLECT + AIRTABLE: mirrors only new canonical articles, capped, in batches of 10, once', async () => {
  const dir = tmp('collect-at');
  const at = makeFakeAirtable('appFREE');
  at.tables.Sources = SOURCES.map((s, i) => ({ id: `recS${i}`, fields: encode('Sources', s) }));
  const { fetchImpl } = feeds((url, opts) => at.handle(url, opts));
  const cfg = cfgFor(dir, { token: 'patTEST', baseId: 'appFREE', throttleMs: 0 });
  cfg.runtime = { ...cfg.runtime, limits: { ...cfg.runtime.limits, collect: { ...cfg.runtime.limits.collect, airtable_max_new_per_run: 2 } } };

  const r = await quiet(() => runWorkflow('collect', { cfg, fetchImpl, now: NOW }));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.airtable, { synced: 2, skipped_over_cap: 1 });
  assert.equal(at.tables.Articles.length, 2);
  assert.ok(at.tables.Articles.every((x) => x.fields.status === 'collected' && x.fields.claude_status === 'pending'));
  // 1 Sources read + 1 Articles upsert + 1 Run Log append.
  assert.deepEqual(at.requests.map((q) => `${q.method} ${q.table}`), ['GET Sources', 'PATCH Articles', 'POST Run Log']);
  assert.ok(at.requests.every((q) => !q.body || q.body.records.length <= 10));

  const r2 = await quiet(() => runWorkflow('collect', { cfg, fetchImpl, now: new Date(NOW.getTime() + 3600000) }));
  assert.deepEqual(r2.airtable, { synced: 1, skipped_over_cap: 0 }, 'the held-back article drains next run');
  const r3 = await quiet(() => runWorkflow('collect', { cfg, fetchImpl, now: new Date(NOW.getTime() + 7200000) }));
  assert.deepEqual(r3.airtable, { synced: 0, skipped_over_cap: 0 }, 'synced articles are never re-sent');
  assert.equal(at.tables.Articles.length, 3);
  assert.equal(at.requests.filter((q) => q.table === 'Articles').length, 2);
});

test('AIRTABLE: the Free-plan monthly call limit fails fast instead of retrying', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return { status: 429, ok: false, json: async () => ({ errors: [{ error: 'PUBLIC_API_BILLING_LIMIT_EXCEEDED' }] }) }; };
  const s = new AirtableStore({ token: 't', baseId: 'appX', throttleMs: 0 }, fetchImpl);
  await assert.rejects(() => s.all('Sources'), /monthly API call limit/);
  assert.equal(n, 1);
});

test('RSS: entity-escaped and double-escaped HTML in feeds is reduced to plain text', () => {
  const { parseFeed } = require('../src/rss');
  const xml = `<feed><entry><title>Mixture &amp;amp; experts</title><link href="https://www.reddit.com/r/x/1"/><updated>2026-10-26T00:00:00Z</updated>
<content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;You&amp;#39;d &lt;strong&gt;like&lt;/strong&gt; this&lt;/p&gt;&lt;/div&gt;</content></entry></feed>`;
  const [it] = parseFeed(xml);
  assert.equal(it.excerpt, "You'd like this");
  assert.equal(it.title, 'Mixture & experts');
  const rss = `<rss><channel><item><title>T</title><link>https://blog.google/a/</link><description>&lt;img src="https://x/y.webp"&gt;Learn AI literacy</description></item></channel></rss>`;
  assert.equal(parseFeed(rss)[0].excerpt, 'Learn AI literacy');
});
