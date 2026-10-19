// Simulated Claude / beehiiv / RSS / Slack APIs for offline end-to-end runs.
// Every company and domain here is fictional (*.example). Nothing in this file is real news.

const NOW_ISO = () => fakeState.now.toISOString();
// Fault switches for tests: writerFault ('max_tokens' | 'truncated'), expandInsufficient, reviseNoop,
// beehiivPending (POST accepted, post never finishes), beehiivPostDropsConnection.
const fakeState = { now: new Date('2026-10-18T14:00:00Z'), sent: false, calls: [], failBeehiiv: false, posts: {} };

const MOCK_SOURCES = [
  { name: 'Northwind AI Blog', domain: 'northwind.example', tier: 1, category: 'frontier_models', rss_url: 'https://northwind.example/feed.xml', active: true, trust_notes: 'Fictional vendor' },
  { name: 'Contoso Newsroom', domain: 'contoso.example', tier: 1, category: 'enterprise', rss_url: 'https://contoso.example/rss', active: true, trust_notes: 'Fictional vendor' },
  { name: 'Fabrikam Labs', domain: 'fabrikam.example', tier: 1, category: 'open_source', rss_url: '', active: true, trust_notes: 'Fictional lab' },
  { name: 'Litware Changelog', domain: 'litware.example', tier: 1, category: 'tools', rss_url: '', active: true, trust_notes: 'Fictional tool' },
  { name: 'Tailspin Blog', domain: 'tailspin.example', tier: 1, category: 'workflow', rss_url: '', active: true, trust_notes: 'Fictional tool' },
  { name: 'Digital Standards Office', domain: 'policy.example', tier: 1, category: 'regulation', rss_url: '', active: true, trust_notes: 'Fictional regulator' },
  { name: 'Woodgrove Newsroom', domain: 'woodgrove.example', tier: 1, category: 'business', rss_url: '', active: true, trust_notes: 'Fictional bank' },
  { name: 'Wire Service', domain: 'wire.example', tier: 2, category: 'business', rss_url: 'https://wire.example/tech.rss', active: true, trust_notes: 'Fictional wire' },
  { name: 'AI Digest', domain: 'digest.example', tier: 3, category: 'discovery', rss_url: 'https://digest.example/feed', active: true, trust_notes: 'Fictional newsletter' },
];

const FEEDS = {
  'https://northwind.example/feed.xml': `<?xml version="1.0"?><rss><channel><item><title>Introducing Atlas 3</title><link>https://northwind.example/news/atlas-3</link><pubDate>Fri, 16 Oct 2026 15:00:00 GMT</pubDate></item></channel></rss>`,
  'https://contoso.example/rss': `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Contoso Agents are now generally available</title><link href="https://contoso.example/blog/agents-ga"/><updated>2026-10-17T13:00:00Z</updated></entry></feed>`,
  'https://wire.example/tech.rss': `<rss><channel><item><title><![CDATA[Northwind launches Atlas 3 with cheaper API]]></title><link>https://wire.example/2026/10/16/northwind-atlas-3</link><pubDate>Fri, 16 Oct 2026 18:00:00 GMT</pubDate></item></channel></rss>`,
  // digest.example deliberately returns 500 to exercise feed-failure handling
};

// ---------- scenario data ----------
const S = (id, headline, date, category, companies, primary, extra) => ({
  story_id: id, headline, event_date: date, category, companies, primary_url: primary, supporting_urls: extra.supporting || [],
  factual_summary: extra.summary, why_it_might_matter: extra.why, pricing_change: !!extra.pricing,
  scores: extra.scores, confidence: extra.confidence ?? 0.85, unresolved_questions: [],
});
const SCOUT_STORIES = [
  S('2026-10-16-northwind-atlas-3', 'Northwind releases Atlas 3 with lower API prices', '2026-10-16', 'frontier_models', ['Northwind AI'], 'https://northwind.example/news/atlas-3',
    { summary: 'Northwind released Atlas 3 and cut API prices.', why: 'Cheaper frontier-class model for production use.', pricing: true, scores: { importance: 5, usefulness: 4, business_value: 4, novelty: 3, audience_fit: 5 } }),
  S('2026-10-16-northwind-atlas-3-wire', 'Northwind launches Atlas 3 with cheaper API', '2026-10-16', 'frontier_models', ['Northwind AI'], 'https://wire.example/2026/10/16/northwind-atlas-3',
    { summary: 'Wire coverage of the Atlas 3 launch.', why: 'Same event.', scores: { importance: 5, usefulness: 4, business_value: 4, novelty: 2, audience_fit: 5 } }),
  S('2026-10-17-contoso-agents-ga', 'Contoso Agents become generally available for enterprise customers', '2026-10-17', 'enterprise', ['Contoso'], 'https://contoso.example/blog/agents-ga',
    { summary: 'Contoso made its agent builder generally available with admin controls.', why: 'Enterprise agent adoption gets a mainstream option.', scores: { importance: 4, usefulness: 4, business_value: 5, novelty: 3, audience_fit: 5 } }),
  S('2026-10-16-fabrikam-open-weights', 'Fabrikam Labs publishes open-weights Kestrel 70B', '2026-10-16', 'open_source', ['Fabrikam Labs'], 'https://fabrikam.example/research/kestrel-70b',
    { summary: 'Fabrikam released Kestrel 70B under a permissive licence.', why: 'Self-hosting option for regulated teams.', scores: { importance: 4, usefulness: 3, business_value: 3, novelty: 4, audience_fit: 3 } }),
  S('2026-10-17-dso-ai-disclosure-rule', 'Digital Standards Office finalises AI disclosure rule for customer-facing chatbots', '2026-10-17', 'regulation', ['Digital Standards Office'], 'https://policy.example/rules/ai-disclosure-2026',
    { summary: 'Final rule requires disclosure when customers talk to an AI system.', why: 'Every customer-facing chatbot needs a disclosure line.', scores: { importance: 4, usefulness: 4, business_value: 3, novelty: 3, audience_fit: 4 } }),
  S('2026-10-17-woodgrove-claims-automation', 'Woodgrove Bank reports results from AI claims triage pilot', '2026-10-17', 'business', ['Woodgrove Bank'], 'https://woodgrove.example/news/claims-triage-pilot',
    { summary: 'Woodgrove published pilot results for AI-assisted claims triage.', why: 'A concrete enterprise before/after.', scores: { importance: 3, usefulness: 4, business_value: 5, novelty: 3, audience_fit: 4 } }),
  S('2026-10-16-litware-pricing-change', 'Litware Notes moves AI features into a new Pro plan', '2026-10-16', 'tools', ['Litware'], 'https://litware.example/changelog/pro-plan',
    { summary: 'Litware moved AI features from the base plan to a new Pro plan.', why: 'Existing users may pay more.', pricing: true, scores: { importance: 3, usefulness: 4, business_value: 3, novelty: 3, audience_fit: 4 } }),
  S('2026-10-17-tailspin-flows-mcp', 'Tailspin Flows adds MCP connectors for workflow automation', '2026-10-17', 'workflow', ['Tailspin'], 'https://tailspin.example/blog/flows-mcp',
    { summary: 'Tailspin Flows can now call MCP servers as workflow steps.', why: 'Non-engineers can wire agents to business tools.', scores: { importance: 3, usefulness: 5, business_value: 4, novelty: 3, audience_fit: 4 } }),
  S('2026-04-02-old-reposted-story', 'Northwind announces Atlas 2 (old story with a fresh crawl date)', '2026-04-02', 'frontier_models', ['Northwind AI'], 'https://northwind.example/news/atlas-2',
    { summary: 'Six-month-old news.', why: 'Should be dropped by the date window.', scores: { importance: 4, usefulness: 3, business_value: 3, novelty: 1, audience_fit: 4 } }),
];

const PRICING_PAGES = {
  'northwind.example': { url: 'https://northwind.example/pricing', rows: [{ product: 'Atlas 3', plan: 'API input', amount: 2.5, billing_basis: 'per_million_input_tokens' }, { product: 'Atlas 3', plan: 'API output', amount: 10, billing_basis: 'per_million_output_tokens' }] },
  'tailspin.example': { url: 'https://tailspin.example/pricing', rows: [{ product: 'Tailspin Flows', plan: 'Team', amount: 29, billing_basis: 'per_seat_month', free_tier: 'Free plan: 100 runs/month, 2 workflows' }] },
  'litware.example': { url: 'https://litware.example/pricing', rows: [{ product: 'Litware Notes', plan: 'Pro', amount: 12, billing_basis: 'per_seat_month', free_tier: 'Free plan without AI features' }] },
};

// ---------- helpers ----------
function jsonAfter(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  let start = text.slice(i + marker.length).search(/[[{]/);
  if (start < 0) return null;
  start += i + marker.length;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) return JSON.parse(text.slice(start, j + 1)); }
  }
  return null;
}

function claudeResponse(text, { searched = [], fetched = [], pause = false } = {}) {
  const content = [];
  if (searched.length) {
    content.push({ type: 'server_tool_use', id: 'srvtoolu_s1', name: 'web_search', input: { query: 'mock query' } });
    content.push({ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_s1', content: searched.map((u) => ({ type: 'web_search_result', url: u, title: u, page_age: '1 day ago', encrypted_content: 'x' })) });
  }
  fetched.forEach((u, i) => {
    content.push({ type: 'server_tool_use', id: `srvtoolu_f${i}`, name: 'web_fetch', input: { url: u } });
    content.push({ type: 'web_fetch_tool_result', tool_use_id: `srvtoolu_f${i}`, content: { type: 'web_fetch_result', url: u, retrieved_at: new Date(fakeState.now.getTime() - 3600000).toISOString(), content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'mock page' } } } });
  });
  if (!pause) content.push({ type: 'text', text: '```json\n' + JSON.stringify(text, null, 1) + '\n```' });
  return { id: 'msg_mock', type: 'message', role: 'assistant', content, stop_reason: pause ? 'pause_turn' : 'end_turn',
    usage: { input_tokens: 12000, output_tokens: 2500, server_tool_use: { web_search_requests: searched.length ? 1 : 0, web_fetch_requests: fetched.length } } };
}

// ---------- agent simulators ----------
function scout() {
  return claudeResponse({ window_start: '2026-10-16', window_end: '2026-10-18', stories: SCOUT_STORIES }, { searched: SCOUT_STORIES.map((s) => s.primary_url) });
}

let researchCalls = 0;
function research(user) {
  researchCalls++;
  const items = jsonAfter(user, 'Items:') || [];
  const fetched = [], searched = [];
  const stories = items.map((it) => {
    const claims = [];
    const pricing = [];
    if (it.primary_url) {
      fetched.push(it.primary_url);
      claims.push({ claim_id: 'c1', text: it.factual_summary || it.headline, claim_type: 'release', status: 'confirmed', evidence_urls: [it.primary_url] });
      claims.push({ claim_id: 'c2', text: `${it.headline}. Rollout details and eligibility are listed on the announcement page.`, claim_type: 'availability', status: 'confirmed', evidence_urls: [it.primary_url] });
      (it.supporting_urls || []).forEach((u) => searched.push(u));
      // A benchmark claim citing a page that was never opened: the code must mark it unverified.
      if (it.story_id.includes('atlas')) claims.push({ claim_id: 'c3', text: 'Atlas 3 tops the Leaderboard X coding benchmark', claim_type: 'benchmark', status: 'confirmed', evidence_urls: ['https://leaderboard.example/x'] });
    }
    const vendor = (it.vendor_domains || [])[0];
    const page = PRICING_PAGES[vendor];
    if (page && (it.kind === 'tool_pricing' || it.story_id.includes('atlas') || it.story_id.includes('litware'))) {
      fetched.push(page.url);
      page.rows.forEach((r) => pricing.push({ ...r, currency: 'USD', free_tier: r.free_tier || null, key_limits: [], source_url: page.url, checked_at: '2020-01-01T00:00:00Z' /* code overwrites */ }));
      claims.push({ claim_id: 'p1', text: `Current pricing for ${page.rows[0].product}`, claim_type: 'pricing', status: 'confirmed', evidence_urls: [page.url] });
    }
    if (it.kind === 'resource' || it.kind === 'event') {
      (it.urls || []).forEach((u) => fetched.push(u));
      claims.push({ claim_id: 'r1', text: it.question, claim_type: it.kind === 'event' ? 'regulation' : 'other', status: 'confirmed', evidence_urls: it.urls || [] });
    }
    return { story_id: it.story_id, verified: true, event_date: it.event_date || null, claims, pricing, limitations: it.story_id.includes('atlas') ? ['Benchmark results are vendor-reported'] : [] };
  });
  return claudeResponse({ generated_at: NOW_ISO(), stories }, { searched, fetched: [...new Set(fetched)] });
}

function plan(user) {
  const research = jsonAfter(user, 'Verified research for the selected top stories:') || [];
  const cands = jsonAfter(user, 'Other candidate stories this week') || [];
  return claudeResponse({
    big5_story_ids: research.filter((s) => s.verified).map((s) => s.story_id).slice(0, 5),
    tool_changes_story_ids: cands.filter((c) => /litware/.test(c.story_id)).map((c) => c.story_id),
    tool_of_week: { product: 'Tailspin Flows', vendor_domain: 'tailspin.example', use_case: 'No-code workflow automation that can call AI agents', pricing_url_hint: 'https://tailspin.example/pricing', source_story_id: null },
    sections: { ai101: 'What MCP is', build_better: 'Structured outputs, examples, small evals', workflow: 'Inbound lead triage', stack: 'Solo consultant stack', roi: 'Claims triage before/after', what_not: 'Pasting customer data into unapproved tools', hype: 'Benchmarks vs open weights', one_thing: 'Add a disclosure line to your chatbot' },
    research_requests: [
      { story_id: 'req-litware-pricing', kind: 'tool_pricing', question: 'Litware Notes Pro pricing', urls: ['https://litware.example/pricing'], vendor_domains: ['litware.example'] },
      { story_id: 'req-resource-structured-outputs', kind: 'resource', question: 'Northwind structured outputs guide explains JSON schema mode', urls: ['https://docs.northwind.example/guides/structured-outputs'] },
      { story_id: 'req-resource-mcp-spec', kind: 'resource', question: 'MCP specification overview page', urls: ['https://mcp.example/spec'] },
      { story_id: 'req-resource-evals-template', kind: 'resource', question: 'Fabrikam open eval template repository', urls: ['https://code.example/fabrikam/eval-template'] },
      { story_id: 'req-watch-dso-effective-date', kind: 'event', question: 'Digital Standards Office disclosure rule takes effect on 2027-01-15', urls: ['https://policy.example/rules/ai-disclosure-2026/timeline'] },
    ],
  });
}

function link(research, id, text) {
  const st = research.find((s) => s.story_id === id);
  const c = st && st.claims.find((x) => x.status === 'confirmed' && x.evidence_urls.length);
  return c ? `[${text}](${c.evidence_urls[0]})` : text;
}
function price(research, id) { const st = research.find((s) => s.story_id === id); return (st?.pricing || []).map((p) => `${p.plan}: ${p.display}`); }
function confirmedIds(research, ids) { return research.filter((s) => ids.includes(s.story_id)).flatMap((s) => s.claims.filter((c) => c.status === 'confirmed' && c.evidence_urls.length).map((c) => c.claim_id)); }

function write(user) {
  const research = jsonAfter(user, 'VERIFIED RESEARCH — the only facts, prices and links you may use:') || [];
  const p = jsonAfter(user, 'Plan:') || {};
  const big5 = p.big5_story_ids || [];
  const take = '[DRAFT TAKE - Mohil to confirm]';
  const stories = big5.map((id) => research.find((s) => s.story_id === id)).filter(Boolean);
  const big5md = stories.map((s, i) => [
    `**${i + 1}. ${s.headline}**`,
    `- What happened: ${s.claims[0].text}`,
    `- Why it matters: it changes what a small team can build or buy this quarter.`,
    `- Who should care: operators and founders evaluating this category.`,
    `- Mohil take: ${take} Worth a test this week if it touches your stack.`,
    `- Sources: ${link(research, s.story_id, 'announcement')}`,
  ].join('\n')).join('\n\n');
  const atlas = price(research, stories.find((s) => /atlas/.test(s.story_id))?.story_id || '');
  const draft = {
    subject_options: ['Atlas 3 cuts API prices, Contoso agents go GA', 'Five AI changes worth your Monday', 'What changed in AI this week (and what it costs)'],
    preview_text: 'Cheaper frontier models, enterprise agents, a disclosure rule, and one workflow to copy.',
    claims_used: confirmedIds(research, [...big5, 'req-tool-of-week', 'req-litware-pricing', 'req-resource-structured-outputs', 'req-resource-mcp-spec', 'req-resource-evals-template', 'req-watch-dso-effective-date', ...(p.tool_changes_story_ids || [])]),
    sections: [
      { id: 'big5', title: 'The 5 Biggest Things in AI', story_ids: big5, markdown: `${big5md}\n\nAtlas 3 is the largest model release of the quarter.` }, // unsupported superlative: round 0 must fail
      { id: 'tool_changes', title: 'What Changed in Tools', story_ids: p.tool_changes_story_ids || [], markdown: (p.tool_changes_story_ids || []).map((id) => `- ${research.find((s) => s.story_id === id)?.headline}. ${price(research, 'req-litware-pricing').join('; ')} ${link(research, id, 'changelog')}`).join('\n') },
      { id: 'tool_of_week', title: 'Tool of the Week', story_ids: [], markdown: [`**Tailspin Flows** is a no-code workflow builder that can now call AI agents through MCP.`, `- Pricing: ${price(research, 'req-tool-of-week').join('; ')}`, `- Who it's for: ops leads automating handoffs between sales, support and finance tools.`, `- Who should skip: teams that already run workflows in code and want version control.`, `- Pros: fast to set up, run history for audits. Cons: per-seat billing adds up for large teams.`, `- Verdict: Watch`].join('\n') },
      { id: 'ai101', title: 'AI 101 -> AI Pro', story_ids: ['req-resource-mcp-spec'], markdown: `**MCP (Model Context Protocol)** is a standard way for an AI assistant to call outside tools and data, like a USB port for software. Instead of custom code for every integration, a tool exposes an MCP server once and any compatible assistant can use it. ${link(research, 'req-resource-mcp-spec', 'Read the spec overview')}` },
      { id: 'build_better', title: 'Build Better', story_ids: [], markdown: `1. **Ask for structured output.** Request JSON that matches a schema so results drop straight into your tools. Failure mode: free text that breaks your parser.\n2. **Show two examples.** One good, one bad. Failure mode: the model guesses your format.\n3. **Run a 20-row eval before shipping.** Score outputs against known answers. Failure mode: a prompt tweak that silently breaks edge cases.` },
      { id: 'workflow', title: 'Workflow of the Week', story_ids: [], markdown: `**Inbound lead triage.** Problem: leads sit unread for a day.\nTools: a form, Tailspin Flows, your CRM.\nSteps: 1) form submission triggers a flow, 2) an AI step classifies intent and size, 3) the flow drafts a reply and assigns an owner.\nCost: Tailspin Team seat (see pricing above). Difficulty: low.\nHuman review: a person approves every drafted reply before it is sent to a prospect.\nPrompt: "Classify this lead as hot, warm or cold using these rules, and return JSON."` },
      { id: 'stack', title: 'AI Stack of the Week', story_ids: [], markdown: `**Solo consultant stack.**\n- Atlas 3 API: ${atlas.join('; ')}\n- Tailspin Flows: ${price(research, 'req-tool-of-week').join('; ')}\n- Litware Notes: ${price(research, 'req-litware-pricing').join('; ')}\nTotal: $41/month (sum of the prices above, plus usage-based API costs).\nCheaper alternative: stay on the Tailspin free plan until you pass 100 runs a month.` },
      { id: 'roi', title: 'AI -> ROI', story_ids: [], markdown: `**Claims triage.** Before: every claim is read in full by an adjuster. After: AI sorts claims by complexity and routes simple ones to a fast lane.\nValue drivers: faster first response, adjuster time moved to complex claims.\nRisks: misrouted complex claims. KPI: share of claims rerouted after triage.\nEstimate: if a team handles 1,000 claims a month and triage saves 6 minutes each, that is 100 hours a month; at $45/hour loaded cost that is $4,500/month (assumptions, not Woodgrove's figures).` },
      { id: 'what_not', title: 'What Not to Do', story_ids: [], markdown: `Don't paste customer records into AI tools your company hasn't approved. Check the data-retention setting first, and use a business plan with training opt-out.` },
      { id: 'hype', title: 'Overhyped / Underhyped', story_ids: [], markdown: `**Overhyped:** vendor-reported benchmark wins. **Underhyped:** permissively licensed open-weights models for teams that can't send data out.` },
      { id: 'resources', title: 'Resources Worth Saving', story_ids: ['req-resource-structured-outputs', 'req-resource-mcp-spec', 'req-resource-evals-template'], markdown: [link(research, 'req-resource-structured-outputs', 'Northwind structured outputs guide'), link(research, 'req-resource-mcp-spec', 'MCP specification overview'), link(research, 'req-resource-evals-template', 'Fabrikam eval template repo')].map((x) => `- ${x}`).join('\n') },
      { id: 'one_thing', title: 'One Thing to Try', story_ids: [], markdown: `Add one line to your website chatbot's greeting telling customers they're talking to an AI assistant, and how to reach a person.` },
      { id: 'watch_next', title: 'What to Watch Next', story_ids: ['req-watch-dso-effective-date'], markdown: `- The disclosure rule's compliance timeline: ${link(research, 'req-watch-dso-effective-date', 'official timeline')}\n- Whether other vendors match Atlas 3's API price cut.\n- Contoso Agents pricing details for smaller teams.` },
    ],
    repeat_angles: { 'req-resource-mcp-spec': 'AI 101 explains the concept; Resources links the spec' },
    word_count: 0,
  };
  draft.word_count = draft.sections.map((s) => s.markdown).join(' ').split(/\s+/).length;
  return claudeResponse(draft);
}

// Expansion pass: adds analysis that restates confirmed research (no new facts, links or prices).
function expand(user) {
  const draft = jsonAfter(user, 'Current draft:');
  if (fakeState.expandInsufficient) return claudeResponse({ ...draft, expansion_note: 'Research packet supports no further material; left unchanged.' });
  const research = jsonAfter(user, 'VERIFIED RESEARCH — the only facts, prices and links you may use:') || [];
  const add = {
    big5: research.filter((s) => (draft.sections.find((x) => x.id === 'big5')?.story_ids || []).includes(s.story_id)).map((s) =>
      `**What to do with "${s.headline}":** ${s.claims.filter((c) => c.status === 'confirmed').map((c) => c.text).join(' ')} The practical question for an operator is whether this changes a decision you are making this quarter: what you build, what you buy, or what you tell customers. If it does, give one person the job of reading the source this week and writing a short note on what it means for your team, what it would cost to try, and what would make you stop. If it does not, file it and move on. ${(s.limitations || []).length ? `Keep in mind: ${s.limitations.join('; ')}.` : 'Rollout details and eligibility can differ by plan, so check the announcement before you commit time to it.'}`).join('\n\n'),
    build_better: 'Why these three matter together: structured output makes results usable by other tools, examples make the format predictable, and a small eval tells you when a change breaks something. Teams that skip the eval step usually find out about regressions from a customer instead of from a test. Start with twenty real inputs from last month, write down the answer you expected for each, and rerun them every time you change the prompt, the model or the settings. Keep the file next to the prompt so whoever edits one sees the other.',
    workflow: 'How to roll it out: run the flow in shadow mode for a week first, where the AI classifies and drafts but a person still handles every lead the old way, then compare the two. Track how often the person changed the classification or rewrote the reply. If edits are rare on cold and warm leads, let those drafts go out after a quick approval and keep hot leads fully manual. Write the classification rules down in plain language before you build anything; the prompt is only as good as the rules you give it.',
    roi: 'How to check the estimate against your own numbers: time ten claims by hand before the pilot and ten after, and use your own loaded hourly cost rather than the placeholder above. The value only shows up if the saved time moves to work that matters, so decide in advance where adjuster hours will go. The biggest risk is a complex claim routed to the fast lane, so sample fast-lane decisions every week and track the reroute rate as the main KPI.',
    ai101: 'Why it matters to non-engineers: once a tool your team already uses exposes an MCP server, an assistant can read from it or act in it without a custom integration project. That moves the conversation from "can we connect this?" to "should the assistant be allowed to do this?", which is a permissions and review question your operations lead can answer.',
    what_not: 'A simple rule that covers most cases: if you would not email the data to an outside contractor without a contract, do not paste it into an AI tool without the same review. Ask your vendor where data is stored, how long it is kept and whether it is used for training, and write the answers down where your team can find them.',
    hype: 'The reason this matters: a vendor-run benchmark measures the task the vendor chose, under settings the vendor picked. Your own twenty-row eval on your own inputs is a better buying signal than any leaderboard, and it takes an afternoon to build.',
    one_thing: 'It takes five minutes, it helps you meet the disclosure rule covered above, and it sets the right expectations with customers, who are less frustrated by an assistant that says what it is.',
  };
  draft.sections = draft.sections.map((sec) => (add[sec.id] ? { ...sec, markdown: `${sec.markdown}\n\n${add[sec.id]}` } : sec));
  draft.word_count = draft.sections.map((x) => x.markdown).join(' ').split(/\s+/).length;
  return claudeResponse(draft);
}

function revise(user) {
  const draft = jsonAfter(user, 'Current draft:');
  if (fakeState.reviseNoop) return claudeResponse(draft);
  draft.sections = draft.sections.map((s) => ({ ...s, markdown: s.markdown.split('\n').filter((l) => !/largest/i.test(l)).join('\n').trim() }));
  return claudeResponse(draft);
}

function factCheck(user) {
  const draft = jsonAfter(user, 'Draft to check:') || [];
  const all = draft.map((s) => s.markdown).join('\n');
  const items = [{ claim: 'Atlas 3 API prices as listed', section_id: 'big5', status: 'PASS', evidence_url: 'https://northwind.example/pricing', correction: null, severity: 'high' },
    { claim: 'Tailspin Flows Team pricing as listed', section_id: 'tool_of_week', status: 'PASS', evidence_url: 'https://tailspin.example/pricing', correction: null, severity: 'high' }];
  if (/largest/i.test(all)) items.push({ claim: 'Atlas 3 is the largest model release of the quarter', section_id: 'big5', status: 'NEEDS_SOURCE', evidence_url: null, correction: 'remove', severity: 'high' });
  return claudeResponse({ verdict: 'PASS' /* code recomputes */, items }, { fetched: ['https://northwind.example/pricing'] });
}

// Server-sent-event version of a Message, cut into small chunks to exercise the stream parser.
function streamResp(msg, { truncated = false } = {}) {
  const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  let out = ev({ type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: msg.usage.input_tokens, output_tokens: 1 } } });
  msg.content.forEach((b, i) => {
    if (b.type === 'text') {
      out += ev({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
      const half = Math.floor(b.text.length / 2);
      for (const part of [b.text.slice(0, half), b.text.slice(half)]) out += ev({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: part } });
    } else out += ev({ type: 'content_block_start', index: i, content_block: b });
    out += ev({ type: 'content_block_stop', index: i });
  });
  if (!truncated) out += ev({ type: 'message_delta', delta: { stop_reason: msg.stop_reason }, usage: { output_tokens: msg.usage.output_tokens } }) + ev({ type: 'message_stop' });
  else out = out.slice(0, Math.floor(out.length * 0.8));
  const bytes = new TextEncoder().encode(out);
  const body = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 97) c.enqueue(bytes.slice(i, i + 97)); c.close(); } });
  return { status: 200, ok: true, headers: { get: () => null }, body, json: async () => { throw new Error('streamed'); }, text: async () => out };
}

function writerFault(r) {
  if (!fakeState.writerFault) return r;
  const msg = { ...r };
  if (fakeState.writerFault === 'max_tokens') { msg.stop_reason = 'max_tokens'; msg.content = [{ type: 'text', text: msg.content.at(-1).text.slice(0, 300) }]; }
  return msg;
}

function claudeRoute(body, resp) {
    const sys = body.system || '';
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    const user = typeof lastUser.content === 'string' ? lastUser.content : '';
    if (body.messages.at(-1).role === 'assistant') return resp(200, research(body.messages[0].content)); // resumed pause_turn
    if (/research scout/.test(sys)) return resp(200, scout());
    if (/skeptical AI research analyst/.test(sys)) {
      if (researchCalls === 0) { researchCalls++; return resp(200, claudeResponse(null, { pause: true, fetched: [] })); } // exercise pause_turn
      return resp(200, research(user));
    }
    if (/final red-team editor/.test(sys)) return resp(200, factCheck(user));
    if (/editor of AI Operator Weekly/.test(sys)) {
      if (/You are PLANNING/.test(user)) return resp(200, plan(user));
      if (/Revise this draft/.test(user)) return resp(200, revise(user));
      if (/Expand this draft/.test(user)) return resp(200, expand(user));
      return resp(200, write(user));
    }
    return resp(400, { error: 'mock: unrecognised agent' });
}

// ---------- fetch router ----------
async function fakeFetch(url, opts = {}) {
  const u = String(url);
  fakeState.calls.push({ url: u, method: opts.method || 'GET' });
  const resp = (status, body, headers = {}) => ({
    status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  if (FEEDS[u]) return resp(200, FEEDS[u]);
  if (u.startsWith('https://digest.example')) return resp(500, 'error');
  if (u.startsWith('https://hooks.slack.com') || u.startsWith('https://slack.example')) return resp(200, 'ok');

  if (u.endsWith('/v1/messages')) {
    const body = JSON.parse(opts.body);
    const r = claudeRoute(body, resp);
    if (!body.stream || r.status !== 200) return r;
    const msg = await r.json();
    const isWriter = /editor of AI Operator Weekly/.test(body.system || '') && !/You are PLANNING/.test(JSON.stringify(body.messages.at(-1)));
    return streamResp(isWriter ? writerFault(msg) : msg, { truncated: isWriter && fakeState.writerFault === 'truncated' });
  }


  const bh = u.match(/^https:\/\/api\.beehiiv\.com\/v2\/publications\/(pub_[\w-]+)\/posts(?:\/(post_[\w-]+))?(\?.*)?$/);
  if (bh) {
    if (fakeState.failBeehiiv) return resp(401, { errors: [{ message: 'Invalid API key' }] });
    if ((opts.method || 'GET') === 'POST') {
      const body = JSON.parse(opts.body);
      const n = Object.keys(fakeState.posts).length;
      const id = `post_00000000-0000-0000-0000-0000000${String(0xaaaa + n).padStart(5, '0')}`;
      fakeState.posts[id] = { status: body.status, body, pending: !!fakeState.beehiivPending };
      if (fakeState.beehiivPostDropsConnection) throw new Error('socket hang up');
      return resp(201, { data: { id, preview_url: `https://app.beehiiv.com/posts/${id}/preview` } });
    }
    const post = fakeState.posts[bh[2]];
    if (!post) return resp(404, { errors: [{ code: 'POST_CREATION_FAILED' }] });
    if (post.pending) return resp(202, { data: { id: bh[2] } }, { 'retry-after': '0' });
    if (!fakeState.sent) return resp(200, { data: { id: bh[2], status: 'draft' } });
    return resp(200, { data: { id: bh[2], status: 'confirmed', publish_date: Math.floor(fakeState.now.getTime() / 1000) - 86400,
      stats: { email: { recipients: 1200, delivered: 1190, opens: 700, unique_opens: 610, open_rate: 51.3, clicks: 180, unique_clicks: 140, click_rate: 11.8, unsubscribes: 3 },
        clicks: [{ url: 'https://docs.northwind.example/guides/structured-outputs?utm_source=aow', base_url: 'https://docs.northwind.example/guides/structured-outputs', total_clicks: 70, total_unique_clicks: 60 }, { url: 'https://northwind.example/news/atlas-3', base_url: 'https://northwind.example/news/atlas-3', total_clicks: 50, total_unique_clicks: 45 }] } } });
  }
  return resp(404, `mock: no route for ${u}`);
}

module.exports = { fakeFetch, fakeState, MOCK_SOURCES, jsonAfter, streamResp, claudeResponse, resetMock: () => { researchCalls = 0; Object.assign(fakeState, { calls: [], sent: false, failBeehiiv: false, posts: {}, writerFault: null, expandInsufficient: false, reviseNoop: false, beehiivPending: false, beehiivPostDropsConnection: false }); } };
