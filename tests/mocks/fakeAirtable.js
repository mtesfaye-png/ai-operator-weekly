// In-memory Airtable REST API: list (with pagination), create, and PATCH upsert (performUpsert).
// Rejects unknown fields the way the real API does, so codec mistakes fail loudly in tests.

const schema = require('../../airtable/schema.json');
const fields = Object.fromEntries(schema.tables.map((t) => [t.name, new Set(t.fields.map((f) => f.name))]));

function makeFakeAirtable(baseId) {
  const tables = {};
  const requests = [];
  let n = 0;
  const resp = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
  const check = (table, f) => { const bad = Object.keys(f).filter((k) => !fields[table].has(k)); if (bad.length) throw new Error(`UNKNOWN_FIELD_NAME ${table}: ${bad.join(', ')}`); };

  async function handle(url, opts = {}) {
    const m = String(url).match(new RegExp(`^https://api\\.airtable\\.com/v0/${baseId}/([^?]+)(\\?.*)?$`));
    if (!m) return null;
    const table = decodeURIComponent(m[1]);
    const method = opts.method || 'GET';
    requests.push({ method, table, body: opts.body ? JSON.parse(opts.body) : null });
    const rows = (tables[table] ||= []);
    try {
      if (method === 'GET') {
        const qs = new URLSearchParams(m[2] || '');
        const start = Number(qs.get('offset') || 0);
        const page = rows.slice(start, start + 100);
        return resp(200, { records: page.map((r) => ({ id: r.id, fields: r.fields })), ...(start + 100 < rows.length ? { offset: String(start + 100) } : {}) });
      }
      const body = JSON.parse(opts.body);
      if (body.records.length > 10) return resp(422, { error: 'TOO_MANY_RECORDS' });
      if (method === 'POST') {
        const created = body.records.map((r) => { check(table, r.fields); const rec = { id: `rec${++n}`, fields: r.fields }; rows.push(rec); return rec; });
        return resp(200, { records: created });
      }
      if (method === 'PATCH' && body.performUpsert) {
        const key = body.performUpsert.fieldsToMergeOn[0];
        const out = body.records.map((r) => {
          check(table, r.fields);
          const hit = rows.find((x) => x.fields[key] === r.fields[key]);
          if (hit) { Object.assign(hit.fields, r.fields); return hit; }
          const rec = { id: `rec${++n}`, fields: r.fields }; rows.push(rec); return rec;
        });
        return resp(200, { records: out });
      }
      return resp(400, { error: 'unsupported' });
    } catch (e) { return resp(422, { error: { type: e.message } }); }
  }
  return { handle, tables, requests };
}

module.exports = { makeFakeAirtable };
