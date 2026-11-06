#!/usr/bin/env node
// "Run when Mohil is at the Mac" scheduler. launchd runs this every few minutes. It starts each day's work
// once Mohil has been actively using the Mac for 30 minutes in a row and is not in a meeting, instead of at
// fixed clock times (which fail when the Mac is asleep). Each job runs at most once per day (weekly: once per
// week, on Saturday or the first qualifying day after it).
//
// Active = keyboard/mouse used within the last 5 minutes (macOS HIDIdleTime). A sleep, or a gap of more than
// 5 idle minutes, restarts the 30-minute count.
// In a meeting = any microphone is in use (Zoom, Meet, Teams, FaceTime...) or Zoom's meeting process is running.
//
// Jobs are started through n8n's webhooks, so n8n still runs, polls and alerts exactly as designed.
// Paid jobs (daily, weekly, analytics) only run if they are listed in AOW_SERVER_WORKFLOWS in .env.
//
//   node deploy/mac/gate.js            one check (what launchd runs)
//   node deploy/mac/gate.js --status   show the active streak, meeting state and what's due, start nothing

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const STATE_FILE = path.join(REPO, 'data', 'gate_state.json');
const N8N = process.env.AOW_N8N_URL || 'http://127.0.0.1:5678';

const ACTIVE_MINUTES = Number(process.env.AOW_GATE_ACTIVE_MINUTES || 30);
const IDLE_BREAK_MINUTES = 5;     // idle longer than this restarts the streak
const SLEEP_GAP_MINUTES = 12;     // no check for this long = the Mac was asleep: restart the streak
const EARLIEST_HOUR = 6;          // never start before 6am local time
const WEEKLY_AFTER_DAILY_MIN = 20; // give the daily scout time to finish before the weekly issue
const TZ = 'America/New_York';

// Order matters: one job is started per check, in this order.
const JOBS = [
  { id: 'collect', webhook: 'aow-collect', paid: false, label: 'free RSS collection' },
  { id: 'daily', webhook: 'aow-daily', paid: true, label: 'daily news scout' },
  { id: 'weekly', webhook: 'aow-weekly', paid: true, label: 'weekly issue (draft only)' },
  { id: 'analytics', webhook: 'aow-analytics', paid: true, label: 'stats for sent issues' },
];

function env() {
  const out = {};
  const f = path.join(REPO, '.env');
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) out[m[1]] = m[2]; }
  return out;
}

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { last: {} }; } };
const writeState = (s) => { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); };

function localParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday };
}

// The Saturday that starts the current newsletter week (Sat..Fri).
function weekKey(d = new Date()) {
  const { date, weekday } = localParts(d);
  const back = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 }[weekday];
  const t = new Date(`${date}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
}

function idleSeconds() {
  const out = execFileSync('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4'], { encoding: 'utf8' });
  const m = out.match(/"HIDIdleTime" = (\d+)/);
  return m ? Number(m[1]) / 1e9 : Infinity;
}

function inMeeting() {
  const reasons = [];
  try { if (execFileSync(process.env.AOW_MIC_HELPER || path.join(__dirname, 'mic-in-use'), { encoding: 'utf8' }).trim() === '1') reasons.push('microphone in use'); } catch { /* helper missing: ignore */ }
  try { execFileSync('/usr/bin/pgrep', ['-x', 'CptHost'], { stdio: 'ignore' }); reasons.push('Zoom meeting'); } catch { /* not running */ }
  return reasons;
}

function dueJobs(state, e, now = new Date()) {
  const allowed = new Set(String(e.AOW_SERVER_WORKFLOWS || 'collect').split(',').map((s) => s.trim()));
  const { date } = localParts(now);
  const last = state.last || {};
  return JOBS.filter((j) => allowed.has(j.id)).filter((j) => {
    if (j.id === 'weekly') {
      if (last.weekly && last.weekly.week === weekKey(now)) return false;
      // Weekly waits for today's daily scout to have run for a while.
      const d = last.daily;
      return !!(d && d.date === date && (now - new Date(d.at)) / 60000 >= WEEKLY_AFTER_DAILY_MIN);
    }
    if (j.id === 'analytics') return !(last.analytics && last.analytics.date === date) && !!(last.weekly);
    return !(last[j.id] && last[j.id].date === date);
  });
}

async function trigger(job, token) {
  const r = await fetch(`${N8N}/webhook/${job.webhook}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (!r.ok) throw new Error(`n8n webhook ${job.webhook}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}

function notify(text) {
  try { execFileSync('/usr/bin/osascript', ['-e', `display notification "${text.replace(/"/g, '\\"')}" with title "AI Operator Weekly"`]); } catch { /* ignore */ }
}

async function main() {
  const statusOnly = process.argv.includes('--status');
  const e = env();
  const state = readState();
  const now = new Date();
  const idle = idleSeconds();

  // Track the unbroken active streak.
  const gap = state.checked_at ? (now - new Date(state.checked_at)) / 60000 : Infinity;
  if (idle > IDLE_BREAK_MINUTES * 60 || gap > SLEEP_GAP_MINUTES) state.active_since = idle > IDLE_BREAK_MINUTES * 60 ? null : now.toISOString();
  else if (!state.active_since) state.active_since = new Date(now - idle * 1000).toISOString();
  if (!statusOnly) state.checked_at = now.toISOString();

  const activeMin = state.active_since ? (now - new Date(state.active_since)) / 60000 : 0;
  const meeting = inMeeting();
  const due = dueJobs(state, e, now);
  const { hour } = localParts(now);
  const line = `active ${activeMin.toFixed(0)}/${ACTIVE_MINUTES} min · idle ${idle.toFixed(0)}s · ${meeting.length ? `in a meeting (${meeting.join(', ')})` : 'no meeting'} · due: ${due.map((j) => j.id).join(', ') || 'nothing'}`;

  if (statusOnly) { console.log(line); console.log(`last runs: ${JSON.stringify(state.last)}`); return; }
  const ready = activeMin >= ACTIVE_MINUTES && !meeting.length && hour >= EARLIEST_HOUR && due.length;
  if (!ready) { writeState(state); if (due.length) console.log(`${now.toISOString()} waiting: ${line}`); return; }

  const job = due[0];
  try {
    await trigger(job, e.AOW_TRIGGER_TOKEN);
    state.last[job.id] = { date: localParts(now).date, at: now.toISOString(), ...(job.id === 'weekly' ? { week: weekKey(now) } : {}) };
    console.log(`${now.toISOString()} started ${job.id} (${line})`);
    if (job.paid) notify(`Started the ${job.label}. You'll get an email if anything needs you.`);
  } catch (err) {
    console.error(`${now.toISOString()} could not start ${job.id}: ${err.message}`);
  }
  writeState(state);
}

if (require.main === module) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { dueJobs, weekKey, localParts };
