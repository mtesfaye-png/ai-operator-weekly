// Analytics loop: after Mohil sends an issue, pull beehiiv stats, attribute clicks to sections,
// store Performance, mark the issue sent, and build a short learning summary for the next Scout/plan.
// Directional feedback only: it never changes scoring weights on its own.

const { getPostStats } = require('../../lib/beehiiv');

function sectionForUrl(markdown, url) {
  let current = null;
  for (const line of String(markdown || '').split('\n')) {
    const h = line.match(/^##\s+(.*)/);
    if (h) current = h[1].trim();
    if (current && line.includes(url)) return current;
  }
  return null;
}

async function analytics({ cfg, fetchImpl, store, log, now = new Date() }) {
  if (!cfg.beehiiv.apiKey || !cfg.beehiiv.publicationId) { log.warn('beehiiv API not configured; skipping analytics'); return { skipped: true }; }
  const issues = (await store.listIssues()).filter((i) => i.beehiiv_post_id); // any status: a regenerated or recovered draft can be sent too
  const updated = [];
  for (const issue of issues) {
    let res;
    try { res = await getPostStats({ apiKey: cfg.beehiiv.apiKey, publicationId: cfg.beehiiv.publicationId, postId: issue.beehiiv_post_id, fetchImpl }); }
    catch (e) { log.warn(`stats for ${issue.issue_date}: ${e.message}`); continue; }
    if (res.pending) continue;
    const post = res.post;
    const publishedAt = post.publish_date ? new Date(Number(post.publish_date) * 1000 || post.publish_date) : null;
    const sent = post.status === 'confirmed' && publishedAt && publishedAt <= now;
    if (!sent) continue; // still a draft: Mohil hasn't sent it

    const s = post.stats || {};
    const email = s.email || {};
    const clicks = (s.clicks || []).map((c) => ({ url: c.base_url || c.url, clicks: c.total_unique_clicks ?? c.total_clicks ?? 0 }))
      .sort((a, b) => b.clicks - a.clicks);
    const sections = {};
    for (const c of clicks) { const sec = sectionForUrl(issue.body_markdown, c.url) || 'Other'; sections[sec] = (sections[sec] || 0) + c.clicks; }
    await store.savePerformance({
      issue_id: issue.issue_date, opens: email.unique_opens ?? email.opens ?? 0, open_rate: email.open_rate ?? 0,
      clicks: email.unique_clicks ?? email.clicks ?? 0, click_rate: email.click_rate ?? 0, unsubscribes: email.unsubscribes ?? 0,
      top_links: clicks.slice(0, 10), top_sections: Object.entries(sections).sort((a, b) => b[1] - a[1]).map(([section, n]) => ({ section, clicks: n })),
      pulled_at: now.toISOString(),
    });
    if (issue.status !== 'sent') {
      await store.upsertIssue({ issue_date: issue.issue_date, status: 'sent', sent_at: publishedAt.toISOString() });
      if (issue.story_ids?.length) await store.upsertStories(issue.story_ids.map((id) => ({ story_id: id, status: 'published' })));
    }
    updated.push(issue.issue_date);
  }
  const summary = await learningSummary(store);
  if (summary) log.info(`Learning summary:\n${summary}`);
  return { updated, summary };
}

// Plain-language summary of the last 6 sent issues, fed to Scout and the writer's plan.
async function learningSummary(store) {
  const perf = (await store.listPerformance()).sort((a, b) => String(b.issue_id).localeCompare(String(a.issue_id))).slice(0, 6);
  if (!perf.length) return '';
  const pct = (v) => (v > 1 ? v : v * 100).toFixed(1);
  const avg = (k) => perf.reduce((a, p) => a + Number(p[k] || 0), 0) / perf.length;
  const secTotals = {};
  perf.forEach((p) => (p.top_sections || []).forEach((s) => (secTotals[s.section] = (secTotals[s.section] || 0) + s.clicks)));
  const total = Object.values(secTotals).reduce((a, b) => a + b, 0) || 1;
  const topSecs = Object.entries(secTotals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, n]) => `${s} ${Math.round((n / total) * 100)}%`);
  const topLinks = perf.flatMap((p) => p.top_links || []).sort((a, b) => b.clicks - a.clicks).slice(0, 5).map((l) => l.url);
  return [
    `Last ${perf.length} issues: average open rate ${pct(avg('open_rate'))}%, click rate ${pct(avg('click_rate'))}%, ${avg('unsubscribes').toFixed(1)} unsubscribes per issue.`,
    `Share of clicks by section: ${topSecs.join(', ') || 'no click data yet'}.`,
    topLinks.length ? `Most-clicked links: ${topLinks.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { analytics, learningSummary, sectionForUrl };
