// Collapse coverage of the same event into one canonical story (brief §13 duplicate test).
// Two stories are the same event if they share a primary URL, or they share a company,
// fall within N days of each other, and their headlines are similar enough.

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'its', 'new', 'is', 'as', 'by', 'at', 'from', 'launches', 'announces', 'unveils', 'releases', 'introduces', 'says']);

function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    [...x.searchParams.keys()].filter((k) => k.startsWith('utm_') || k === 'ref').forEach((k) => x.searchParams.delete(k));
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search).toLowerCase();
  } catch { return String(u).toLowerCase(); }
}

function tokens(title) {
  return new Set(title.toLowerCase().replace(/[^a-z0-9.\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)));
}

function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
}

function daysApart(a, b) {
  if (!a || !b) return 0;
  return Math.abs(new Date(a) - new Date(b)) / 86400000;
}

const TIER_RANK = (s) => s.source_tier ?? 9;

// Product-like tokens ("gpt-6", "llama-4", "o5") are strong same-event evidence.
function distinctive(title) { return [...tokens(title)].filter((t) => /\d/.test(t) && t.length >= 2); }

function sameEvent(a, b, cfg) {
  if (normalizeUrl(a.primary_url) === normalizeUrl(b.primary_url)) return true;
  const sharedCo = (a.companies || []).some((co) => (b.companies || []).map((x) => x.toLowerCase()).includes(co.toLowerCase()));
  if (!sharedCo || daysApart(a.event_date, b.event_date) > cfg.same_event_day_window) return false;
  if (jaccard(a.headline, b.headline) >= cfg.title_similarity_threshold) return true;
  const da = distinctive(a.headline);
  return da.length > 0 && distinctive(b.headline).some((t) => da.includes(t));
}

function dedupe(stories, cfg = { title_similarity_threshold: 0.55, same_event_day_window: 3 }) {
  // Union-find so A~B and B~C put A, B, C in one cluster.
  const parent = stories.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < stories.length; i++)
    for (let j = i + 1; j < stories.length; j++)
      if (sameEvent(stories[i], stories[j], cfg)) parent[find(j)] = find(i);
  const groups = {};
  stories.forEach((s, i) => (groups[find(i)] ||= []).push(s));
  const clusters = Object.values(groups);

  return clusters.map((c) => {
    // Canonical = best source tier, then highest confidence.
    const canon = [...c].sort((a, b) => TIER_RANK(a) - TIER_RANK(b) || (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    const urls = new Set();
    c.forEach((s) => [s.primary_url, ...(s.supporting_urls || [])].forEach((u) => u && urls.add(u)));
    urls.delete(canon.primary_url);
    return { ...canon, supporting_urls: [...urls], merged_story_ids: c.map((s) => s.story_id), status: canon.status || 'candidate' };
  });
}

module.exports = { dedupe, jaccard, normalizeUrl };
