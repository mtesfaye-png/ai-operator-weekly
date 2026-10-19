// Agent B — Deep Researcher. Builds claim-evidence packets and verifies pricing on official pages.
// Code enforces what the prompt asks for:
//  - every evidence URL must be one Claude actually retrieved this run (search result or fetched page)
//  - pricing and benchmark claims need a page that was actually FETCHED, not just a search hit
//  - checked_at comes from the fetch's retrieved_at, never from the model
//  - a price only counts as official if its page is on the vendor's own domain

const { askJson, toolDefs } = require('../claude');
const { loadSchema } = require('../validate');
const { loadPrompt, canon, hostOf, domainMatches, tierOf, json } = require('./common');
const { formatPrice } = require('../../lib/pricing');

const NEEDS_FETCH = new Set(['pricing', 'benchmark', 'funding']);

function enforce(packet, retrieved, { sources, vendorDomains }) {
  const seen = new Map(); // canon url -> { kind, retrieved_at }
  for (const r of retrieved) {
    const k = canon(r.url);
    const prev = seen.get(k);
    if (!prev || r.kind === 'fetch') seen.set(k, { kind: r.kind, retrieved_at: r.retrieved_at || prev?.retrieved_at });
  }
  const notes = [];

  for (const st of packet.stories) {
    const vendors = vendorDomains[st.story_id] || [];
    st.limitations = st.limitations || [];
    for (const c of st.claims) {
      if (!c.claim_id.startsWith(`${st.story_id}:`)) c.claim_id = `${st.story_id}:${c.claim_id}`; // unique across batches
      const ok = c.evidence_urls.filter((u) => {
        const hit = seen.get(canon(u));
        return hit && (!NEEDS_FETCH.has(c.claim_type) || hit.kind === 'fetch');
      });
      if (ok.length < c.evidence_urls.length) notes.push(`${st.story_id}/${c.claim_id}: dropped ${c.evidence_urls.length - ok.length} evidence URL(s) that were not retrieved`);
      c.evidence_urls = ok;
      c.source_tier = ok.length ? Math.min(...ok.map((u) => tierOf(u, sources))) : 9;
      if (!ok.length && c.status !== 'unverified') { c.status = 'unverified'; st.limitations.push(`Claim ${c.claim_id} has no retrieved evidence; marked unverified`); }
    }
    st.pricing = (st.pricing || []).filter((p) => {
      const hit = seen.get(canon(p.source_url));
      if (!hit || hit.kind !== 'fetch') { st.limitations.push(`Price for ${p.product} ${p.plan} dropped: pricing page was not fetched this run`); return false; }
      p.checked_at = hit.retrieved_at || new Date().toISOString();
      const host = hostOf(p.source_url);
      p.source_is_official = vendors.some((d) => domainMatches(host, d)) || tierOf(p.source_url, sources) === 1;
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
  const vendorDomains = Object.fromEntries(items.map((i) => [i.story_id, i.vendor_domains || []]));
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
    model: cfg.runtime.models.researcher, system: loadPrompt(cfg, 'researcher'),
    tools: toolDefs(cfg, { search: lim.research_max_searches, fetch: lim.research_max_fetches }),
  });
  const notes = enforce(data, retrieved, { sources, vendorDomains });
  return { packet: data, notes, retrieved };
}

module.exports = { runResearch, enforce };
