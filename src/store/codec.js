// Maps pipeline objects <-> Airtable fields. Objects/arrays are stored as JSON or newline text,
// and fields that don't exist in airtable/schema.json are dropped (Airtable rejects unknown fields).

const schema = require('../../airtable/schema.json');

const KEYS = { Sources: 'domain', Stories: 'story_id', Scores: 'story_id', Research: 'story_id', Issues: 'issue_date', Performance: 'issue_id', 'Run Log': 'run_id', 'Content Ideas': 'idea', 'Pain Points': 'reader_reply' };

// Domain field -> how to store it.
const CODECS = {
  Stories: { supporting_urls: 'lines', companies: 'csv', unresolved_questions: 'lines', merged_story_ids: 'lines', scores: { as: 'scores_json', kind: 'json' } },
  Research: { claims: { as: 'claims_json', kind: 'json' }, pricing: { as: 'pricing_json', kind: 'json' }, evidence_urls: 'lines', limitations: 'lines', direct_quotes: 'json', packet: { as: 'packet_json', kind: 'json' } },
  Issues: { subject_options: 'lines', fact_check: { as: 'fact_check_json', kind: 'json' }, plan: { as: 'plan_json', kind: 'json' }, extra_research: { as: 'extra_research_json', kind: 'json' }, gate: { as: 'gate_json', kind: 'json' }, story_ids: 'lines' },
  Performance: { top_links: 'json', top_sections: 'json' },
};

const fieldNames = Object.fromEntries(schema.tables.map((t) => [t.name, new Set(t.fields.map((f) => f.name))]));
const fieldTypes = Object.fromEntries(schema.tables.map((t) => [t.name, Object.fromEntries(t.fields.map((f) => [f.name, f.type]))]));

function spec(table, key) {
  const c = (CODECS[table] || {})[key];
  if (!c) return { as: key, kind: 'raw' };
  return typeof c === 'string' ? { as: key, kind: c } : c;
}

function encode(table, obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const { as, kind } = spec(table, k);
    if (!fieldNames[table]?.has(as)) continue;
    let val = v;
    if (kind === 'json') val = JSON.stringify(v);
    else if (kind === 'lines') val = (v || []).join('\n');
    else if (kind === 'csv') val = (v || []).join(', ');
    if (fieldTypes[table][as] === 'percent' && typeof val === 'number' && val > 1) val = val / 100; // beehiiv gives 45.2, Airtable wants 0.452
    if (typeof val === 'string' && val.length > 99000) val = val.slice(0, 99000);
    out[as] = val;
  }
  return out;
}

function decode(table, fields) {
  const out = { ...fields };
  for (const k of Object.keys(CODECS[table] || {})) {
    const { as, kind } = spec(table, k);
    if (!(as in fields)) { if (kind === 'lines' || kind === 'csv') out[k] = []; continue; }
    const raw = fields[as];
    if (kind === 'json') { try { out[k] = JSON.parse(raw); } catch { out[k] = null; } }
    else if (kind === 'lines') out[k] = String(raw).split('\n').filter(Boolean);
    else if (kind === 'csv') out[k] = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    if (as !== k) delete out[as];
  }
  return out;
}

module.exports = { encode, decode, KEYS };
