#!/usr/bin/env node
// Creates the AI Operator Weekly base and seeds the Sources table.
// Usage:
//   AIRTABLE_TOKEN=pat... AIRTABLE_WORKSPACE_ID=wsp... node airtable/setup_airtable.js
//   add --dry-run to print the payload without calling Airtable.
// Token scopes: schema.bases:write, data.records:write. Never commit the token.

const fs = require('fs');
const path = require('path');

const API = 'https://api.airtable.com/v0';
const dryRun = process.argv.includes('--dry-run');
const token = process.env.AIRTABLE_TOKEN;
const workspaceId = process.env.AIRTABLE_WORKSPACE_ID;

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf8'));

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
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const payload = { name: schema.base_name, workspaceId, tables: schema.tables };
  const sources = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'config', 'sources.csv'), 'utf8'));

  if (dryRun) {
    console.log(JSON.stringify({ createBase: payload, sourceRows: sources.length }, null, 2));
    return;
  }
  if (!token || !workspaceId) throw new Error('Set AIRTABLE_TOKEN and AIRTABLE_WORKSPACE_ID');

  const base = await call('POST', `${API}/meta/bases`, payload);
  console.log(`Created base ${base.id}`);

  // Seed Sources in batches of 10 (Airtable limit).
  const records = sources.map((s) => ({
    fields: {
      name: s.name, domain: s.domain, tier: Number(s.tier), category: s.category,
      ...(s.rss_url ? { rss_url: s.rss_url } : {}),
      active: s.active === 'true', trust_notes: s.trust_notes,
    },
  }));
  for (let i = 0; i < records.length; i += 10) {
    await call('POST', `${API}/${base.id}/Sources`, { records: records.slice(i, i + 10), typecast: true });
  }
  console.log(`Seeded ${records.length} sources. Save this base ID in n8n credentials: ${base.id}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
