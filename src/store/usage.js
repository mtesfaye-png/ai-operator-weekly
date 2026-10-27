// Local ledger of Airtable API calls per calendar month (UTC). Airtable Free allows 1,000 calls per
// workspace per month; the app stops itself below that (runtime.json → airtable.monthly_call_budget).
// It only counts this app's calls: check Workspace settings → Summary if anything else uses the API.

const fs = require('fs');
const path = require('path');

const month = (now = new Date()) => now.toISOString().slice(0, 7);
const file = (dataDir) => path.join(dataDir, 'airtable_usage.json');
const read = (dataDir) => { try { return JSON.parse(fs.readFileSync(file(dataDir), 'utf8')); } catch { return {}; } };

function usedThisMonth(dataDir, now) { return read(dataDir)[month(now)] || 0; }

function addCalls(dataDir, n, now) {
  if (!n) return usedThisMonth(dataDir, now);
  const all = read(dataDir);
  all[month(now)] = (all[month(now)] || 0) + n;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file(dataDir), JSON.stringify(all, null, 2));
  return all[month(now)];
}

module.exports = { usedThisMonth, addCalls, month };
