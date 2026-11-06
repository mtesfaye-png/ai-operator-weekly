// `free-issue`: the weekly newsletter draft with no AI and no paid calls (see lib/digest.js).
// Reads the article archive collect saved in data/ (or, if that's empty, the Articles table in Airtable),
// and writes issue.md, issue.html, beehiiv-body.html and sources.md to <out>/<date>/.

const fs = require('fs');
const path = require('path');
const digest = require('../../lib/digest');
const { render, page } = require('../../scripts/render-issue');
const { LocalStore, AirtableStore } = require('../store');
const { todayIn } = require('../util');

async function freeIssue({ cfg, issueDate, outDir, fetchImpl = fetch, log = console }) {
  const date = issueDate || todayIn(cfg.timezone, new Date());
  let articles = await new LocalStore(cfg.dataDir).all('Articles');
  let from = 'data/articles.json';
  if (!articles.length && cfg.airtable.token && cfg.airtable.baseId) {
    const at = new AirtableStore(cfg.airtable, fetchImpl);
    articles = await at.all('Articles');
    from = `Airtable (${at.calls} API calls)`;
  }
  const file = path.join(__dirname, '..', '..', 'config', 'digest.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const d = digest.build(articles, { issueDate: date, config });
  const nl = cfg.newsletter || {};
  const md = digest.toMarkdown(d, { name: nl.name, owner: nl.owner });
  const dir = path.join(outDir || cfg.outDir, date);
  fs.mkdirSync(dir, { recursive: true });
  const body = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;color:#1f2937;">\n${render(md)}\n</div>`;
  fs.writeFileSync(path.join(dir, 'issue.md'), md);
  fs.writeFileSync(path.join(dir, 'issue.html'), page(body, `${nl.name || 'AI Operator Weekly'}: ${date}`));
  fs.writeFileSync(path.join(dir, 'beehiiv-body.html'), `${body}\n`);
  fs.writeFileSync(path.join(dir, 'sources.md'), digest.sourcesMarkdown(d));
  const summary = { ok: true, mode: 'free_issue', paid_api_calls: 0, issue_date: date, articles_from: from, ...d.counts,
    top_stories: d.top.map((a) => `${a.source}: ${a.title}`), sections: Object.fromEntries(d.sections.map((s) => [s.title, s.items.length])),
    files: ['issue.md', 'issue.html', 'beehiiv-body.html', 'sources.md'].map((f) => path.join(dir, f)) };
  if (!d.top.length) { summary.ok = false; summary.error = 'No stories for this week: did the daily collection run?'; }
  log.info?.(`free-issue ${date}: ${d.top.length} top stories from ${d.counts.eligible} articles (${from})`);
  return summary;
}

module.exports = { freeIssue };
