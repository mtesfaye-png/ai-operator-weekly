// RSS-only collection: public feeds -> normalize -> dedupe -> label -> save. Makes no Claude, web-search or
// beehiiv calls. Everything a feed can't tell us (scores, story category, companies, summary, research,
// verification) is left empty and labelled as pending Claude processing, never guessed.
//
// The full archive always stays in data/articles.json. With Airtable connected, only editorial candidates
// (tier 1-2, on-topic, not duplicates) are mirrored, within the Free plan's record and API-call budgets.

const crypto = require('crypto');
const { collect: fetchFeeds } = require('../rss');
const { normalizeUrl } = require('../../lib/dedupe');
const { LocalStore, makeStore } = require('../store');
const usage = require('../store/usage');
const { todayIn } = require('../util');

const PENDING_CLAUDE = 'ai_scores, story_category, companies, factual_summary, research, fact_check';
const SIGNAL = { 1: 'primary_source', 2: 'news_reporting', 3: 'discovery_unverified', 4: 'community_unverified' };
// Deterministic keyword check for feeds that mix AI and non-AI posts. A heuristic flag, not a judgement.
const AI_TERMS = /\b(ai|a\.i\.|artificial intelligence|machine learning|llms?|gpt[\w.-]*|copilot|agents?|agentic|neural|deep learning|generative|genai|chatbots?|claude|gemini|openai|anthropic|inference|models?|gpus?|transformers?|robotics|autonomous|codex|reasoning)\b/i;

const articleId = (url) => `art_${crypto.createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 16)}`;
// Exact headline identity after case/punctuation folding. Deterministic: no similarity guessing.
const titleKey = (t) => t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// Labels derived from the record and config only, so they can be recomputed for stored articles.
function classify(a, lim) {
  const mixed = (lim.mixed_topic_domains || []).includes(a.source_domain);
  const topic_check = !mixed ? 'ai_feed' : AI_TERMS.test(`${a.title} ${a.feed_excerpt}`) ? 'keyword_match' : 'off_topic_flagged';
  const signal_type = SIGNAL[a.source_tier] || 'community_unverified';
  const why = a.status !== 'collected' ? 'duplicate'
    : topic_check === 'off_topic_flagged' ? 'off_topic_flagged'
      : a.source_tier > lim.candidate_max_tier ? `${signal_type}: discovery signal only` : null;
  return { signal_type, topic_check, editorial_candidate: !why, candidate_note: why };
}

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
    ranking_status: 'pending_claude',
    research_status: 'pending_claude',
    fact_check_status: 'pending_claude',
    verification_status: 'unverified',
    requires_claude: PENDING_CLAUDE,
  };
}

async function collectRss({ cfg, fetchImpl, store, log, runId, lookbackDays, now = new Date() }) {
  const lim = cfg.runtime.limits.collect;
  const at = cfg.runtime.airtable;
  const days = lookbackDays || lim.lookback_days;
  const nowIso = now.toISOString();

  // Don't spend Airtable calls once the monthly budget is used: read Sources from config instead.
  const airtableOn = store.kind === 'airtable' && usage.usedThisMonth(cfg.dataDir, now) + 1 <= at.monthly_call_budget;
  if (store.kind === 'airtable' && !airtableOn) log.warn(`Airtable monthly call budget (${at.monthly_call_budget}) used up: sources from config, no sync this run`);
  const sources = airtableOn ? await store.listSources() : await makeStore({ ...cfg, airtable: { token: '', baseId: '' } }).listSources();
  const feeds = sources.filter((s) => s.rss_url);

  const { items, failures, stats } = await fetchFeeds(sources, { fetchImpl, lookbackDays: days, maxItems: lim.max_items, now });
  log.info(`RSS-only: ${items.length} items in the last ${days} days from ${feeds.length - failures.length}/${feeds.length} feeds`);
  if (failures.length) log.warn(`Feed failures: ${failures.map((f) => `${f.source} (${f.error})`).join(', ')}`);

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
  // (Re)label the whole archive so config changes apply to older records too.
  const archive = await local.all('Articles');
  await local.upsert('Articles', archive.map((a) => ({ article_id: a.article_id, ...classify(a, lim) })));

  const airtable = store.kind === 'airtable'
    ? (airtableOn ? await syncCandidates({ cfg, store, local, sources, log, now }) : { skipped: 'monthly_call_budget_reached' })
    : { skipped: 'not_configured' };
  if (store.kind === 'airtable') airtable.calls_this_month = usage.addCalls(cfg.dataDir, store.apiCalls(), now);

  const saved = (await local.all('Articles')).filter((a) => out.some((o) => o.article_id === a.article_id && o.title));
  const dated = saved.filter((a) => a.published_at).map((a) => a.published_at).sort();
  const tally = (key) => saved.reduce((m, a) => ({ ...m, [a[key]]: (m[a[key]] || 0) + 1 }), {});
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
    new_by_signal_type: tally('signal_type'),
    new_by_topic_check: tally('topic_check'),
    new_editorial_candidates: saved.filter((a) => a.editorial_candidate).length,
    stored_total: archive.length,
    store_file: local.file('Articles'),
    airtable,
    examples: saved.filter((a) => a.editorial_candidate).slice(0, 5).map((a) => ({ title: a.title, source: a.source, published_at: a.published_at, url: a.url })),
    pending_claude_fields: PENDING_CLAUDE,
  };
}

// Mirror unsynced editorial candidates to Airtable, newest first by tier, within three caps: per run,
// remaining record budget for the base, and remaining monthly calls. Each batch of 10 is marked synced
// only after Airtable accepts it, and upserts merge on article_id, so a failed or repeated run neither
// loses nor duplicates articles: anything unsynced is retried next run.
async function syncCandidates({ cfg, store, local, sources, log, now }) {
  const lim = cfg.runtime.limits.collect, at = cfg.runtime.airtable;
  const all = await local.all('Articles');
  const since = new Date(now.getTime() - lim.airtable_sync_window_days * 86400000).toISOString();
  const pending = all.filter((a) => a.editorial_candidate && !a.airtable_synced_at && a.first_seen_at >= since)
    .sort((a, b) => a.source_tier - b.source_tier || String(b.published_at).localeCompare(String(a.published_at)));
  const recordsUsed = sources.length + all.filter((a) => a.airtable_synced_at).length;
  const recordRoom = Math.max(0, at.record_budget - recordsUsed);
  const callRoom = Math.max(0, at.monthly_call_budget - usage.usedThisMonth(cfg.dataDir, now) - store.apiCalls());
  const take = pending.slice(0, Math.min(lim.airtable_max_new_per_run, recordRoom, callRoom * 10));

  let synced = 0, error = null;
  for (let i = 0; i < take.length; i += 10) {
    const batch = take.slice(i, i + 10);
    try {
      await store.upsertArticles(batch.map(({ airtable_synced_at, candidate_note, ...a }) => a));
    } catch (e) { error = e.message; log.warn(`Airtable sync stopped; ${take.length - synced} articles stay local and retry next run: ${e.message}`); break; }
    await local.upsert('Articles', batch.map((a) => ({ article_id: a.article_id, airtable_synced_at: now.toISOString() })));
    synced += batch.length;
  }
  const caps = { per_run_cap: lim.airtable_max_new_per_run, record_budget: recordRoom, monthly_call_budget: callRoom * 10 };
  const result = {
    synced, pending_candidates: pending.length, left_for_next_run: pending.length - synced,
    held_by: take.length < pending.length ? Object.keys(caps).find((k) => caps[k] === take.length) : null,
    records_used_estimate: recordsUsed + synced, record_budget: at.record_budget, error,
  };
  log.info(`Airtable: synced ${synced}/${pending.length} candidates (records ≈${result.records_used_estimate}/${at.record_budget})`);
  return result;
}

module.exports = { collectRss, titleKey, articleId, classify };
