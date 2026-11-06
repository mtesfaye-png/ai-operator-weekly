#!/usr/bin/env node
// Sets KEY=value lines in the repo's .env (created with mode 600). Values come from the environment of this
// process, never from argv, so they don't show up in `ps` or shell history.
// Usage: AOW_SET_KEYS="A B" A=... B=... node deploy/mac/set-env.js
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', '..', '.env');
const keys = String(process.env.AOW_SET_KEYS || '').split(/\s+/).filter(Boolean);
let lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
for (const k of keys) {
  const v = process.env[k];
  if (v === undefined || v === '') continue;
  if (/[\r\n]/.test(v)) { console.error(`${k}: value contains a line break; skipped`); continue; }
  const i = lines.findIndex((l) => l.startsWith(`${k}=`));
  if (i >= 0) lines[i] = `${k}=${v}`; else lines.push(`${k}=${v}`);
  console.log(`✔ ${k} saved`);
}
fs.writeFileSync(file, lines.filter((l, i, a) => l !== '' || i < a.length - 1).join('\n') + '\n', { mode: 0o600 });
fs.chmodSync(file, 0o600);
