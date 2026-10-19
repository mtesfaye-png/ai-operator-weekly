// Price freshness checks (brief §3 "pricing is volatile", §13 pricing test).
// A price is usable only if it came from an official vendor page and was checked recently.

function priceIssues(p, { now = new Date(), maxAgeHours = 72, officialDomains = [] } = {}) {
  const issues = [];
  if (!p.source_url) issues.push('no source_url');
  if (!p.checked_at) issues.push('no checked_at');
  if (!p.billing_basis) issues.push('no billing_basis');
  if (p.checked_at) {
    const ageH = (new Date(now) - new Date(p.checked_at)) / 3600000;
    if (ageH > maxAgeHours) issues.push(`STALE: checked ${Math.round(ageH)}h ago (limit ${maxAgeHours}h)`);
  }
  if (p.source_url && officialDomains.length) {
    const host = new URL(p.source_url).hostname.replace(/^www\./, '');
    const official = officialDomains.some((d) => host === d || host.endsWith(`.${d}`));
    if (!official) issues.push(`NOT_OFFICIAL: ${host}`);
  }
  return issues;
}

// Returns which prices must be re-fetched before writing. The Researcher step calls the
// vendor pricing page for each entry in `refresh`; anything it cannot refresh stays flagged.
function freshnessPlan(prices, opts) {
  const fresh = [], refresh = [];
  for (const p of prices) {
    const issues = priceIssues(p, opts);
    issues.length ? refresh.push({ ...p, issues }) : fresh.push(p);
  }
  return { fresh, refresh };
}

function formatPrice(p) {
  const basis = {
    per_month: '/month', per_seat_month: '/seat/month', per_year: '/year',
    per_million_input_tokens: ' per 1M input tokens', per_million_output_tokens: ' per 1M output tokens',
    usage_based: ' (usage-based)', annual_only: '/year, billed annually', one_time: ' one-time', free: '', custom: ' (custom pricing)',
  }[p.billing_basis] ?? '';
  const amt = p.amount == null ? 'Contact sales' : p.amount === 0 ? 'Free' : `${p.currency === 'USD' ? '$' : p.currency + ' '}${p.amount}`;
  const date = new Date(p.checked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  return `${amt}${basis} (checked ${date})`;
}

module.exports = { priceIssues, freshnessPlan, formatPrice };
