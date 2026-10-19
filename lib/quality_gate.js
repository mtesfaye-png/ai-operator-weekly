// Blocking quality gate before beehiiv (brief §9). Deterministic; runs AFTER the LLM fact check.
// Returns { pass, blocking: [...], warnings: [...] }. Any blocking item stops draft creation.

const { priceIssues } = require('./pricing');
const { inWindow } = require('./dates');

const URL_RE = /https?:\/\/[^\s)\]>"']+/g;
const PRICE_RE = /(?:\$|USD\s?|€|£)\s?\d[\d,]*(?:\.\d+)?/g;

function sentences(md) { return md.split(/(?<=[.!?])\s+|\n+/).filter(Boolean); }

function runGate({ draft, packet, factCheck, newsletterCfg, window, now = new Date() }) {
  const blocking = [], warnings = [];
  const add = (list, code, detail) => list.push({ code, detail });
  const sections = draft.sections || [];
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
  const allMd = sections.map((s) => s.markdown).join('\n');

  // 1. Fact check: no unresolved high-severity items.
  if (!factCheck) add(blocking, 'NO_FACT_CHECK', 'Fact-check report missing');
  else {
    const bad = factCheck.items.filter((i) => i.severity === 'high' && i.status !== 'PASS');
    if (factCheck.verdict !== 'PASS' || bad.length) add(blocking, 'FACT_CHECK_FAIL', bad.map((i) => `${i.status}: ${i.claim}`));
  }

  // 2. Every URL in the draft must come from the research packet (no invented sources).
  const evidence = new Set();
  for (const st of packet.stories) {
    st.claims.forEach((c) => c.evidence_urls.forEach((u) => evidence.add(u)));
    (st.pricing || []).forEach((p) => evidence.add(p.source_url));
  }
  (packet.resources || []).forEach((u) => evidence.add(u));
  const stray = [...new Set(allMd.match(URL_RE) || [])].filter((u) => !evidence.has(u));
  if (stray.length) add(blocking, 'UNSOURCED_URL', stray);

  // 3. Writer may only reference claims that exist and aren't 'unverified'.
  const claimIdx = {};
  packet.stories.forEach((st) => st.claims.forEach((c) => (claimIdx[c.claim_id] = c)));
  const badClaims = (draft.claims_used || []).filter((id) => !claimIdx[id] || claimIdx[id].status === 'unverified');
  if (badClaims.length) add(blocking, 'UNVERIFIED_CLAIM_USED', badClaims);

  // 4. Prices: each price in copy carries a "checked" date; each packet price is fresh + official.
  // A "price statement" has a currency amount AND pricing language; funding amounts don't count.
  // Labelled estimates and stack totals (sums of checked prices) are exempt.
  const PRICING_WORDS = /\/\s?(mo|month|seat|user|yr|year)\b|per (month|seat|user|year|million|1m)|\b(plan|tier|pricing|priced|subscription|costs?)\b/i;
  for (const s of sentences(allMd)) {
    const isPrice = PRICE_RE.test(s) && PRICING_WORDS.test(s);
    PRICE_RE.lastIndex = 0;
    if (isPrice && !/checked|estimate|total/i.test(s)) add(blocking, 'PRICE_WITHOUT_CHECK_DATE', s.trim());
  }
  for (const st of packet.stories) for (const p of st.pricing || []) {
    const issues = priceIssues(p, { now, maxAgeHours: newsletterCfg.price_max_age_hours });
    if (p.source_is_official === false) issues.push('NOT_OFFICIAL');
    if (issues.length) add(blocking, 'PRICE_NOT_FRESH', `${p.product} ${p.plan}: ${issues.join('; ')}`);
  }

  // 5. Stories inside the issue window (unless explicitly background).
  for (const st of packet.stories) {
    if (st.is_background) continue;
    const r = inWindow(st, window);
    if (!r.ok) add(blocking, 'OUT_OF_WINDOW', `${st.story_id}: ${r.reason}`);
  }

  // 6. Same story in multiple sections needs an explicit new angle.
  const seen = {};
  for (const s of sections) for (const id of s.story_ids || []) (seen[id] ||= []).push(s.id);
  for (const [id, secs] of Object.entries(seen)) {
    if (secs.length > 1 && !(draft.repeat_angles || {})[id]) add(blocking, 'DUPLICATE_STORY_ANGLE', `${id} in ${secs.join(', ')}`);
  }

  // 7. Superlatives / multipliers / ROI dollars need an inline citation in the same sentence.
  // Ordinary phrases ("best practices", "the first time you...") are removed before matching.
  const phrases = newsletterCfg.banned_unsupported_phrases;
  const benign = (newsletterCfg.benign_phrases || []).map((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'));
  for (const s of sentences(allMd)) {
    const lower = benign.reduce((t, re) => t.replace(re, ' '), s.toLowerCase());
    const hit = phrases.find((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) || (/\b\d+(\.\d+)?x\b/.test(lower) && '<N>x');
    if (hit && !URL_RE.test(s)) add(blocking, 'UNSUPPORTED_SUPERLATIVE', `"${hit}" in: ${s.trim()}`);
    URL_RE.lastIndex = 0;
  }
  if (byId.roi && PRICE_RE.test(byId.roi.markdown) && !/estimate/i.test(byId.roi.markdown)) add(blocking, 'ROI_DOLLARS_NOT_LABELLED', 'ROI section has dollar figures but no "Estimate" label');
  PRICE_RE.lastIndex = 0;

  // 8. Workflow names a human-review checkpoint.
  if (byId.workflow && !/human review/i.test(byId.workflow.markdown)) add(blocking, 'WORKFLOW_NO_HUMAN_REVIEW', 'Workflow of the Week lacks a human review checkpoint');

  // 9. Tool recommendations say who it's for, who should skip, and a verdict.
  if (byId.tool_of_week) {
    const md = byId.tool_of_week.markdown;
    if (!/who it'?s for|best for/i.test(md)) add(blocking, 'TOOL_NO_AUDIENCE', 'Tool of the Week: missing who it is for');
    if (!/skip/i.test(md)) add(blocking, 'TOOL_NO_SKIP', 'Tool of the Week: missing who should skip');
    if (!new RegExp(`verdict:?\\s*\\**\\s*(${newsletterCfg.verdicts.join('|')})`, 'i').test(md)) add(blocking, 'TOOL_NO_VERDICT', 'Tool of the Week: missing Use/Watch/Skip verdict');
  }

  // 10. Required sections present (5 Biggest, Build Better, One Thing to Try).
  for (const sec of newsletterCfg.sections.filter((x) => x.required)) {
    if (!byId[sec.id] || !byId[sec.id].markdown.trim()) add(blocking, 'MISSING_REQUIRED_SECTION', sec.title);
  }

  // 11. Links render: every URL sits in a well-formed markdown link; UTM tags, if used, are consistent.
  const linkUrls = [...allMd.matchAll(/\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
  const bare = [...new Set(allMd.replace(/\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\)/g, ' ').match(URL_RE) || [])];
  if (bare.length) add(blocking, 'MALFORMED_LINK', bare.map((u) => `not a [text](url) link: ${u}`));
  const broken = allMd.match(/\[[^\]\n]+\]\((?!https?:\/\/)[^)]*\)/g) || [];
  if (broken.length) add(blocking, 'MALFORMED_LINK', broken);
  const utmSources = new Set(linkUrls.map((u) => { try { return new URL(u).searchParams.get('utm_source'); } catch { return null; } }).filter(Boolean));
  if (utmSources.size > 1) add(warnings, 'UTM_INCONSISTENT', `utm_source values differ: ${[...utmSources].join(', ')}`);

  // 12. Length (warning only - a big news week may justify going long).
  const words = allMd.split(/\s+/).filter(Boolean).length;
  const { min, max } = newsletterCfg.word_target;
  if (words < min || words > max) add(warnings, 'LENGTH', `${words} words (target ${min}-${max})`);

  // 13. Placeholder takes must be confirmed by Mohil before send (warning; he reviews anyway).
  if (/\[DRAFT TAKE/i.test(allMd)) add(warnings, 'DRAFT_TAKES_PRESENT', 'Mohil take placeholders need confirmation');

  return { pass: blocking.length === 0, blocking, warnings, word_count: words };
}

module.exports = { runGate };
