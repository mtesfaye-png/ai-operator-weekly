// Minimal JSON Schema validator covering the subset used in schemas/*.json.
// Supports: type (incl. arrays like ["string","null"]), enum, required, properties,
// additionalProperties:false, items, minItems, maxItems, minLength, maxLength,
// minimum, maximum, pattern, format (date, date-time, uri).

const fs = require('fs');
const path = require('path');

const FORMATS = {
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
  'date-time': (v) => !Number.isNaN(Date.parse(v)) && /T/.test(v),
  uri: (v) => { try { new URL(v); return true; } catch { return false; } },
};

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

function check(schema, v, at, errors) {
  if (schema.enum && !schema.enum.includes(v)) { errors.push(`${at}: must be one of ${schema.enum.join(', ')}`); return; }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(v, t))) { errors.push(`${at}: expected ${types.join('|')}, got ${typeOf(v)}`); return; }
  }
  if (v === null) return;
  if (typeof v === 'string') {
    if (schema.minLength != null && v.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength != null && v.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) errors.push(`${at}: does not match ${schema.pattern}`);
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](v)) errors.push(`${at}: invalid ${schema.format}`);
  }
  if (typeof v === 'number') {
    if (schema.minimum != null && v < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum != null && v > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(v)) {
    if (schema.minItems != null && v.length < schema.minItems) errors.push(`${at}: needs at least ${schema.minItems} items`);
    if (schema.maxItems != null && v.length > schema.maxItems) errors.push(`${at}: allows at most ${schema.maxItems} items`);
    if (schema.items) v.forEach((x, i) => check(schema.items, x, `${at}[${i}]`, errors));
  }
  if (typeOf(v) === 'object') {
    for (const k of schema.required || []) if (!(k in v)) errors.push(`${at}.${k}: required`);
    const props = schema.properties || {};
    for (const [k, sub] of Object.entries(props)) if (k in v) check(sub, v[k], `${at}.${k}`, errors);
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(v)) if (!(k in props)) errors.push(`${at}.${k}: not allowed`);
    }
  }
}

function validate(schema, value) {
  const errors = [];
  check(schema, value, '$', errors);
  return { valid: errors.length === 0, errors };
}

const cache = {};
function loadSchema(name) {
  if (!cache[name]) cache[name] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', `${name}.schema.json`), 'utf8'));
  return cache[name];
}

module.exports = { validate, loadSchema };
