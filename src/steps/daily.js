// Daily Scout run: RSS + web search -> Scout -> validate -> date window -> dedupe -> score -> store.

const { collect } = require('../rss');
const { runScout } = require('../agents/scout');
const { filterWindow } = require('../../lib/dates');
const { dedupe } = require('../../lib/dedupe');
const { totalScore } = require('../../lib/scoring');
const { todayIn, addDays } = require('../util');
const { learningSummary } = require('./analytics');

const LOCKED = new Set(['selected', 'researched', 'published']);

async function daily({ cfg, fetchImpl, store, budget, log, now = new Date() }) {
  const lim = cfg.runtime.limits.daily;
  const today = todayIn(cfg.timezone, now);
  const window = { start: addDays(today, -lim.rss_lookback_days), end: today };
  const sources = await store.listSources();

  const { items, failures } = await collect(sources, { fetchImpl, lookbackDays: lim.rss_lookback_days, maxItems: lim.rss_max_items, now });
  log.info(`RSS: ${items.length} items from ${sources.filter((s) => s.rss_url).length} feeds, ${failures.length} failed`);
  if (failures.length) log.warn(`Feed failures: ${failures.map((f) => `${f.source} (${f.error})`).join(', ')}`);
  if (failures.length && failures.length >= sources.filter((s) => s.rss_url).length / 2) await log.alert(`${failures.length} RSS feeds failed today. Check sources: ${failures.map((f) => f.source).join(', ')}`);

  const existing = await store.getStories({ since: addDays(today, -cfg.runtime.dedupe_lookback_days) });
  const learning = await learningSummary(store);
  const { stories, rejected } = await runScout({
    cfg, fetchImpl, budget, window, sources, seedItems: items, learning,
    existingHeadlines: existing.filter((s) => s.status !== 'duplicate').map((s) => `${s.event_date} ${s.headline}`).slice(0, 80),
  });
  if (rejected.length) log.warn(`Scout returned ${rejected.length} malformed stories: ${rejected.map((r) => r.story_id).join(', ')}`);

  const { kept, dropped } = filterWindow(stories, window);
  if (dropped.length) log.info(`Dropped ${dropped.length} out-of-window: ${dropped.map((d) => `${d.story_id} (${d.reason})`).join('; ')}`);

  // Dedupe new stories against each other AND against the stored pool.
  const fresh = kept.map((s) => ({ ...s, status: 'candidate', total_score: totalScore(s.scores, cfg.scoring.weights) }));
  const pool = [...existing.filter((s) => s.status !== 'duplicate'), ...fresh];
  const clusters = dedupe(pool, cfg.scoring.dedupe);
  const byId = Object.fromEntries(pool.map((s) => [s.story_id, s]));
  const writes = [], dupes = [];

  for (const c of clusters) {
    const members = c.merged_story_ids.map((id) => byId[id]);
    // A story already selected or published stays canonical so its status isn't lost.
    const locked = members.find((m) => LOCKED.has(m.status));
    const canonical = locked ? { ...c, ...locked, supporting_urls: c.supporting_urls.filter((u) => u !== locked.primary_url) } : c;
    const touched = members.some((m) => fresh.includes(m));
    if (!touched) continue; // nothing new in this cluster
    writes.push({ ...canonical, merged_story_ids: c.merged_story_ids });
    for (const id of c.merged_story_ids) if (id !== canonical.story_id) dupes.push({ story_id: id, status: 'duplicate' });
  }

  await store.upsertStories([...writes, ...dupes]);
  await store.saveScores(writes.filter((w) => w.scores).map((w) => ({ story_id: w.story_id, ...w.scores, confidence: w.confidence, total_score: w.total_score, weights_version: JSON.stringify(cfg.scoring.weights) })));

  const pricing = writes.filter((w) => w.pricing_change).map((w) => w.headline);
  if (pricing.length) log.info(`Pricing/plan changes flagged: ${pricing.join(' | ')}`);
  return { new_or_updated: writes.length, duplicates: dupes.length, out_of_window: dropped.length, rss_failures: failures.length, budget: budget.summary() };
}

module.exports = { daily };
