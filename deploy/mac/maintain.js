#!/usr/bin/env node
// Weekly upkeep on Mohil's Mac (launchd runs it Sunday 9am, or at the next wake if the Mac was asleep):
//  1. Backup to ~/Operator-Weekly-AI-work/backups/<date>/ (private, last 8 kept):
//     every Airtable table as JSON, the local data/ and out/ folders, and the n8n workflows.
//  2. Keeps Airtable under the Free plan's 1,000-record limit: once the base passes 75% of the app's
//     record budget, the oldest UNUSED rows (articles, candidate/duplicate stories and their scores, old run
//     logs) are removed from Airtable, oldest first. They stay in the backup just taken. Never touched:
//     anything from the last 14 days, stories that were selected/researched/published, Sources, Research,
//     Issues, Performance, Pain Points, Content Ideas.
//  3. Rotates logs over 5 MB (one previous copy kept).
//
//   node deploy/mac/maintain.js            all three
//   node deploy/mac/maintain.js --dry-run  backup + report what would be removed, remove nothing

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const WORK = path.join(REPO, '..');
const BACKUPS = path.join(WORK, 'backups');
const LOGS = path.join(WORK, 'logs');
const KEEP_BACKUPS = 8;
const KEEP_DAYS = 14;
const LOG_MAX = 5 * 1024 * 1024;
const DRY = process.argv.includes('--dry-run');

const env = Object.fromEntries(fs.readFileSync(path.join(REPO, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const runtime = JSON.parse(fs.readFileSync(path.join(REPO, 'config', 'runtime.json'), 'utf8'));
const TABLES = ['Sources', 'Articles', 'Stories', 'Scores', 'Research', 'Issues', 'Content Ideas', 'Performance', 'Pain Points', 'Run Log'];
const PROTECTED_STATUS = new Set(['selected', 'researched', 'published']);

let calls = 0;
async function at(method, table, query = '', body) {
  calls++;
  const r = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}${query}`, {
    method, headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  });
  if (r.status === 429) { await new Promise((res) => setTimeout(res, 30000)); calls--; return at(method, table, query, body); }
  if (!r.ok) throw new Error(`Airtable ${method} ${table}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  await new Promise((res) => setTimeout(res, 220)); // stay under 5 requests/second
  return r.json();
}

async function allRows(table) {
  const rows = [];
  let offset;
  do {
    const d = await at('GET', table, `?pageSize=100${offset ? `&offset=${offset}` : ''}`);
    rows.push(...d.records);
    offset = d.offset;
  } while (offset);
  return rows;
}

function copyDir(src, dest) { if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true }); }

async function backup() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const dir = path.join(BACKUPS, stamp);
  fs.mkdirSync(path.join(dir, 'airtable'), { recursive: true, mode: 0o700 });
  fs.chmodSync(BACKUPS, 0o700);
  const data = {};
  for (const t of TABLES) {
    data[t] = await allRows(t);
    fs.writeFileSync(path.join(dir, 'airtable', `${t}.json`), JSON.stringify(data[t], null, 1));
  }
  copyDir(path.join(REPO, 'data'), path.join(dir, 'data'));
  copyDir(path.join(REPO, 'out'), path.join(dir, 'out'));
  try {
    execFileSync(path.join(WORK, 'n8n', 'node_modules', '.bin', 'n8n'), ['export:workflow', '--all', `--output=${path.join(dir, 'n8n-workflows.json')}`], {
      env: { ...process.env, PATH: `${path.join(WORK, 'runtime', 'node24', 'bin')}:${process.env.PATH}`, N8N_USER_FOLDER: path.join(WORK, 'n8n-data') }, stdio: 'ignore', timeout: 120000,
    });
  } catch (e) { console.error(`n8n export skipped: ${e.message.split('\n')[0]}`); }
  const old = fs.readdirSync(BACKUPS).filter((d) => /^\d{4}-/.test(d)).sort().slice(0, -KEEP_BACKUPS);
  for (const d of old) fs.rmSync(path.join(BACKUPS, d), { recursive: true, force: true });
  return { dir, data, removed_old_backups: old.length };
}

function dayOf(v) { const t = Date.parse(v || ''); return Number.isNaN(t) ? null : t; }

function pruneCandidates(data, now = Date.now()) {
  const cutoff = now - KEEP_DAYS * 86400000;
  const total = Object.values(data).reduce((n, rows) => n + rows.length, 0);
  const target = Math.floor((runtime.airtable?.record_budget || 900) * 0.75);
  if (total <= target) return { total, target, remove: [] };

  const stories = data.Stories.filter((r) => !PROTECTED_STATUS.has(r.fields.status) && (dayOf(r.fields.event_date || r.fields.crawled_at) ?? now) < cutoff);
  const scoreByStory = {};
  for (const s of data.Scores) (scoreByStory[s.fields.story_id] ||= []).push(s);
  const protectedStories = new Set(data.Stories.filter((r) => PROTECTED_STATUS.has(r.fields.status)).map((r) => r.fields.story_id));
  const candidates = [
    ...data.Articles.filter((r) => (dayOf(r.fields.published_at || r.fields.first_seen_at) ?? now) < cutoff)
      .map((r) => ({ table: 'Articles', ids: [r.id], when: dayOf(r.fields.published_at || r.fields.first_seen_at) })),
    ...stories.map((r) => ({
      table: 'Stories+Scores', ids: [r.id], scoreIds: (scoreByStory[r.fields.story_id] || []).filter(() => !protectedStories.has(r.fields.story_id)).map((s) => s.id),
      when: dayOf(r.fields.event_date || r.fields.crawled_at),
    })),
    ...data['Run Log'].filter((r) => (dayOf(r.fields.started_at) ?? now) < now - 30 * 86400000)
      .map((r) => ({ table: 'Run Log', ids: [r.id], when: dayOf(r.fields.started_at) })),
  ].sort((a, b) => a.when - b.when);

  const remove = [];
  let left = total;
  for (const c of candidates) {
    if (left <= target) break;
    remove.push(c);
    left -= c.ids.length + (c.scoreIds ? c.scoreIds.length : 0);
  }
  return { total, target, remove, after: left };
}

async function deleteRows(table, ids) {
  for (let i = 0; i < ids.length; i += 10) {
    await at('DELETE', table, `?${ids.slice(i, i + 10).map((id) => `records[]=${id}`).join('&')}`);
  }
}

function rotateLogs() {
  const rotated = [];
  if (!fs.existsSync(LOGS)) return rotated;
  for (const f of fs.readdirSync(LOGS).filter((x) => x.endsWith('.log'))) {
    const p = path.join(LOGS, f);
    if (fs.statSync(p).size > LOG_MAX) { fs.copyFileSync(p, `${p}.1`); fs.truncateSync(p, 0); rotated.push(f); }
  }
  return rotated;
}

function countCalls(n) {
  const f = path.join(REPO, 'data', 'airtable_usage.json');
  const u = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  const m = new Date().toISOString().slice(0, 7);
  u[m] = (u[m] || 0) + n;
  fs.writeFileSync(f, JSON.stringify(u, null, 2));
}

async function main() {
  const started = new Date().toISOString();
  const b = await backup();
  const plan = pruneCandidates(b.data);
  let deleted = 0;
  if (!DRY && plan.remove.length) {
    const byTable = { Articles: [], Stories: [], Scores: [], 'Run Log': [] };
    for (const c of plan.remove) {
      if (c.table === 'Stories+Scores') { byTable.Stories.push(...c.ids); byTable.Scores.push(...c.scoreIds); } else byTable[c.table].push(...c.ids);
    }
    for (const [t, ids] of Object.entries(byTable)) { await deleteRows(t, ids); deleted += ids.length; }
  }
  countCalls(calls);
  // Let the collector notice rows that are gone from Airtable, so it doesn't count them against the budget.
  if (deleted) { try { execFileSync(process.execPath, [path.join(REPO, 'src', 'cli.js'), 'airtable-status'], { cwd: REPO, stdio: 'ignore', timeout: 120000 }); } catch { /* reported next run */ } }
  const rotated = rotateLogs();
  const report = { started, backup: b.dir, removed_old_backups: b.removed_old_backups, airtable_records: plan.total, target: plan.target,
    [DRY ? 'would_remove' : 'removed']: DRY ? plan.remove.reduce((n, c) => n + c.ids.length + (c.scoreIds?.length || 0), 0) : deleted,
    rotated_logs: rotated, airtable_calls: calls };
  console.log(JSON.stringify(report));
}

if (require.main === module) main().catch((e) => { console.error(`${new Date().toISOString()} maintenance failed: ${e.message}`); process.exit(1); });
module.exports = { pruneCandidates };
