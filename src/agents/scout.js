// Agent A — Scout. Finds and scores candidate stories for a date window. Never writes prose.

const { askJson, toolDefs } = require('../claude');
const { loadSchema, validate } = require('../validate');
const { loadPrompt, tierOf, json } = require('./common');

async function runScout({ cfg, fetchImpl, budget, window, sources, seedItems, learning, existingHeadlines }) {
  const schema = loadSchema('scout_output');
  const lim = cfg.runtime.limits.daily;
  const user = [
    `Date window: ${window.start} to ${window.end} (inclusive). Today is ${window.end}.`,
    `Approved sources (domain, tier):\n${sources.map((s) => `- ${s.domain} (Tier ${s.tier}${s.trust_notes ? `; ${s.trust_notes}` : ''})`).join('\n')}`,
    seedItems.length ? `Seed items from RSS (verify dates; these are leads, not facts):\n${seedItems.map((i) => `- [${i.published || 'no date'}] ${i.title} — ${i.url} (${i.source}, Tier ${i.tier})`).join('\n')}` : 'No RSS seed items today; rely on web search.',
    existingHeadlines.length ? `Already in the story database (do not return these again unless there is a materially new development):\n${existingHeadlines.map((h) => `- ${h}`).join('\n')}` : '',
    learning ? `Reader engagement from recent issues (use only as a light input to audience_fit, never to inflate importance):\n${learning}` : '',
    `category must be exactly one of: ${schema.properties.stories.items.properties.category.enum.join(', ')}. Use these lowercase ids as written; no other values.`,
    `Use web search to find anything significant the seed list misses, especially frontier model releases, tool and pricing changes, enterprise adoption, regulation, open source and workflow changes. Return 8-20 stories as JSON matching the schema. JSON only.`,
  ].filter(Boolean).join('\n\n');

  // Validate the envelope here and each story individually below, so one malformed story
  // is dropped instead of failing the whole run.
  const envelope = { type: 'object', required: ['stories'], properties: { stories: { type: 'array' } } };
  const { data } = await askJson({
    cfg, fetchImpl, budget, step: 'scout', schema: envelope, user,
    model: cfg.runtime.models.scout, effort: cfg.runtime.effort?.scout, system: loadPrompt(cfg, 'scout'),
    tools: toolDefs(cfg, { search: lim.scout_max_searches }),
  });

  // Code-side enforcement of the Scout rules.
  const storySchema = schema.properties.stories.items;
  const kept = [], rejected = [];
  for (const raw of data.stories) {
    // Extra fields the model adds (e.g. "source", "notes") are dropped rather than rejecting the story;
    // every required field and value rule is still enforced.
    const s = stripUnknown(storySchema, raw);
    if (s.category !== undefined) s.category = normalizeCategory(s.category, storySchema.properties.category.enum);
    const v = validate(storySchema, s);
    if (!v.valid) { rejected.push({ story_id: s.story_id, reason: `${v.errors.join('; ')}${s.category !== undefined && !storySchema.properties.category.enum.includes(s.category) ? ` (got "${s.category}")` : ''}` }); continue; }
    const source_tier = tierOf(s.primary_url, sources);
    const story = { ...s, source_tier, crawled_at: new Date().toISOString(), source: new URL(s.primary_url).hostname.replace(/^www\./, '') };
    if (source_tier >= 3) {
      // Discovery/community sources can't be primary. Keep as a lead, capped confidence, flagged.
      story.confidence = Math.min(story.confidence, 0.5);
      story.unresolved_questions = [...story.unresolved_questions, `Primary source is Tier ${source_tier === 9 ? 'unknown' : source_tier}; trace to original before use`];
    }
    kept.push(story);
  }
  return { stories: kept, rejected };
}

// Maps the model's near-miss labels onto the allowed ids ("Frontier Models", "open-source", "policy" ...).
// Anything it can't map stays as-is, so validation still rejects it and the log says why.
const CATEGORY_ALIASES = {
  frontier_models: ['frontier', 'models', 'model', 'model_release', 'models_research', 'research', 'ai_models', 'llm', 'llms'],
  tools: ['tool', 'product', 'products', 'product_launch', 'apps', 'developer_tools', 'dev_tools', 'agents', 'coding', 'consumer'],
  enterprise: ['enterprise_adoption', 'adoption', 'b2b', 'saas'],
  business: ['funding', 'acquisition', 'acquisitions', 'm&a', 'mergers', 'deals', 'deal', 'investment', 'ipo', 'markets', 'finance', 'industry', 'company_news', 'business_strategy'],
  regulation: ['policy', 'legal', 'law', 'government', 'safety', 'governance', 'regulatory', 'privacy', 'security'],
  open_source: ['opensource', 'open', 'open_weights', 'oss'],
  workflow: ['workflows', 'how_to', 'productivity', 'best_practices'],
  infrastructure: ['infra', 'hardware', 'chips', 'compute', 'data_centers', 'datacenter', 'data_center', 'cloud', 'gpus', 'semiconductors', 'energy'],
};
function normalizeCategory(value, allowed) {
  if (typeof value !== 'string') return value;
  const key = value.trim().toLowerCase().replace(/[\s/-]+/g, '_');
  if (allowed.includes(key)) return key;
  for (const [cat, aliases] of Object.entries(CATEGORY_ALIASES)) if (allowed.includes(cat) && aliases.includes(key)) return cat;
  return value;
}

function stripUnknown(schema, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || schema.additionalProperties !== false || !schema.properties) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (schema.properties[k]) out[k] = stripUnknown(schema.properties[k], v);
  return out;
}

module.exports = { runScout, stripUnknown, normalizeCategory };
