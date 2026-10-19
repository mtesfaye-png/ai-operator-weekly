// Agent C — Writer. Three modes, one agent:
//  plan   : choose stories per section and list what still needs research (pricing, resources, events)
//  write  : draft the issue from verified research only
//  expand : deepen a substantially short draft using only verified research (no new facts, links or prices)
//  revise : fix a draft using the fact-check table and gate failures (remove or correct; never invent)

const { askJson } = require('../claude');
const { loadSchema } = require('../validate');
const { loadPrompt, json } = require('./common');

function compactPacket(packets) {
  // Only what the writer may use: verified status, claims with evidence, display prices, limitations.
  return packets.flatMap((p) => p.stories).map((s) => ({
    story_id: s.story_id, verified: s.verified, event_date: s.event_date || null, headline: s.headline,
    claims: s.claims.map((c) => ({ claim_id: c.claim_id, text: c.text, type: c.claim_type, status: c.status, evidence_urls: c.evidence_urls })),
    pricing: (s.pricing || []).map((p) => ({ product: p.product, plan: p.plan, display: p.display, free_tier: p.free_tier, key_limits: p.key_limits, source_url: p.source_url, official: p.source_is_official })),
    limitations: s.limitations, direct_quotes: s.direct_quotes || [],
  }));
}

function sectionsSpec(cfg) {
  return cfg.newsletter.sections.map((s) => `- ${s.id}: "${s.title}"${s.required ? ' (REQUIRED)' : ' (optional)'}${s.fields ? ` — fields: ${s.fields.join(', ')}` : ''}${s.count ? ` — ${s.count[0]}-${s.count[1]} items` : ''}`).join('\n');
}

async function planIssue({ cfg, fetchImpl, budget, issueDate, packets, toolCandidates, learning }) {
  const user = [
    `Issue date: ${issueDate}. You are PLANNING, not writing.`,
    `Locked sections:\n${sectionsSpec(cfg)}`,
    `Verified research for the selected top stories:\n${json(compactPacket(packets))}`,
    toolCandidates.length ? `Other candidate stories this week (tools/product changes, not yet researched):\n${json(toolCandidates.map((s) => ({ story_id: s.story_id, headline: s.headline, primary_url: s.primary_url, summary: s.factual_summary, pricing_change: s.pricing_change })))}` : '',
    learning ? `What readers engaged with recently:\n${learning}` : '',
    `Produce a plan:
1. big5_story_ids: up to 5 verified story_ids for "The 5 Biggest Things", category-diverse.
2. tool_changes_story_ids: up to ${cfg.runtime.tool_changes_max} candidate story_ids for "What Changed in Tools" (they will be researched next).
3. tool_of_week: one product worth trying or paying for this week (or null), with vendor_domain and a pricing_url_hint.
4. sections: a one-line brief for each optional section you will include. Skip any section without strong material.
5. research_requests (story_id "req-..."): everything the writing still needs verified — official pricing for the tool of the week and for every paid tool you'll name in the workflow and stack, 3-5 resource URLs (official docs, repos, guides) to confirm, and dated sources for 3-5 "What to Watch" items. Include vendor_domains for pricing requests.
JSON only, matching the plan schema.`,
  ].filter(Boolean).join('\n\n');
  const { data } = await askJson({ cfg, fetchImpl, budget, step: 'writer:plan', schema: loadSchema('issue_plan'), user, model: cfg.runtime.models.writer, effort: cfg.runtime.effort?.writer, system: loadPrompt(cfg, 'writer') });
  return data;
}

async function writeIssue({ cfg, fetchImpl, budget, issueDate, packets, plan, mohilNotes }) {
  const nl = cfg.newsletter;
  const user = [
    `Issue date: ${issueDate}. Write the issue now.`,
    `Locked sections (in this order; skip optional ones the plan skips):\n${sectionsSpec(cfg)}`,
    `Plan:\n${json(plan)}`,
    `VERIFIED RESEARCH — the only facts, prices and links you may use:\n${json(compactPacket(packets))}`,
    mohilNotes ? `Mohil's own takes (use for "Mohil take"):\n${mohilNotes}` : 'No notes from Mohil this week: write each "Mohil take" as a clearly labelled draft starting with [DRAFT TAKE - Mohil to confirm].',
    `Hard rules:
- Use only claims with status "confirmed" (or "inferred" if you say it's an inference). Never use "unverified" claims.
- Every link must be one of the evidence_urls or pricing source_url values above, as markdown [text](url).
- Quote prices exactly as their "display" string (it already includes billing basis and checked date).
- Words to avoid unless the same sentence links a confirmed source: ${nl.banned_unsupported_phrases.join(', ')}, and "Nx" multipliers.
- ROI: any dollar figure must sit in a sentence starting "Estimate:" that shows the assumptions and math.
- AI Stack: list each tool with its display price, then "Total: $X/month (sum of the prices above)".
- Workflow of the Week must include a line starting "Human review:" naming the checkpoint.
- Tool of the Week must include "Who it's for:", "Who should skip:" and "Verdict: Use|Watch|Skip".
- ${nl.word_target.min}-${nl.word_target.max} words total.
- sections[].story_ids lists the story_ids each section draws on. If a story appears in two sections, add repeat_angles: { story_id: "what the second mention adds" }.
- claims_used lists every claim_id you relied on.
Return JSON only, matching the issue draft schema, with an extra optional "repeat_angles" object.`,
  ].join('\n\n');
  const { data } = await askJson({ cfg, fetchImpl, budget, step: 'writer:write', schema: loadSchema('issue_draft'), user, model: cfg.runtime.models.writer, effort: cfg.runtime.effort?.writer, system: loadPrompt(cfg, 'writer') });
  return data;
}

async function expandIssue({ cfg, fetchImpl, budget, draft, packets, plan, words }) {
  const { min, max } = cfg.newsletter.word_target;
  const user = [
    `Expand this draft. It is ${words} words; the target is ${min}-${max}. Readers want deeper, more useful coverage, not more words.`,
    `How to expand, using ONLY the verified research below:
- Deepen what is already there: why each story matters, who should act and how, concrete steps in the workflow, business implications, risks and the KPI to watch, plain-English explanations of terms.
- You may add an optional section the plan skipped only if the research clearly supports it.
- Do NOT add facts, numbers, dates, prices, quotes, benchmarks, links or claims that are not in the research. Do NOT add filler, restatements, hype or generic advice.
- Keep every existing rule: prices quoted as their "display" string, links only from evidence_urls/source_url, "Human review:", "Who it's for:", "Who should skip:", "Verdict:", "Estimate:" labels, [DRAFT TAKE - Mohil to confirm] markers left as they are.
- If the research does not support more useful material, return the draft unchanged and say why in "expansion_note". A short honest issue beats a padded one.`,
    `Locked sections:\n${sectionsSpec(cfg)}`,
    `Plan:\n${json(plan)}`,
    `VERIFIED RESEARCH — the only facts, prices and links you may use:\n${json(compactPacket(packets))}`,
    `Current draft:\n${json(draft)}`,
    'Return the complete draft as JSON matching the issue draft schema (with optional "expansion_note" and "repeat_angles"). Update claims_used and word_count.',
  ].join('\n\n');
  const { data } = await askJson({ cfg, fetchImpl, budget, step: 'writer:expand', schema: loadSchema('issue_draft'), user, model: cfg.runtime.models.writer, effort: cfg.runtime.effort?.writer, system: loadPrompt(cfg, 'writer') });
  return data;
}

async function reviseIssue({ cfg, fetchImpl, budget, draft, packets, factCheck, gate }) {
  const problems = [
    ...factCheck.items.filter((i) => i.status !== 'PASS').map((i) => ({ source: 'fact_check', ...i })),
    ...gate.blocking.map((b) => ({ source: 'gate', ...b })),
  ];
  const user = [
    'Revise this draft. Fix every problem listed. For an unsupported claim, remove it or replace it with exactly what the evidence supports (the "correction" field). Never substitute a new unsourced fact. Keep everything that passed unchanged.',
    `Problems:\n${json(problems)}`,
    `Verified research:\n${json(compactPacket(packets))}`,
    `Current draft:\n${json(draft)}`,
    'Return the complete revised draft as JSON matching the issue draft schema.',
  ].join('\n\n');
  const { data } = await askJson({ cfg, fetchImpl, budget, step: 'writer:revise', schema: loadSchema('issue_draft'), user, model: cfg.runtime.models.writer, effort: cfg.runtime.effort?.writer, system: loadPrompt(cfg, 'writer') });
  return data;
}

module.exports = { planIssue, writeIssue, expandIssue, reviseIssue, compactPacket };
