const fs = require('fs');
const path = require('path');

function loadPrompt(cfg, name) {
  const raw = fs.readFileSync(path.join(cfg.root, 'prompts', `${name}.md`), 'utf8');
  return raw.replace(/^# .*\n/, '').trim(); // drop the file's title line
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const domainMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// Tier of a URL according to the source registry (9 = unknown domain).
function tierOf(url, sources) {
  const host = hostOf(url);
  const hit = sources.filter((s) => domainMatches(host, s.domain)).sort((a, b) => a.tier - b.tier)[0];
  return hit ? hit.tier : 9;
}

// Canonical form for comparing URLs Claude claims with URLs it actually retrieved.
function canon(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    [...x.searchParams.keys()].filter((k) => k.startsWith('utm_')).forEach((k) => x.searchParams.delete(k));
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/$/, '')}${x.search}`.toLowerCase();
  } catch { return String(u).toLowerCase(); }
}

const json = (o) => JSON.stringify(o, null, 2);

module.exports = { loadPrompt, hostOf, domainMatches, tierOf, canon, json };
