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

// Lists every enum in a schema as "path: a | b | c", so prompts can state the allowed values exactly.
function enumHints(schema, at = '$', out = []) {
  if (!schema || typeof schema !== 'object') return out;
  if (schema.enum) out.push(`${at}: ${schema.enum.join(' | ')}`);
  if (schema.properties) for (const [k, sub] of Object.entries(schema.properties)) enumHints(sub, `${at}.${k}`, out);
  if (schema.items) enumHints(schema.items, `${at}[]`, out);
  return [...new Set(out)];
}

// Repairs harmless model slips before validation, never content:
//  - enum near-misses: case, spaces/hyphens ("Pricing Change" -> "pricing_change"); an unknown label becomes
//    "other" ONLY if the enum has "other" (pure classification fields). Status/verdict enums have no "other",
//    so a wrong value there still fails validation.
//  - unknown keys where the schema says additionalProperties:false are dropped.
function coerce(schema, v) {
  if (!schema || typeof schema !== 'object') return v;
  if (schema.enum && typeof v === 'string' && !schema.enum.includes(v)) {
    const key = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const hit = schema.enum.find((e) => typeof e === 'string' && e.toLowerCase() === key);
    if (hit !== undefined) return hit;
    // A label containing an allowed id ("pricing_update", "funding_round") maps to it. Anything about price
    // or cost is always "pricing", so it can never slip past the official-pricing rules as "other".
    if (schema.enum.includes('pricing') && /pric|cost|fee|plan_change|subscription/.test(key)) return 'pricing';
    const part = schema.enum.find((e) => typeof e === 'string' && e.length >= 4 && e !== 'other' && key.includes(e));
    if (part !== undefined) return part;
    if (schema.enum.includes('other')) return 'other';
    return v;
  }
  if (Array.isArray(v) && schema.items) return v.map((x) => coerce(schema.items, x));
  if (v && typeof v === 'object' && !Array.isArray(v) && schema.properties) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (schema.properties[k]) out[k] = coerce(schema.properties[k], x);
      else if (schema.additionalProperties !== false) out[k] = x;
    }
    return out;
  }
  return v;
}

module.exports = { validate, loadSchema, enumHints, coerce };
