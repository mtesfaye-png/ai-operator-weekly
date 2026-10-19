// Agent B — Deep Researcher. Builds claim-evidence packets and verifies pricing on official pages.
// Code enforces what the prompt asks for:
//  - every evidence URL must be one Claude actually retrieved this run (search result or fetched page)
//  - pricing and benchmark claims need a page that was actually FETCHED, not just a search hit
//  - checked_at comes from the fetch's retrieved_at, never from the model
//  - a price only counts as official if its page is on the PRODUCT VENDOR's own domains. The source tier of
//    the pricing page is never consulted: a Tier 1 page belongs to one vendor, not to every vendor.
//    A vendor domain is trusted only if it is (a) listed in config/official_pricing_domains.json, (b) a Tier 1
//    domain in the source registry, or (c) the host of the story's own primary page, fetched this run.
//    Registry Tier 2-4 domains (publishers, newsletters, communities) are never a vendor unless listed in (a).
//    No trusted vendor domain -> the price is kept for audit but marked unverified; the writer never sees it
//    and the quality gate blocks the issue.

const { askJson, toolDefs } = require('../claude');
const { loadSchema } = require('../validate');
const { loadPrompt, canon, hostOf, domainMatches, tierOf, json } = require('./common');
const { formatPrice } = require('../../lib/pricing');

const NEEDS_FETCH = new Set(['pricing', 'benchmark', 'funding']);

// "https://www.Vendor.com/pricing" -> "vendor.com"; anything without a dot (e.g. "com") -> ''.
function normDomain(d) {
  const s = String(d || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : '';
}

// Official pricing domains for one research item: { domains, claimed, rejected }.
function officialDomainsFor(item, { sources, officialPricing, seen }) {
  const groups = Object.entries(officialPricing || {}).map(([k, v]) => [k, ...v].map(normDomain).filter(Boolean));
  const listed = (d) => groups.some((g) => g.some((x) => domainMatches(d, x)));
  const claimed = [...new Set((item?.vendor_domains || []).map(normDomain).filter(Boolean))];
  const verified = [], rejected = [];
  for (const d of claimed) {
    const tier = tierOf(`https://${d}/`, sources);
    const primaryFetched = !!item.primary_url && hostOf(item.primary_url) === d && seen.get(canon(item.primary_url))?.kind === 'fetch';
    if (listed(d) || (tier === 1) || (primaryFetched && tier >= 5)) verified.push(d);
    else rejected.push(tier >= 2 && tier <= 4 ? `${d} (registry Tier ${tier} publisher/community, not a vendor)` : `${d} (not in the registry or official_pricing_domains.json, and not the story's fetched primary page)`);
  }
  const domains = new Set(verified);
  for (const v of verified) for (const g of groups) if (g.some((x) => domainMatches(v, x))) g.forEach((x) => domains.add(x));
  return { domains: [...domains], claimed, rejected };
}

function enforce(packet, retrieved, { sources, items = [], officialPricing = {} }) {
  const seen = new Map(); // canon url -> { kind, retrieved_at }
  for (const r of retrieved) {
    const k = canon(r.url);
    const prev = seen.get(k);
    if (!prev || r.kind === 'fetch') seen.set(k, { kind: r.kind, retrieved_at: r.retrieved_at || prev?.retrieved_at });
  }
  const notes = [];

  const itemsById = Object.fromEntries(items.map((i) => [i.story_id, i]));
  for (const st of packet.stories) {
    const official = officialDomainsFor(itemsById[st.story_id], { sources, officialPricing, seen });
    st.limitations = st.limitations || [];
    for (const c of st.claims) {
      if (!c.claim_id.startsWith(`${st.story_id}:`)) c.claim_id = `${st.story_id}:${c.claim_id}`; // unique across batches
      const ok = c.evidence_urls.filter((u) => {
        const hit = seen.get(canon(u));
        if (!hit || (NEEDS_FETCH.has(c.claim_type) && hit.kind !== 'fetch')) return false;
        // A pricing claim is evidence of a price, so it obeys the same official-domain rule as pricing[].
        return c.claim_type !== 'pricing' || official.domains.some((d) => domainMatches(hostOf(u), d));
      });
      if (ok.length < c.evidence_urls.length) notes.push(`${st.story_id}/${c.claim_id}: dropped ${c.evidence_urls.length - ok.length} evidence URL(s) that were not retrieved${c.claim_type === 'pricing' ? ' or not on the vendor\'s official pricing domains' : ''}`);
      c.evidence_urls = ok;
      c.source_tier = ok.length ? Math.min(...ok.map((u) => tierOf(u, sources))) : 9;
      if (!ok.length && c.status !== 'unverified') { c.status = 'unverified'; st.limitations.push(`Claim ${c.claim_id} has no retrieved evidence; marked unverified`); }
    }
    st.pricing = (st.pricing || []).filter((p) => {
      const hit = seen.get(canon(p.source_url));
      if (!hit || hit.kind !== 'fetch') { st.limitations.push(`Price for ${p.product} ${p.plan} dropped: pricing page was not fetched this run`); return false; }
      p.checked_at = hit.retrieved_at || new Date().toISOString();
      const host = hostOf(p.source_url);
      p.source_is_official = official.domains.some((d) => domainMatches(host, d));
      if (p.source_is_official) delete p.unverified_reason;
      else {
        p.unverified_reason = !official.claimed.length ? 'vendor domain unknown'
          : !official.domains.length ? `vendor domain not verified: ${official.rejected.join('; ')}`
            : `${host} is not one of the vendor's pricing domains (${official.domains.join(', ')})`;
        st.limitations.push(`Price for ${p.product} ${p.plan} is UNVERIFIED (${p.unverified_reason}); it is withheld from the writer`);
      }
      p.display = formatPrice(p);
      return true;
    });
    // A story is verified only if at least one confirmed claim has evidence.
    st.verified = st.verified && st.claims.some((c) => c.status === 'confirmed' && c.evidence_urls.length);
  }
  return notes;
}

// mode "stories": verify selected news stories.  mode "requests": answer the writer's research requests
// (tool pricing, resources, upcoming events). Both return the same packet shape.
async function runResearch({ cfg, fetchImpl, budget, items, mode, sources, now = new Date() }) {
  const schema = loadSchema('research_packet');
  const lim = cfg.runtime.limits.weekly;
  const intro = mode === 'stories'
    ? 'Verify each selected story below. Fetch the primary URL first, then supporting URLs as needed. Every URL listed here may be fetched.'
    : 'Answer each research request below. For tools, find and FETCH the official pricing page (search for it if the hint URL fails) and record every plan that matters for the stated use. For resources, fetch the page to confirm it exists and says what we claim. For upcoming events, find a dated source.';
  const user = [
    `Now: ${now.toISOString()}`,
    intro,
    `Items:\n${json(items)}`,
    'Use each item\'s story_id as the packet story_id. Return JSON only, matching the research packet schema. generated_at = now. Put a URL in evidence_urls only if you opened it or saw it in search results in THIS conversation.',
  ].join('\n\n');

  const { data, retrieved } = await askJson({
    cfg, fetchImpl, budget, step: `research:${mode}`, schema, user,
    model: cfg.runtime.models.researcher, effort: cfg.runtime.effort?.researcher, system: loadPrompt(cfg, 'researcher'),
    tools: toolDefs(cfg, { search: lim.research_max_searches, fetch: lim.research_max_fetches }),
  });
  const notes = enforce(data, retrieved, { sources, items, officialPricing: cfg.officialPricing });
  return { packet: data, notes, retrieved };
}

module.exports = { runResearch, enforce, officialDomainsFor, normDomain };
