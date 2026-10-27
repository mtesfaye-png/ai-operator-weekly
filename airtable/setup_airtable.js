#!/usr/bin/env node
// Creates the AI Operator Weekly tables and seeds the Sources table. Safe to re-run.
// Usage (reads .env in the project folder):
//   node airtable/setup_airtable.js --dry-run     # print the plan, no Airtable calls
//   node airtable/setup_airtable.js               # AIRTABLE_TOKEN + AIRTABLE_WORKSPACE_ID: create a new base
//                                                 # AIRTABLE_TOKEN + AIRTABLE_BASE_ID: add missing tables to that base
// Token scopes: data.records:read, data.records:write, schema.bases:read, schema.bases:write. Never commit it.
// Cost: new base ≈ 4 API calls; existing base ≈ 1 + one per missing table + 3.

const fs = require('fs');
const path = require('path');
const { load } = require('../src/config');
const usage = require('../src/store/usage');

const API = 'https://api.airtable.com/v0';
const dryRun = process.argv.includes('--dry-run');
const cfg = load(); // also reads .env
const token = process.env.AIRTABLE_TOKEN;
const workspaceId = process.env.AIRTABLE_WORKSPACE_ID;
const baseId = process.env.AIRTABLE_BASE_ID;

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf8'));
let calls = 0;

function parseCsv(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const cols = header.split(',');
  return rows.map((line) => {
    const cells = [];
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}

async function call(method, url, body) {
  calls++;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const sources = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'config', 'sources.csv'), 'utf8'));
  if (dryRun) {
    console.log(JSON.stringify({ mode: baseId ? `add missing tables to ${baseId}` : 'create new base', tables: schema.tables.map((t) => `${t.name} (${t.fields.length} fields)`), sourceRows: sources.length }, null, 2));
    return;
  }
  if (!token || !(workspaceId || baseId)) throw new Error('Set AIRTABLE_TOKEN and either AIRTABLE_WORKSPACE_ID (new base) or AIRTABLE_BASE_ID (existing base) in .env');

  let id = baseId;
  if (id) {
    const have = new Set((await call('GET', `${API}/meta/bases/${id}/tables`)).tables.map((t) => t.name));
    for (const t of schema.tables.filter((x) => !have.has(x.name))) {
      await call('POST', `${API}/meta/bases/${id}/tables`, t);
      console.log(`Created table ${t.name}`);
    }
  } else {
    id = (await call('POST', `${API}/meta/bases`, { name: schema.base_name, workspaceId, tables: schema.tables })).id;
    console.log(`Created base ${id}`);
  }

  // Seed Sources in batches of 10 (Airtable limit), upserting on domain so re-runs don't duplicate.
  const records = sources.map((s) => ({
    fields: {
      name: s.name, domain: s.domain, tier: Number(s.tier), category: s.category,
      ...(s.rss_url ? { rss_url: s.rss_url } : {}),
      active: s.active === 'true', trust_notes: s.trust_notes,
    },
  }));
  for (let i = 0; i < records.length; i += 10) {
    await call('PATCH', `${API}/${id}/Sources`, { performUpsert: { fieldsToMergeOn: ['domain'] }, records: records.slice(i, i + 10), typecast: true });
  }
  console.log(`Seeded ${records.length} sources. Put this in .env: AIRTABLE_BASE_ID=${id}`);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => { if (calls) console.log(`Airtable API calls used: ${calls} (this month so far: ${usage.addCalls(cfg.dataDir, calls)})`); });
