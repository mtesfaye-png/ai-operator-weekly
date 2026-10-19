// Weighted scoring + diversity-aware selection (brief §6).
// Pure functions; safe to paste into an n8n Code node.

const DIMENSIONS = ['importance', 'usefulness', 'business_value', 'novelty', 'audience_fit'];

function totalScore(scores, weights) {
  let sum = 0;
  for (const d of DIMENSIONS) {
    const v = scores[d];
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`score ${d}=${v} must be an integer 1-5`);
    sum += v * weights[d];
  }
  return Math.round(sum * 100) / 100; // 1.00 – 5.00
}

// Pick the highest-value MIX, not the top N numerically:
// greedy by score, capped per category, then backfill to reach min distinct categories.
function selectStories(stories, cfg) {
  const { top_stories: n, max_per_category: cap, min_distinct_categories: minCats, min_confidence: minConf } = cfg.selection;
  const pool = stories
    .filter((s) => s.status !== 'duplicate' && (s.confidence ?? 0) >= minConf)
    .map((s) => ({ ...s, total_score: s.total_score ?? totalScore(s.scores, cfg.weights) }))
    .sort((a, b) => b.total_score - a.total_score);

  const picked = [];
  const perCat = {};
  for (const s of pool) {
    if (picked.length === n) break;
    if ((perCat[s.category] || 0) >= cap) continue;
    picked.push(s);
    perCat[s.category] = (perCat[s.category] || 0) + 1;
  }

  // Diversity backfill: swap the lowest-scoring pick from an over-represented category
  // for the best unpicked story from a new category.
  const distinct = () => new Set(picked.map((s) => s.category)).size;
  while (distinct() < minCats) {
    const candidate = pool.find((s) => !picked.includes(s) && !picked.some((p) => p.category === s.category));
    if (!candidate) break;
    const counts = {};
    picked.forEach((p) => (counts[p.category] = (counts[p.category] || 0) + 1));
    const victimIdx = [...picked.keys()].reverse().find((i) => counts[picked[i].category] > 1);
    if (victimIdx === undefined) break;
    picked[victimIdx] = candidate;
  }

  return picked.map((s) => ({ ...s, selection_reason: `score ${s.total_score}, category ${s.category}` }));
}

module.exports = { DIMENSIONS, totalScore, selectStories };
