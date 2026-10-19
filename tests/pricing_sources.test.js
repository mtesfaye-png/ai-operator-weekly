// Regression tests: official pricing source verification (2026-10-19). A Tier 1 page is official only for
// its own vendor; unknown vendors make prices unverified; pricing evidence must be a successfully fetched page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { enforce, normDomain } = require('../src/agents/researcher');
const { compactPacket } = require('../src/agents/writer');
const { collectRetrieved } = require('../src/claude');
const { runGate } = require('../lib/quality_gate');
const F = require('./fixtures');

const newsletterCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/newsletter.json')));
const SOURCES = [
  { domain: 'vendor-a.example', tier: 1 },
  { domain: 'vendor-b.example', tier: 1 },
  { domain: 'news.example', tier: 2 },
  { domain: 'community.example', tier: 4 },
];
const NOW = '2026-10-18T13:00:00Z';

// One story with one price; returns the enforced price, its pricing claim and the story.
function run({ item, priceUrl, retrieved = [{ url: priceUrl, kind: 'fetch', retrieved_at: NOW }], officialPricing = {} }) {
  const packet = { stories: [{
    story_id: item.story_id, verified: true, limitations: [],
    claims: [{ claim_id: 'p1', text: 'Current pricing', claim_type: 'pricing', status: 'confirmed', evidence_urls: [priceUrl] }],
    pricing: [{ product: 'Widget', plan: 'Pro', amount: 20, currency: 'USD', billing_basis: 'per_month', source_url: priceUrl, source_is_official: true /* model's claim: ignored */ }],
  }] };
  enforce(packet, retrieved, { sources: SOURCES, items: [item], officialPricing });
  const st = packet.stories[0];
  return { price: st.pricing[0], claim: st.claims[0], story: st };
}
const req = (vendor_domains) => ({ story_id: 'req-tool', kind: 'tool_pricing', vendor_domains });

test('PRICING SOURCE: Vendor B\'s Tier 1 pricing page is not official for Vendor A', () => {
  const { price, claim } = run({ item: req(['vendor-a.example']), priceUrl: 'https://vendor-b.example/pricing' });
  assert.equal(price.source_is_official, false);
  assert.match(price.unverified_reason, /vendor-b\.example is not one of the vendor's pricing domains \(vendor-a\.example\)/);
  assert.equal(claim.status, 'unverified', 'the pricing claim citing Vendor B is not usable either');
});

test('PRICING SOURCE: the vendor\'s own domain and its subdomains are official; look-alikes are not', () => {
  const item = req(['https://www.Vendor-A.example/']);
  assert.equal(run({ item, priceUrl: 'https://vendor-a.example/pricing' }).price.source_is_official, true);
  assert.equal(run({ item, priceUrl: 'https://docs.vendor-a.example/api/pricing' }).price.source_is_official, true);
  assert.equal(run({ item, priceUrl: 'https://vendor-a.example.evil.example/pricing' }).price.source_is_official, false);
  assert.equal(run({ item, priceUrl: 'https://notvendor-a.example/pricing' }).price.source_is_official, false);
});

test('PRICING SOURCE: an unknown vendor domain makes the price unverified, hidden from the writer, and blocks the gate', () => {
  const { price, story } = run({ item: req([]), priceUrl: 'https://vendor-a.example/pricing' });
  assert.equal(price.source_is_official, false);
  assert.equal(price.unverified_reason, 'vendor domain unknown');
  assert.ok(story.limitations.some((l) => /UNVERIFIED/.test(l)));
  assert.deepEqual(compactPacket([{ stories: [story] }])[0].pricing, []);
  const packet = F.packet();
  packet.stories[0].pricing.push(price);
  const g = runGate({ draft: F.draft(), packet, factCheck: F.passFactCheck(), newsletterCfg, window: F.WINDOW, now: F.NOW });
  assert.ok(g.blocking.some((b) => b.code === 'PRICE_UNVERIFIED' && /vendor domain unknown/.test(b.detail)));
});

test('PRICING SOURCE: a price with no official flag at all cannot pass the gate', () => {
  const packet = F.packet();
  delete packet.stories[0].pricing[0].source_is_official;
  const g = runGate({ draft: F.draft(), packet, factCheck: F.passFactCheck(), newsletterCfg, window: F.WINDOW, now: F.NOW });
  assert.equal(g.pass, false);
  assert.ok(g.blocking.some((b) => b.code === 'PRICE_UNVERIFIED'));
});

test('PRICING SOURCE: publishers and communities are never a vendor, and unregistered claimed domains are not trusted', () => {
  const news = run({ item: req(['news.example']), priceUrl: 'https://news.example/widget-pricing' }).price;
  assert.equal(news.source_is_official, false);
  assert.match(news.unverified_reason, /registry Tier 2 publisher\/community, not a vendor/);
  const claimedOnly = run({ item: req(['startup.example']), priceUrl: 'https://startup.example/pricing' }).price;
  assert.equal(claimedOnly.source_is_official, false, 'a domain the model named is not verified by itself');
});

test('PRICING SOURCE: an unregistered vendor is trusted only via the story\'s own fetched primary page', () => {
  const story = { story_id: '2026-10-17-startup-launch', primary_url: 'https://startup.example/blog/launch', vendor_domains: ['startup.example'] };
  const fetchedPrimary = [{ url: 'https://startup.example/pricing', kind: 'fetch', retrieved_at: NOW }, { url: story.primary_url, kind: 'fetch', retrieved_at: NOW }];
  assert.equal(run({ item: story, priceUrl: 'https://startup.example/pricing', retrieved: fetchedPrimary }).price.source_is_official, true);
  const searchOnly = [{ url: 'https://startup.example/pricing', kind: 'fetch', retrieved_at: NOW }, { url: story.primary_url, kind: 'search' }];
  assert.equal(run({ item: story, priceUrl: 'https://startup.example/pricing', retrieved: searchOnly }).price.source_is_official, false);
  const newsPrimary = { ...story, primary_url: 'https://news.example/startup-launch', vendor_domains: ['news.example'] };
  assert.equal(run({ item: newsPrimary, priceUrl: 'https://news.example/x', retrieved: [{ url: 'https://news.example/x', kind: 'fetch', retrieved_at: NOW }, { url: newsPrimary.primary_url, kind: 'fetch', retrieved_at: NOW }] }).price.source_is_official, false);
});

test('PRICING SOURCE: explicitly listed official pricing domains work, and only for their own vendor', () => {
  const officialPricing = { 'vendor-a.example': ['vendor-a-app.example'] };
  assert.equal(run({ item: req(['vendor-a.example']), priceUrl: 'https://vendor-a-app.example/pricing' }).price.source_is_official, false, 'not listed: not official');
  assert.equal(run({ item: req(['vendor-a.example']), priceUrl: 'https://vendor-a-app.example/pricing', officialPricing }).price.source_is_official, true);
  assert.equal(run({ item: req(['vendor-b.example']), priceUrl: 'https://vendor-a-app.example/pricing', officialPricing }).price.source_is_official, false);
  // Shipped config: GitHub (registry Tier 4 github.com) is a vendor only through its listed group.
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/official_pricing_domains.json'))).vendors;
  const sources = [...SOURCES, { domain: 'github.com', tier: 4 }, { domain: 'github.blog', tier: 1 }];
  const packet = { stories: [{ story_id: 'req-copilot', verified: true, limitations: [], claims: [], pricing: [{ product: 'Copilot', plan: 'Pro', amount: 10, currency: 'USD', billing_basis: 'per_month', source_url: 'https://github.com/features/copilot/plans' }] }] };
  enforce(packet, [{ url: 'https://github.com/features/copilot/plans', kind: 'fetch', retrieved_at: NOW }], { sources, items: [req(['github.blog'])].map((i) => ({ ...i, story_id: 'req-copilot' })), officialPricing: shipped });
  assert.equal(packet.stories[0].pricing[0].source_is_official, true);
});

test('PRICING SOURCE: pricing evidence must be a successfully fetched page', () => {
  const item = req(['vendor-a.example']);
  const searchHit = run({ item, priceUrl: 'https://vendor-a.example/pricing', retrieved: [{ url: 'https://vendor-a.example/pricing', kind: 'search' }] });
  assert.equal(searchHit.price, undefined, 'price dropped when its page was only a search result');
  assert.equal(searchHit.claim.status, 'unverified');
  // A fetch that errored never counts as retrieved.
  const retrieved = [];
  collectRetrieved([
    { type: 'web_fetch_tool_result', tool_use_id: 't1', content: { type: 'web_fetch_tool_error', error_code: 'url_not_accessible' } },
    { type: 'web_fetch_tool_result', tool_use_id: 't2', content: { type: 'web_fetch_result', url: 'https://vendor-a.example/ok', retrieved_at: NOW } },
  ], retrieved);
  assert.deepEqual(retrieved.map((r) => r.url), ['https://vendor-a.example/ok']);
});

test('PRICING SOURCE: domain normalisation', () => {
  assert.equal(normDomain('https://www.Example.COM/pricing?x=1'), 'example.com');
  assert.equal(normDomain('com'), '');
  assert.equal(normDomain(''), '');
});

test('AOW_MAX_USD can lower the per-run cap but never raise it', () => {
  const { effectiveMaxUsd } = require('../src/run');
  const prev = process.env.AOW_MAX_USD;
  try {
    process.env.AOW_MAX_USD = '1'; assert.equal(effectiveMaxUsd(4), 1);
    process.env.AOW_MAX_USD = '50'; assert.equal(effectiveMaxUsd(4), 4);
    process.env.AOW_MAX_USD = 'abc'; assert.equal(effectiveMaxUsd(4), 4);
  } finally { if (prev === undefined) delete process.env.AOW_MAX_USD; else process.env.AOW_MAX_USD = prev; }
});
