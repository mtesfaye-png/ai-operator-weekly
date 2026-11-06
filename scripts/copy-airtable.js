#!/usr/bin/env node
// One-time copy of every table from one AI Operator Weekly Airtable base into another (e.g. Mohil's base into
// Manuel's, so there is one shared base). Upserts on each table's key field, so running it twice adds nothing.
// Rows already in the destination are updated in place, never duplicated; nothing is ever deleted.
//
//   FROM_AIRTABLE_TOKEN=pat… FROM_AIRTABLE_BASE_ID=app…  AIRTABLE_TOKEN=pat… AIRTABLE_BASE_ID=app… \
//     node scripts/copy-airtable.js            # dry run: counts only, writes nothing
//     node scripts/copy-airtable.js --write    # copy
// One token is enough if it can reach both bases. Tokens come from the environment only, never arguments.
// Stops before writing if the destination would pass the Free plan's 1,000 records per base.

const { AirtableStore } = require('../src/store');
const { KEYS } = require('../src/store/codec');
const schema = require('../airtable/schema.json');

const FREE_LIMIT = 1000;

async function fieldsIn(token, baseId, fetchImpl) {
  const r = await fetchImpl(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null; // token lacks schema.bases:read: copy every field and let Airtable report problems
  const j = await r.json();
  return Object.fromEntries(j.tables.map((t) => [t.name, new Set(t.fields.map((f) => f.name))]));
}

async function main({ env = process.env, argv = process.argv.slice(2), fetchImpl = fetch, log = console.log } = {}) {
  const write = argv.includes('--write');
  const from = { token: env.FROM_AIRTABLE_TOKEN || env.AIRTABLE_TOKEN, baseId: env.FROM_AIRTABLE_BASE_ID };
  const to = { token: env.AIRTABLE_TOKEN, baseId: env.AIRTABLE_BASE_ID };
  if (!from.token || !from.baseId || !to.token || !to.baseId) throw new Error('Set FROM_AIRTABLE_BASE_ID (+ FROM_AIRTABLE_TOKEN if different) and AIRTABLE_TOKEN + AIRTABLE_BASE_ID for the destination.');
  if (from.baseId === to.baseId) throw new Error('Source and destination are the same base.');
  const throttleMs = env.AOW_TEST_NO_THROTTLE ? 0 : 220;
  const src = new AirtableStore({ ...from, throttleMs }, fetchImpl), dst = new AirtableStore({ ...to, throttleMs }, fetchImpl);
  const destFields = await fieldsIn(to.token, to.baseId, fetchImpl);

  const plan = [];
  for (const t of schema.tables) {
    const key = KEYS[t.name] || t.fields[0].name;
    const rows = await src.all(t.name);
    const have = new Set((await dst.all(t.name, undefined, [key])).map((r) => r[key]).filter(Boolean));
    const keep = destFields && destFields[t.name];
    const missingFields = keep ? [...new Set(rows.flatMap(Object.keys))].filter((f) => f !== 'id' && f !== 'createdTime' && !keep.has(f)) : [];
    plan.push({ table: t.name, key, rows: rows.filter((r) => r[key]), new: rows.filter((r) => r[key] && !have.has(r[key])).length, already: have.size, missingFields });
  }
  const after = plan.reduce((n, p) => n + p.already + p.new, 0);
  log(JSON.stringify({ mode: write ? 'write' : 'dry run', from: from.baseId, to: to.baseId, destination_records_after: after, free_limit: FREE_LIMIT,
    tables: plan.map(({ rows, ...p }) => ({ ...p, rows: rows.length })) }, null, 2));
  if (after > FREE_LIMIT * 0.95) throw new Error(`The destination would hold ${after} records, too close to the Free limit of ${FREE_LIMIT}. Archive old Articles first.`);
  if (!write) { log('Dry run only. Add --write to copy.'); return { written: 0, plan }; }

  let written = 0;
  for (const p of plan) {
    if (!p.rows.length) continue;
    const drop = new Set(['id', 'createdTime', ...p.missingFields]);
    const clean = p.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.has(k))));
    await dst.upsert(p.table, clean);
    written += clean.length;
    log(`${p.table}: ${clean.length} rows upserted on ${p.key}${p.missingFields.length ? ` (skipped fields the destination lacks: ${p.missingFields.join(', ')})` : ''}`);
  }
  log(`Done: ${written} rows. Airtable API calls: ${src.calls} read, ${dst.calls} write.`);
  return { written, plan };
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { main };
