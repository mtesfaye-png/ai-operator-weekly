#!/usr/bin/env node
// Quick, deterministic checks on a finished issue.md before it goes into beehiiv. No network, no AI.
//   node scripts/check-issue.js issues/2026-11-07/written/issue.md
// Blocks (exit 2): a required section missing, a claim phrase the style rules ban, a price with no "checked"
// date near it, a story with no source link, or the editor box still in place when --final is passed.
// Warns: outside the word target, [DRAFT TAKE] lines still waiting for the editor.

const fs = require('fs');
const path = require('path');
const nl = require('../config/newsletter.json');

function check(md, { final = false } = {}) {
  const blocking = [], warnings = [];
  const text = md.toLowerCase();
  const heads = [...md.matchAll(/^##\s+(.*)$/gm)].map((m) => m[1].toLowerCase());
  const norm = (s) => s.toLowerCase().replace(/->/g, '→').replace(/[^\p{L}\p{N}→ ]/gu, '').replace(/\s+/g, ' ').trim();
  for (const s of nl.sections.filter((x) => x.required)) {
    const want = norm(s.title).split(' ').filter((w) => w.length > 2).slice(0, 3);
    if (!heads.some((h) => want.every((w) => norm(h).includes(w)))) blocking.push(`missing required section: ${s.title}`);
  }
  const benign = (nl.benign_phrases || []).map((p) => p.toLowerCase());
  let scrubbed = text; for (const b of benign) scrubbed = scrubbed.split(b).join(' ');
  for (const p of nl.banned_unsupported_phrases) if (new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(scrubbed)) blocking.push(`banned unsupported phrase: "${p}"`);
  const paras = md.split(/\n\s*\n/).filter((p) => !p.trimStart().startsWith('>')); // the editor box is deleted before sending
  // A price tag ("$20/month", "$3 per million tokens", "$19 per seat"), not any dollar figure in the news.
  const PRICE = /(\$|€|£)\s?\d[\d,.]*\s*(\/|per\s+)(mo\b|month|year|yr|user|seat|million|1m|m tokens|token|hour|request|image|minute)/i;
  for (const p of paras) if (PRICE.test(p) && !/checked|as of|estimate/i.test(p)) blocking.push(`price without a "checked <date>" or "Estimate" label: ${p.replace(/\s+/g, ' ').slice(0, 90)}…`);
  const stories = md.split(/^### /m).slice(1).filter((s) => /^\d\./.test(s));
  stories.forEach((s) => { if (!/\]\(https?:\/\//.test(s)) blocking.push(`story without a source link: ${s.split('\n')[0]}`); });
  if (final && /EDITOR REVIEW REQUIRED/.test(md)) blocking.push('the EDITOR REVIEW box is still in the issue');
  const takes = (md.match(/\[DRAFT TAKE[^\]]*\]/g) || []).length;
  if (takes) (final ? blocking : warnings).push(`${takes} [DRAFT TAKE] line(s) still need the editor`);
  const words = md.replace(/\]\([^)]*\)/g, ']').split(/\s+/).filter(Boolean).length;
  if (words < nl.word_target.min || words > nl.word_target.max) warnings.push(`${words} words (target ${nl.word_target.min}–${nl.word_target.max})`);
  return { pass: !blocking.length, words, blocking, warnings };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/check-issue.js <issue.md> [--final]'); process.exit(1); }
  const r = check(fs.readFileSync(path.resolve(file), 'utf8'), { final: process.argv.includes('--final') });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.pass ? 0 : 2);
}
module.exports = { check };
