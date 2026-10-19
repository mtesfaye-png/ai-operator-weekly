// Weekly production run:
// select -> research (reuse fresh research, refresh stale prices) -> plan -> research requests ->
// write -> (expand if short) -> fact check -> gate -> (one revision) -> beehiiv DRAFT or manual fallback -> notify.
// There is no code path that publishes or sends. Mohil does that in beehiiv.
// One beehiiv post per issue: once a post id is recorded, later runs (including --force) never create
// another unless --new-beehiiv-draft is passed explicitly. Sent issues are never touched.

const fs = require('fs');
const path = require('path');
const { runResearch } = require('../agents/researcher');
const { planIssue, writeIssue, expandIssue, reviseIssue } = require('../agents/writer');
const { factCheck } = require('../agents/factcheck');
const { issueWindow, filterWindow } = require('../../lib/dates');
const { dedupe } = require('../../lib/dedupe');
const { selectStories, totalScore } = require('../../lib/scoring');
const { freshnessPlan } = require('../../lib/pricing');
const { runGate } = require('../../lib/quality_gate');
const { createDraft, checkDraft, renderIssue } = require('../../lib/beehiiv');
const { todayIn, chunk } = require('../util');
const { learningSummary } = require('./analytics');
const { hostOf } = require('../agents/common');

function storyItem(s) {
  return {
    story_id: s.story_id, headline: s.headline, event_date: s.event_date, category: s.category,
    companies: s.companies, primary_url: s.primary_url, supporting_urls: (s.supporting_urls || []).slice(0, 6),
    factual_summary: s.factual_summary, unresolved_questions: s.unresolved_questions, vendor_domains: [hostOf(s.primary_url)],
  };
}

// Research items, reusing stored research whose prices are still fresh (saves cost on re-runs).
// Only research done for THIS issue week is reused: request ids such as "req-tool-of-week" repeat
// every week with a different question, so older rows must never stand in for new research.
async function researchItems({ cfg, fetchImpl, budget, store, log, items, mode, sources, now, window }) {
  const stored = await store.getResearch(items.map((i) => i.story_id));
  const reuse = [], todo = [];
  for (const it of items) {
    const r = stored.find((x) => x.story_id === it.story_id && x.packet && String(x.checked_at || '').slice(0, 10) >= window.start);
    const stale = r && freshnessPlan(r.packet.pricing || [], { now, maxAgeHours: cfg.newsletter.price_max_age_hours }).refresh.length > 0;
    if (r && !stale) reuse.push(r.packet);
    else { if (stale) log.info(`Refreshing stale pricing for ${it.story_id}`); todo.push(it); }
  }
  const out = [...reuse];
  for (const batch of chunk(todo, cfg.runtime.limits.weekly.research_batch_size)) {
    const { packet, notes } = await runResearch({ cfg, fetchImpl, budget, items: batch, mode, sources, now });
    notes.forEach((n) => log.info(`research: ${n}`));
    for (const st of packet.stories) {
      const src = batch.find((b) => b.story_id === st.story_id) || {};
      st.headline = st.headline || src.headline || src.question;
      st.event_date = st.event_date || src.event_date || null;
      if (mode === 'requests') st.is_background = true; // evergreen material, not this week's news
      out.push(st);
      await store.saveResearch([{
        story_id: st.story_id, claims: st.claims, pricing: st.pricing || [], limitations: st.limitations,
        evidence_urls: [...new Set(st.claims.flatMap((c) => c.evidence_urls))], direct_quotes: st.direct_quotes || [],
        verified: st.verified, checked_at: now.toISOString(), packet: st,
      }]);
    }
  }
  return out;
}

function mergePackets(...lists) {
  const byId = new Map();
  lists.flat().forEach((s) => byId.set(s.story_id, s));
  const stories = [...byId.values()];
  return { generated_at: new Date().toISOString(), stories, resources: [] };
}

function writeBackup(cfg, issueDate, files) {
  const dir = path.join(cfg.outDir, issueDate);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return dir;
}

function previewPage(subject, preview, html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:Georgia,'Times New Roman',serif;color:#111827;">
<div style="max-width:640px;margin:0 auto;padding:32px 20px;background:#ffffff;">
<p style="font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin:0 0 4px;">AI Operator Weekly · DRAFT for review</p>
<h1 style="font:700 26px/1.2 system-ui,sans-serif;margin:0 0 6px;">${subject}</h1>
<p style="font:15px/1.4 system-ui,sans-serif;color:#4b5563;margin:0 0 24px;">${preview}</p>
${html}
</div></body></html>`;
}

const wordsOf = (draft) => draft.sections.map((s) => s.markdown).join('\n').split(/\s+/).filter(Boolean).length;

// Things Mohil must decide before sending. Shown at the top of the draft, in Slack and in Issues.review_flags.
function reviewFlagsFor({ draft, gate, cfg, expansionNote }) {
  const { min, max } = cfg.newsletter.word_target;
  const flags = [];
  if (gate.word_count < min) flags.push(`Length: ${gate.word_count} words, under the ${min}-${max} target after an evidence-only expansion pass${expansionNote ? ` (writer: ${expansionNote})` : ''}. Add material, or approve sending it short.`);
  if (gate.word_count > max) flags.push(`Length: ${gate.word_count} words, over the ${max}-word target. Trim, or keep it long for a big news week.`);
  const takes = (draft.sections.map((s) => s.markdown).join('\n').match(/\[DRAFT TAKE/g) || []).length;
  if (takes) flags.push(`${takes} "Mohil take" placeholder(s) marked [DRAFT TAKE] need Mohil's approval or rewrite.`);
  gate.warnings.filter((w) => !['LENGTH', 'DRAFT_TAKES_PRESENT'].includes(w.code)).forEach((w) => flags.push(`${w.code}: ${w.detail}`));
  return flags;
}

async function weekly({ cfg, fetchImpl, store, budget, log, issueDate, force = false, newBeehiivDraft = false, now = new Date() }) {
  issueDate = issueDate || todayIn(cfg.timezone, now);
  const window = issueWindow(issueDate, cfg.newsletter.issue_window_days);
  const existing = await store.getIssue(issueDate);
  if (existing?.status === 'sent') {
    log.info(`Issue ${issueDate} was already sent; it is never regenerated (its beehiiv post and stats stay linked)`);
    return { status: 'sent', skipped: true };
  }
  const knownPost = existing?.beehiiv_post_id || null;
  const beehiivOn = !!(cfg.beehiiv.apiKey && cfg.beehiiv.publicationId);
  // beehiiv accepted a post earlier but hadn't finished creating it: check on it, never create another.
  if (existing?.status === 'draft_pending' && knownPost) {
    if (!beehiivOn) { log.warn(`Issue ${issueDate} has pending beehiiv post ${knownPost}, but beehiiv isn't configured to check it`); return { status: 'draft_pending', skipped: true }; }
    const c = await checkDraft({ apiKey: cfg.beehiiv.apiKey, publicationId: cfg.beehiiv.publicationId, postId: knownPost, fetchImpl, alert: log.alert });
    if (c.state === 'ready') {
      await store.upsertIssue({ issue_date: issueDate, status: 'draft_in_beehiiv' });
      await log.alert(`Draft ready for review: "${existing.subject_options?.[0] || issueDate}" ${existing.preview_url || ''}. Review, edit and send manually in beehiiv.`);
      return { status: 'draft_in_beehiiv', recovered: true, beehiiv_post_id: knownPost, preview_url: existing.preview_url };
    }
    if (c.state === 'failed') {
      await store.upsertIssue({ issue_date: issueDate, status: 'manual_fallback' });
      await log.alert(`beehiiv post ${knownPost} for ${issueDate} failed to finish (${c.detail}). Paste ${path.join(cfg.outDir, issueDate, 'issue.html')} into a new beehiiv post. No new post was created automatically.`);
      return { status: 'manual_fallback', beehiiv_post_id: knownPost };
    }
    log.info(`beehiiv post ${knownPost} for ${issueDate} is still pending (${c.detail}); not regenerating and not creating another post`);
    return { status: 'draft_pending', skipped: true, beehiiv_post_id: knownPost };
  }
  if (['draft_in_beehiiv', 'regenerated_manual_update'].includes(existing?.status) && !force) {
    log.info(`Issue ${issueDate} already ${existing.status}; nothing to do (use --force to regenerate)`);
    return { status: existing.status, skipped: true };
  }
  const issue = { issue_date: issueDate, status: 'drafting' };
  await store.upsertIssue(issue);
  const sources = await store.listSources();

  // 1. Candidate pool for the window, cleaned (Thursday review step).
  const all = await store.getStories({ since: window.start });
  const { kept } = filterWindow(all.filter((s) => s.status !== 'duplicate' && s.status !== 'rejected'), window);
  const pool = dedupe(kept.map((s) => ({ ...s, total_score: s.total_score ?? totalScore(s.scores, cfg.scoring.weights) })), cfg.scoring.dedupe);
  log.info(`Pool: ${pool.length} candidate stories in ${window.start}..${window.end}`);

  // 2. Select (Friday).
  const selected = selectStories(pool, cfg.scoring);
  if (selected.length < 3) {
    const msg = `Only ${selected.length} qualifying stories in the window. Run the daily scout or lower min_confidence.`;
    await store.upsertIssue({ ...issue, status: 'blocked', gate_result: 'FAIL', gate: { blocking: [{ code: 'NOT_ENOUGH_STORIES', detail: msg }] } });
    await log.alert(msg);
    return { status: 'blocked', reason: msg };
  }
  await store.upsertStories(selected.map((s) => ({ story_id: s.story_id, status: 'selected' })));
  log.info(`Selected: ${selected.map((s) => `${s.story_id} (${s.total_score})`).join(', ')}`);

  // 3. Verify selected stories.
  const storyPackets = await researchItems({ cfg, fetchImpl, budget, store, log, items: selected.map(storyItem), mode: 'stories', sources, now, window });
  await store.upsertStories(selected.map((s) => ({ story_id: s.story_id, status: 'researched' })));

  // 4. Plan the issue, then research what the plan still needs.
  const learning = await learningSummary(store);
  const toolCandidates = pool.filter((s) => !selected.some((x) => x.story_id === s.story_id))
    .filter((s) => ['tools', 'workflow', 'open_source'].includes(s.category) || s.pricing_change).slice(0, 10);
  const plan = await planIssue({ cfg, fetchImpl, budget, issueDate, packets: [{ stories: storyPackets }], toolCandidates, learning });
  const changeItems = plan.tool_changes_story_ids.map((id) => pool.find((s) => s.story_id === id)).filter(Boolean).slice(0, cfg.runtime.tool_changes_max).map(storyItem);
  const requests = [...plan.research_requests];
  if (plan.tool_of_week && !requests.some((r) => r.kind === 'tool_pricing' && (r.vendor_domains || []).includes(plan.tool_of_week.vendor_domain))) {
    requests.unshift({ story_id: `req-tool-of-week`, kind: 'tool_pricing', question: `Current official pricing, free tier, plan limits and alternatives for ${plan.tool_of_week.product} (${plan.tool_of_week.use_case})`, urls: plan.tool_of_week.pricing_url_hint ? [plan.tool_of_week.pricing_url_hint] : [], vendor_domains: [plan.tool_of_week.vendor_domain] });
  }
  const changePackets = changeItems.length ? await researchItems({ cfg, fetchImpl, budget, store, log, items: changeItems, mode: 'stories', sources, now, window }) : [];
  const extraPackets = requests.length ? await researchItems({ cfg, fetchImpl, budget, store, log, items: requests, mode: 'requests', sources, now, window }) : [];
  const packet = mergePackets(storyPackets, changePackets, extraPackets);

  // 5. Write -> fact check -> gate, with at most N revisions.
  const mohilNotes = existing?.mohil_notes || readNotes(cfg, issueDate);
  let draft = await writeIssue({ cfg, fetchImpl, budget, issueDate, packets: [packet], plan, mohilNotes });
  // A substantially short draft gets one expansion pass from verified research only. It runs before the
  // fact check, so everything it adds is checked and gated like the rest.
  let expansionNote = null;
  const firstWords = wordsOf(draft);
  if (firstWords < cfg.newsletter.word_target.min) {
    log.info(`Draft is ${firstWords} words (target ${cfg.newsletter.word_target.min}-${cfg.newsletter.word_target.max}); running an evidence-only expansion pass`);
    draft = await expandIssue({ cfg, fetchImpl, budget, draft, packets: [packet], plan, words: firstWords });
    expansionNote = draft.expansion_note || null;
    log.info(`Expansion: ${firstWords} -> ${wordsOf(draft)} words${expansionNote ? ` (${expansionNote})` : ''}`);
  }
  let fc, gate;
  for (let round = 0; ; round++) {
    fc = await factCheck({ cfg, fetchImpl, budget, draft, packets: [packet], now });
    gate = runGate({ draft, packet, factCheck: fc, newsletterCfg: cfg.newsletter, window, now });
    log.info(`Round ${round}: fact check ${fc.verdict} (${fc.unresolved_high} unresolved high), gate ${gate.pass ? 'PASS' : `FAIL (${gate.blocking.map((b) => b.code).join(', ')})`}`);
    if (gate.pass || round >= cfg.runtime.limits.weekly.max_revisions) break;
    draft = await reviseIssue({ cfg, fetchImpl, budget, draft, packets: [packet], factCheck: fc, gate });
  }

  // 6. Persist everything before touching beehiiv, so nothing is lost on failure.
  const reviewFlags = reviewFlagsFor({ draft, gate, cfg, expansionNote });
  const { markdown, html } = renderIssue(draft, { reviewFlags });
  const subject = draft.subject_options[0];
  const dir = writeBackup(cfg, issueDate, {
    'issue.md': `# ${subject}\n\n_${draft.preview_text}_\n\nSubject options:\n${draft.subject_options.map((s) => `- ${s}`).join('\n')}\n\n${markdown}`,
    'issue.html': html, 'preview.html': previewPage(subject, draft.preview_text, html),
    'draft.json': draft, 'plan.json': plan, 'research_packet.json': packet, 'fact_check.json': fc, 'gate.json': gate, 'budget.json': { ...budget.summary(), calls: budget.log },
  });
  const record = {
    issue_date: issueDate, subject_options: draft.subject_options, preview_text: draft.preview_text,
    body_html: html, body_markdown: markdown, fact_check: fc, gate, plan, extra_research: extraPackets,
    gate_result: gate.pass ? 'PASS' : 'FAIL', story_ids: [...new Set(draft.sections.flatMap((s) => s.story_ids || []))], review_flags: reviewFlags,
    api_calls_used: budget.calls, est_cost_usd: budget.summary().est_usd,
  };

  if (!gate.pass) {
    await store.upsertIssue({ ...record, status: 'blocked' });
    await log.alert(`Issue ${issueDate} BLOCKED by the quality gate: ${gate.blocking.map((b) => `${b.code}: ${Array.isArray(b.detail) ? b.detail.join('; ') : b.detail}`).join(' | ').slice(0, 1500)}. Draft saved in ${dir}. No beehiiv post was created.`);
    return { status: 'blocked', gate, out_dir: dir, budget: budget.summary() };
  }

  // 7. beehiiv draft (or manual fallback when beehiiv isn't configured / plan doesn't allow the API).
  const flagNote = reviewFlags.length ? ` Needs your decision: ${reviewFlags.join(' | ')}.` : '';
  let result;
  if (knownPost && !newBeehiivDraft) {
    // Regenerated (--force, or re-run after a failure) for an issue that already has a beehiiv post.
    result = { status: 'regenerated_manual_update' };
    await log.alert(`Issue ${issueDate} was regenerated. Existing beehiiv post ${knownPost} was NOT changed and no second draft was created. Paste ${path.join(dir, 'issue.html')} into that post, or re-run with --new-beehiiv-draft to create a separate draft.${flagNote}`);
  } else if (!beehiivOn) {
    result = { status: 'manual_fallback', reason: 'beehiiv API not configured' };
    await log.alert(`Issue ${issueDate} passed the gate. beehiiv API isn't configured, so paste ${path.join(dir, 'issue.html')} into a new beehiiv post. Subject: "${subject}".${flagNote}`);
  } else {
    const previous = knownPost ? [...(existing.previous_beehiiv_post_ids || []), knownPost] : undefined;
    result = await createDraft({
      draft, apiKey: cfg.beehiiv.apiKey, publicationId: cfg.beehiiv.publicationId, templateId: cfg.beehiiv.templateId || undefined, subject, reviewFlags, fetchImpl, alert: log.alert,
      onAccepted: (a) => store.upsertIssue({ ...record, ...a, status: 'draft_pending', previous_beehiiv_post_ids: previous }),
    });
    if (result.status === 'draft_in_beehiiv') await log.alert(`Draft ready for review: "${subject}" ${result.preview_url}.${flagNote} Review, edit and send manually in beehiiv.`);
  }
  await store.upsertIssue({ ...record, status: result.status, beehiiv_post_id: result.beehiiv_post_id, preview_url: result.preview_url });
  return { status: result.status, beehiiv_post_id: result.beehiiv_post_id || knownPost || undefined, preview_url: result.preview_url, out_dir: dir, warnings: gate.warnings, review_flags: reviewFlags, word_count: gate.word_count, budget: budget.summary() };
}

function readNotes(cfg, issueDate) {
  const f = path.join(cfg.root, 'notes', `${issueDate}.md`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

module.exports = { weekly };
