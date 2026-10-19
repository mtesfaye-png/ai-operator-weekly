// Store facade. Uses Airtable when AIRTABLE_TOKEN + AIRTABLE_BASE_ID are set, otherwise local JSON
// files in data/. Both expose the same async methods, so the pipeline doesn't care which is active.

const fs = require('fs');
const path = require('path');
const { encode, decode, KEYS } = require('./codec');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Local JSON store ----------
class LocalStore {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); this.kind = 'local'; }
  file(t) { return path.join(this.dir, `${t.toLowerCase().replace(/\s+/g, '_')}.json`); }
  async all(t) { try { return JSON.parse(fs.readFileSync(this.file(t), 'utf8')); } catch { return []; } }
  async write(t, rows) { fs.writeFileSync(this.file(t), JSON.stringify(rows, null, 2)); }
  async upsert(t, objs) {
    const key = KEYS[t];
    const rows = await this.all(t);
    for (const o of objs) {
      const i = rows.findIndex((r) => r[key] === o[key]);
      const defined = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)); // undefined never erases a value (same as Airtable)
      if (i >= 0) rows[i] = { ...rows[i], ...defined }; else rows.push(defined);
    }
    await this.write(t, rows);
  }
  async append(t, obj) { const rows = await this.all(t); rows.push(obj); await this.write(t, rows); }
}

// ---------- Airtable store ----------
class AirtableStore {
  constructor({ token, baseId, throttleMs = 220 }, fetchImpl) { this.token = token; this.baseId = baseId; this.fetch = fetchImpl; this.kind = 'airtable'; this.throttle = throttleMs; }
  url(t, qs = '') { return `https://api.airtable.com/v0/${this.baseId}/${encodeURIComponent(t)}${qs}`; }
  async req(method, url, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.fetch(url, { method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (res.status === 429) { await sleep(30000); continue; } // Airtable asks for 30s back-off
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Airtable ${method} ${t(url)} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
      if (this.throttle) await sleep(this.throttle); // stay under Airtable's 5 requests/second
      return json;
    }
    throw new Error('Airtable rate limit: gave up after 4 attempts');
    function t(u) { return u.split('/v0/')[1]?.split('?')[0]; }
  }
  async all(table, formula) {
    const rows = [];
    let offset;
    do {
      const qs = new URLSearchParams({ pageSize: '100' });
      if (formula) qs.set('filterByFormula', formula);
      if (offset) qs.set('offset', offset);
      const j = await this.req('GET', this.url(table, `?${qs}`));
      j.records.forEach((r) => rows.push(decode(table, r.fields)));
      offset = j.offset;
    } while (offset);
    return rows;
  }
  async upsert(table, objs) {
    const records = objs.map((o) => ({ fields: encode(table, o) }));
    for (let i = 0; i < records.length; i += 10) {
      await this.req('PATCH', this.url(table), { performUpsert: { fieldsToMergeOn: [KEYS[table]] }, records: records.slice(i, i + 10), typecast: true });
    }
  }
  async append(table, obj) { await this.req('POST', this.url(table), { records: [{ fields: encode(table, obj) }], typecast: true }); }
}

// ---------- Pipeline-facing API ----------
function makeStore(cfg, fetchImpl) {
  const s = cfg.airtable.token && cfg.airtable.baseId ? new AirtableStore(cfg.airtable, fetchImpl) : new LocalStore(cfg.dataDir);
  return {
    kind: s.kind,
    async listSources() {
      const rows = await s.all('Sources');
      if (rows.length) return rows.filter((r) => r.active !== false).map((r) => ({ ...r, tier: Number(r.tier) }));
      return seedSources(cfg); // local store before setup: read config/sources.csv
    },
    async getStories({ since } = {}) {
      const rows = s.kind === 'airtable' && since ? await s.all('Stories', `OR({event_date} = BLANK(), IS_AFTER({event_date}, '${since}'), {event_date} = '${since}')`) : await s.all('Stories');
      return since ? rows.filter((r) => !r.event_date || r.event_date >= since) : rows;
    },
    upsertStories: (rows) => s.upsert('Stories', rows),
    saveScores: (rows) => s.upsert('Scores', rows),
    saveResearch: (rows) => s.upsert('Research', rows),
    async getResearch(ids) { return (await s.all('Research')).filter((r) => ids.includes(r.story_id)); },
    async getIssue(date) { return (await s.all('Issues')).find((r) => r.issue_date === date) || null; },
    async listIssues() { return s.all('Issues'); },
    upsertIssue: (row) => s.upsert('Issues', [row]),
    savePerformance: (row) => s.upsert('Performance', [row]),
    listPerformance: () => s.all('Performance'),
    logRun: (row) => s.append('Run Log', row),
  };
}

function seedSources(cfg) {
  const text = fs.readFileSync(path.join(cfg.root, 'config', 'sources.csv'), 'utf8').trim().split(/\r?\n/);
  const cols = text[0].split(',');
  return text.slice(1).map((line) => {
    const cells = []; let cur = '', q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; }
    cells.push(cur);
    const r = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
    return { ...r, tier: Number(r.tier), active: r.active === 'true' };
  }).filter((r) => r.active);
}

module.exports = { makeStore, LocalStore, AirtableStore };
