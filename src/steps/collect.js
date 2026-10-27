// RSS-only collection: public feeds -> normalize -> dedupe -> save. Makes no Claude, web-search or
// beehiiv calls. Everything a feed can't tell us (scores, category, companies, summary, research,
// verification) is left empty and labelled as pending Claude processing, never guessed.

const crypto = require('crypto');
const { collect: fetchFeeds } = require('../rss');
const { normalizeUrl } = require('../../lib/dedupe');
const { LocalStore } = require('../store');
const { todayIn } = require('../util');

const PENDING_CLAUDE = 'ai_scores, story_category, companies, factual_summary, research, fact_check';

const articleId = (url) => `art_${crypto.createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 16)}`;
// Exact headline identity after case/punctuation folding. Deterministic: no similarity guessing.
const titleKey = (t) => t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

function normalize(item, { runId, nowIso, tz }) {
  return {
    article_id: articleId(item.url),
    title: item.title,
    url: item.url,
    normalized_url: normalizeUrl(item.url),
    source: item.source,
    source_domain: item.domain,
    source_tier: item.tier,
    source_category: item.category || '', // from config/sources.csv, not an AI judgement
    published_at: item.published,
    published_date: item.published ? todayIn(tz, new Date(item.published)) : null,
    feed_excerpt: item.excerpt || '', // publisher's own text, unverified
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    run_id: runId,
    status: 'collected',
    duplicate_of: null,
    duplicate_reason: null,
    claude_status: 'pending',
    verification_status: 'unverified',
    requires_claude: PENDING_CLAUDE,
  };
}

async function collectRss({ cfg, fetchImpl, store, log, runId, lookbackDays, now = new Date() }) {
  const lim = cfg.runtime.limits.collect;
  const days = lookbackDays || lim.lookback_days;
  const nowIso = now.toISOString();
  const sources = await store.listSources();
  const feeds = sources.filter((s) => s.rss_url);

  const { items, failures, stats } = await fetchFeeds(sources, { fetchImpl, lookbackDays: days, maxItems: lim.max_items, now });
  log.info(`RSS-only: ${items.length} items in the last ${days} days from ${feeds.length - failures.length}/${feeds.length} feeds`);
  if (failures.length) log.warn(`Feed failures: ${failures.map((f) => `${f.source} (${f.error})`).join(', ')}`);

  // Articles always live locally; Airtable (if configured) only gets a capped mirror of new ones.
  const local = new LocalStore(cfg.dataDir);
  const existing = await local.all('Articles');
  const byId = new Map(existing.map((a) => [a.article_id, a]));
  const titleOwner = new Map(existing.filter((a) => a.status === 'collected').map((a) => [titleKey(a.title), a.article_id]));

  const seenUrl = new Set();
  const out = [], counts = { url_duplicates_in_run: 0, already_stored: 0, title_duplicates: 0, new_articles: 0 };
  // Items arrive sorted by tier then date, so the best-tier copy of a story claims it first.
  for (const it of items) {
    const a = normalize(it, { runId, nowIso, tz: cfg.timezone });
    if (seenUrl.has(a.normalized_url)) { counts.url_duplicates_in_run++; continue; }
    seenUrl.add(a.normalized_url);
    const prev = byId.get(a.article_id);
    if (prev) { counts.already_stored++; out.push({ article_id: a.article_id, last_seen_at: nowIso }); continue; }
    const key = titleKey(a.title);
    const owner = key.split(' ').length >= lim.title_dedupe_min_words ? titleOwner.get(key) : undefined;
    if (owner) { counts.title_duplicates++; Object.assign(a, { status: 'duplicate', duplicate_of: owner, duplicate_reason: 'same_title' }); }
    else { counts.new_articles++; titleOwner.set(key, a.article_id); }
    out.push(a);
  }
  await local.upsert('Articles', out);

  let airtable = { synced: 0, skipped_over_cap: 0 };
  if (store.kind === 'airtable') {
    const all = await local.all('Articles');
    const pending = all.filter((a) => a.status === 'collected' && !a.airtable_synced_at && out.some((o) => o.article_id === a.article_id));
    const push = pending.slice(0, lim.airtable_max_new_per_run);
    if (push.length) {
      await store.upsertArticles(push.map(({ airtable_synced_at, ...a }) => a));
      await local.upsert('Articles', push.map((a) => ({ article_id: a.article_id, airtable_synced_at: nowIso })));
    }
    airtable = { synced: push.length, skipped_over_cap: pending.length - push.length };
    log.info(`Airtable: mirrored ${push.length} new articles (${airtable.skipped_over_cap} held back by airtable_max_new_per_run)`);
  }

  const dated = out.filter((a) => a.published_at).map((a) => a.published_at).sort();
  const saved = out.filter((a) => a.title);
  return {
    mode: 'rss_only',
    lookback_days: days,
    feeds: { total: feeds.length, working: stats.filter((s) => s.ok), failed: stats.filter((s) => !s.ok) },
    sources_without_rss: sources.filter((s) => !s.rss_url).map((s) => s.name),
    items_fetched_in_window: items.length,
    ...counts,
    undated_items: saved.filter((a) => !a.published_at).length,
    date_range: dated.length ? { oldest: dated[0], newest: dated[dated.length - 1] } : null,
    saved_records: saved.length,
    stored_total: (await local.all('Articles')).length,
    store_file: local.file('Articles'),
    airtable,
    examples: saved.filter((a) => a.status === 'collected').slice(0, 5).map((a) => ({ title: a.title, source: a.source, published_at: a.published_at, url: a.url })),
    pending_claude_fields: PENDING_CLAUDE,
  };
}

module.exports = { collectRss, titleKey, articleId };
