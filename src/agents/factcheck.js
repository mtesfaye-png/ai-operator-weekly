// Agent D — Fact Checker / Red Team. Runs on a different model from the Writer.
// The FAIL/PASS verdict is recomputed in code: any high-severity item that isn't PASS means FAIL,
// whatever verdict the model returned.

const { askJson, toolDefs } = require('../claude');
const { loadSchema } = require('../validate');
const { loadPrompt, json } = require('./common');
const { compactPacket } = require('./writer');

async function factCheck({ cfg, fetchImpl, budget, draft, packets, now = new Date() }) {
  const user = [
    `Now: ${now.toISOString()}. Price freshness limit: ${cfg.newsletter.price_max_age_hours} hours.`,
    `Research packet (the evidence; you may re-fetch any of these URLs to confirm):\n${json(compactPacket(packets))}`,
    `Draft to check:\n${json(draft.sections.map((s) => ({ section_id: s.id, title: s.title, markdown: s.markdown })))}`,
    'Check every factual sentence. Return JSON only, matching the fact-check report schema. Include PASS items for high-stakes claims (prices, numbers, dates, availability) so the table is auditable.',
  ].join('\n\n');
  const { data } = await askJson({
    cfg, fetchImpl, budget, step: 'fact_check', schema: loadSchema('fact_check_report'), user,
    model: cfg.runtime.models.fact_checker, effort: cfg.runtime.effort?.fact_checker, system: loadPrompt(cfg, 'fact_checker'),
    tools: toolDefs(cfg, { fetch: cfg.runtime.limits.weekly.fact_check_max_fetches }),
  });
  const unresolved = data.items.filter((i) => i.severity === 'high' && i.status !== 'PASS');
  return { ...data, verdict: unresolved.length ? 'FAIL' : 'PASS', unresolved_high: unresolved.length };
}

module.exports = { factCheck };
