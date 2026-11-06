// Weekly Airtable cleanup: only old, unused rows go, oldest first, and only when the base is getting full.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
const hadEnv = fs.existsSync(envFile);
if (!hadEnv) fs.writeFileSync(envFile, '');
const { pruneCandidates } = require('../deploy/mac/maintain');
if (!hadEnv) fs.unlinkSync(envFile);

const NOW = Date.parse('2026-12-31T12:00:00Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();
function base({ articles = 0, stories = 0, old = 40 }) {
  const d = { Sources: [], Articles: [], Stories: [], Scores: [], Research: [], Issues: [], 'Content Ideas': [], Performance: [], 'Pain Points': [], 'Run Log': [] };
  for (let i = 0; i < articles; i++) d.Articles.push({ id: `a${i}`, fields: { published_at: day(old - (i % old)) } });
  for (let i = 0; i < stories; i++) {
    d.Stories.push({ id: `s${i}`, fields: { story_id: `st${i}`, status: i === 0 ? 'published' : 'candidate', event_date: day(old - (i % old)).slice(0, 10) } });
    d.Scores.push({ id: `c${i}`, fields: { story_id: `st${i}` } });
  }
  return d;
}

test('PRUNE: nothing is removed while the base is under 75% of the record budget', () => {
  assert.equal(pruneCandidates(base({ articles: 100, stories: 100 }), NOW).remove.length, 0);
});

test('PRUNE: over the target, oldest unused rows go first until the base is back under it', () => {
  const r = pruneCandidates(base({ articles: 400, stories: 300 }), NOW);
  assert.ok(r.total > r.target && r.after <= r.target);
  const whens = r.remove.map((c) => c.when);
  assert.deepEqual(whens, [...whens].sort((a, b) => a - b));
});

test('PRUNE: never the last 14 days, never a published story, and a story takes its score with it', () => {
  const r = pruneCandidates(base({ articles: 400, stories: 300 }), NOW);
  for (const c of r.remove) assert.ok(c.when < NOW - 14 * 86400000);
  assert.ok(!r.remove.some((c) => c.ids.includes('s0')));
  const s = r.remove.find((c) => c.table === 'Stories+Scores');
  assert.ok(s && s.scoreIds.length === 1);
});
