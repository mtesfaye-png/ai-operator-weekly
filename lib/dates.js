// Issue-window filtering. Uses the EVENT date, never the crawl date (brief §13 date-window test).

function issueWindow(issueDate, days = 7) {
  const end = new Date(`${issueDate}T23:59:59Z`);
  const start = new Date(end.getTime() - days * 86400000 + 1000);
  return { start: start.toISOString().slice(0, 10), end: issueDate };
}

function inWindow(story, window) {
  const d = story.event_date; // deliberately ignore crawled_at / fetched_at
  if (!d) return { ok: false, reason: 'missing event_date' };
  if (d < window.start) return { ok: false, reason: `event ${d} before window ${window.start}` };
  if (d > window.end) return { ok: false, reason: `event ${d} after window ${window.end}` };
  return { ok: true };
}

function filterWindow(stories, window) {
  const kept = [], dropped = [];
  for (const s of stories) {
    const r = inWindow(s, window);
    if (r.ok) kept.push(s);
    else if (s.is_background) kept.push({ ...s, label: 'background' });
    else dropped.push({ story_id: s.story_id, reason: r.reason });
  }
  return { kept, dropped };
}

module.exports = { issueWindow, inWindow, filterWindow };
