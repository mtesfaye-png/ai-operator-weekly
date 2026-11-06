#!/usr/bin/env node
// One-time copy of every table from one AI Operator Weekly Airtable base into another (e.g. Mohil's base into
// Manuel's, so there is one shared base). Upserts on each table's key field, so running it twice adds nothing.
// Rows already in the destination are updated in place, never duplicated; nothing is ever deleted.
//
//   FROM_AIRTABLE_TOKEN=pat… FROM_AIRTABLE_BASE_ID=app…  AIRTABLE_TOKEN=pat… AIRTABLE_BASE_ID=app… \
//     node scripts/copy-airtable.js            # dry run: counts only, writes nothing
//     node scripts/copy-airtable.js --write    # copy
//   node scripts/copy-airtable.js --export file.json      # save the FROM base to a file (no writes anywhere)
//   node scripts/copy-airtable.js --from-file file.json [--write]  # load that file into the destination base
// One token is enough if it can reach both bases. Tokens come from the environment only, never arguments.
// Stops before writing if the destination would pass the Free plan's 1,000 records per base.

const { AirtableStore } = require('../src/store');
const { KEYS } = require('../src/store/codec');
const schema = require('../airtable/schema.json');

const fs = require('fs');

const FREE_LIMIT = 1000;
const SKIP_TABLES = new Set(['Run Log']); // machine-specific history: not worth the records

async function fieldsIn(token, baseId, fetchImpl) {
  const r = await fetchImpl(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null; // token lacks schema.bases:read: copy every field and let Airtable report problems
  const j = await r.json();
  return Object.fromEntries(j.tables.map((t) => [t.name, new Set(t.fields.map((f) => f.name))]));
}

const argVal = (argv, k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };

// Upsert, dropping any field the destination base doesn't have (Airtable answers 422 UNKNOWN_FIELD_NAME).
async function upsertTolerant(dst, table, rows, log) {
  const dropped = [];
  let clean = rows;
  for (let tries = 0; tries < 30; tries++) {
    try { await dst.upsert(table, clean); return dropped; } catch (e) {
      const m = String(e.message).match(/Unknown field name: \\?"([^"\\]+)\\?"/i);
      if (!m) throw e;
      dropped.push(m[1]);
      clean = clean.map(({ [m[1]]: _, ...r }) => r);
      log(`${table}: destination has no field "${m[1]}", skipping it`);
    }
  }
  throw new Error(`${table}: too many unknown fields`);
}

async function main({ env = process.env, argv = process.argv.slice(2), fetchImpl = fetch, log = console.log } = {}) {
  const write = argv.includes('--write');
  const exportTo = argVal(argv, '--export'), fromFile = argVal(argv, '--from-file');
  const throttleMs = env.AOW_TEST_NO_THROTTLE ? 0 : 220;
  const from = { token: env.FROM_AIRTABLE_TOKEN || env.AIRTABLE_TOKEN, baseId: env.FROM_AIRTABLE_BASE_ID };
  const to = { token: env.AIRTABLE_TOKEN, baseId: env.AIRTABLE_BASE_ID };
  const tables = schema.tables.filter((t) => !SKIP_TABLES.has(t.name));

  // Source rows: from a base, or from a file made earlier with --export.
  let source;
  if (fromFile) source = JSON.parse(fs.readFileSync(fromFile, 'utf8')).tables;
  else {
    if (!from.token || !from.baseId) throw new Error('Set FROM_AIRTABLE_BASE_ID (+ FROM_AIRTABLE_TOKEN if different), or use --from-file.');
    const src = new AirtableStore({ ...from, throttleMs }, fetchImpl);
    source = {};
    for (const t of tables) source[t.name] = await src.all(t.name);
  }
  if (exportTo) {
    fs.writeFileSync(exportTo, JSON.stringify({ exported_from: from.baseId, exported_at: new Date().toISOString(), tables: source }, null, 1));
    log(`Exported ${Object.values(source).reduce((n, r) => n + r.length, 0)} rows to ${exportTo}`);
    return { exported: true };
  }
  if (!to.token || !to.baseId) throw new Error('Set AIRTABLE_TOKEN + AIRTABLE_BASE_ID for the destination.');
  if (from.baseId && from.baseId === to.baseId && !fromFile) throw new Error('Source and destination are the same base.');
  const dst = new AirtableStore({ ...to, throttleMs }, fetchImpl);
  const destFields = await fieldsIn(to.token, to.baseId, fetchImpl);

  const plan = [];
  for (const t of tables) {
    const key = KEYS[t.name] || t.fields[0].name;
    const rows = (source[t.name] || []).filter((r) => r[key]);
    const have = new Set((await dst.all(t.name, undefined, [key])).map((r) => r[key]).filter(Boolean));
    const keep = destFields && destFields[t.name];
    const missingFields = keep ? [...new Set(rows.flatMap(Object.keys))].filter((f) => !keep.has(f)) : [];
    plan.push({ table: t.name, key, rows, new: rows.filter((r) => !have.has(r[key])).length, already: have.size, missingFields });
  }
  const after = plan.reduce((n, p) => n + p.already + p.new, 0);
  log(JSON.stringify({ mode: write ? 'write' : 'dry run', from: fromFile || from.baseId, to: to.baseId, destination_records_after: after, free_limit: FREE_LIMIT,
    tables: plan.map(({ rows, ...p }) => ({ ...p, rows: rows.length })) }, null, 2));
  if (after > FREE_LIMIT * 0.95) throw new Error(`The destination would hold ${after} records, too close to the Free limit of ${FREE_LIMIT}. Archive old Articles first.`);
  if (!write) { log('Dry run only. Add --write to copy.'); return { written: 0, plan }; }

  let written = 0;
  for (const p of plan) {
    if (!p.rows.length) continue;
    const drop = new Set(['id', 'createdTime', ...p.missingFields]);
    const clean = p.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.has(k))));
    const dropped = await upsertTolerant(dst, p.table, clean, log);
    written += clean.length;
    log(`${p.table}: ${clean.length} rows upserted on ${p.key}${[...p.missingFields, ...dropped].length ? ` (skipped fields the destination lacks: ${[...p.missingFields, ...dropped].join(', ')})` : ''}`);
  }
  log(`Done: ${written} rows. Airtable API calls: ${dst.calls} on the destination.`);
  return { written, plan };
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { main };
