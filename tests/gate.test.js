// The at-the-Mac scheduler's rules: what is due when.
const test = require('node:test');
const assert = require('node:assert/strict');
const { dueJobs, weekKey } = require('../deploy/mac/gate');

const PAID = { AOW_SERVER_WORKFLOWS: 'collect,daily,weekly,analytics' };
const at = (iso) => new Date(iso);
const ids = (j) => j.map((x) => x.id);

test('GATE: the newsletter week starts on Saturday (New York time)', () => {
  assert.equal(weekKey(at('2026-11-07T15:00:00Z')), '2026-11-07'); // Sat
  assert.equal(weekKey(at('2026-11-09T15:00:00Z')), '2026-11-07'); // Mon
  assert.equal(weekKey(at('2026-11-06T15:00:00Z')), '2026-10-31'); // Fri
  assert.equal(weekKey(at('2026-11-07T03:00:00Z')), '2026-10-31'); // Fri 10pm in New York
});

test('GATE: free mode only ever starts collect, once a day', () => {
  assert.deepEqual(ids(dueJobs({ last: {} }, {}, at('2026-11-07T15:00:00Z'))), ['collect']);
  assert.deepEqual(ids(dueJobs({ last: { collect: { date: '2026-11-07' } } }, {}, at('2026-11-07T15:00:00Z'))), []);
});

test('GATE: collect and daily first; weekly only after daily has had 20 minutes; then not again that week', () => {
  const now = at('2026-11-07T15:00:00Z');
  assert.deepEqual(ids(dueJobs({ last: {} }, PAID, now)), ['collect', 'daily']);
  const dailyJustNow = { collect: { date: '2026-11-07' }, daily: { date: '2026-11-07', at: '2026-11-07T14:50:00Z' } };
  assert.deepEqual(ids(dueJobs({ last: dailyJustNow }, PAID, now)), []);
  const dailyEarlier = { ...dailyJustNow, daily: { date: '2026-11-07', at: '2026-11-07T14:30:00Z' } };
  assert.deepEqual(ids(dueJobs({ last: dailyEarlier }, PAID, now)), ['weekly']);
  const weeklyDone = { ...dailyEarlier, weekly: { week: '2026-11-07' } };
  assert.deepEqual(ids(dueJobs({ last: weeklyDone }, PAID, now)), ['analytics']);
  assert.deepEqual(ids(dueJobs({ last: { ...weeklyDone, analytics: { date: '2026-11-07' } } }, PAID, now)), []);
});

test('GATE: a missed Saturday runs the weekly on the next day Mohil is at the Mac', () => {
  const sun = at('2026-11-08T16:00:00Z');
  const last = { collect: { date: '2026-11-08' }, daily: { date: '2026-11-08', at: '2026-11-08T15:00:00Z' }, weekly: { week: '2026-10-31' } };
  assert.ok(ids(dueJobs({ last }, PAID, sun)).includes('weekly'));
});
