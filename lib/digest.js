// The free weekly issue: builds a newsletter draft from the articles `collect` already saved, with no AI
// and no paid calls. Ranking is plain arithmetic on facts the feeds give us: source tier, recency, how many
// outlets ran the same story, and a few business keywords. Anything that needs judgement (takes, the Tool of
// the Week verdict, the workflow) is left as a clearly marked box for the editor, never invented.
// Pure functions: articles in, Markdown out. Weights and word lists can be overridden in config/digest.json.

const STOP = new Set('a an and are as at be by for from has have how in into is it its new of on or our that the their this to with you your we will what why can now more than out up via about after over says said its it’s just'.split(' '));
const words = (t) => (t || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

const DEFAULTS = {
  window_days: 7,
  top_stories: 5,
  max_per_category: 2,
  per_section: 4,
  excerpt_words: 35,
  same_story_shared_words: 2,
  max_per_source: 1,
  weights: { tier1: 3, tier2: 2, recency_per_day: 0.25, coverage: 1.5, keyword: 0.75, has_excerpt: 0.5, demote: -4 },
  // Posts about these are rarely useful to an operator: pushed down and kept out of the issue's sections.
  demote_terms: ['game', 'games', 'gaming', 'geforce', 'dlss', 'xbox', 'playstation', 'esports', 'movie', 'trailer', 'sweepstakes', 'gift guide', 'murder', 'lawsuit',
    // recurring marketing series, roundups and videos: rarely the week's news
    'into the omniverse', 'nvidia life', 'nvidia-life', 'we announced in', 'roundup', 'recap', 'webinar', 'podcast', '/video/', '/podcast/'],
  keywords: ['launch', 'launches', 'launching', 'release', 'released', 'releases', 'pricing', 'price', 'agent', 'agents', 'enterprise', 'api', 'funding', 'raises', 'acquires', 'acquisition', 'regulation', 'open source', 'generally available', 'copilot', 'cheaper', 'available'],
  sections: [
    { id: 'tool_changes', title: 'What Changed in Tools', match: { categories: ['tools'] } },
    { id: 'pricing', title: 'Pricing and Plans', match: { title_terms: ['pricing', 'price', 'prices', 'price cut', 'cheaper', 'free tier', 'per token', 'per seat', 'subscription', 'discount', 'cuts pricing'] } },
    { id: 'models', title: 'Models and Research', match: { categories: ['frontier_models', 'open_source', 'infrastructure'] } },
    { id: 'business', title: 'Business, Funding and Rules', match: { categories: ['business', 'enterprise', 'regulation'] } },
  ],
};

const AI = /\b(ai|a\.i\.|artificial intelligence|machine learning|llms?|gpt[\w.-]*|copilot|agents?|agentic|neural|generative|genai|chatbots?|claude|gemini|openai|anthropic|inference|models?|codex|reasoning|automation)\b/i;
const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match; a term that starts or ends with punctuation ("/video/") matches as written.
const has = (text, terms) => terms.some((k) => new RegExp(`${/^\p{L}/u.test(k) ? '(^|[^\\p{L}])' : ''}${esc(k)}${/\p{L}$/u.test(k) ? '($|[^\\p{L}])' : ''}`, 'iu').test(text));
const days = (a, b) => (new Date(a) - new Date(b)) / 86400000;

// Publisher text with feed boilerplate removed ("The post … appeared first on …", Hacker News link dumps).
function cleanExcerpt(s) {
  const t = (s || '').replace(/\s+/g, ' ').replace(/\s*The post .*$/i, '').replace(/\s*(Continue reading|Read more)\b.*$/i, '').trim();
  return /^(Article URL:|Comments URL:|https?:\/\/)/i.test(t) ? '' : t;
}

// Group headlines about the same story (union-find, deterministic). Two headlines match when they share at least
// `minShared` DISTINCTIVE words: words that appear in only a few of the week's titles ("airbnb", "omni"), not
// everyday ones ("open", "models", "agents") that would link unrelated posts.
function clusters(articles, minShared) {
  const sets = articles.map((a) => new Set(words(a.title)));
  const df = new Map();
  for (const set of sets) for (const w of set) df.set(w, (df.get(w) || 0) + 1);
  const rare = Math.max(3, Math.ceil(articles.length * 0.03));
  const distinct = sets.map((set) => new Set([...set].filter((w) => df.get(w) <= rare)));
  const parent = articles.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      let n = 0;
      for (const w of distinct[i]) if (distinct[j].has(w)) n++;
      if (n >= minShared) parent[find(i)] = find(j);
    }
  }
  return articles.map((_, i) => find(i));
}

function score(a, cov, { now, weights: w, keywords, demote }) {
  const text = `${a.title} ${a.feed_excerpt || ''}`;
  const where = `${text} ${a.url || ''}`;
  const hits = keywords.filter((k) => has(text, [k])).length;
  const age = a.published_at ? Math.max(0, days(now, a.published_at)) : 7;
  const parts = {
    tier: a.source_tier === 1 ? w.tier1 : a.source_tier === 2 ? w.tier2 : 0,
    recency: Math.round(Math.max(0, 7 - age) * w.recency_per_day * 100) / 100,
    coverage: Math.min(cov, 3) * w.coverage,
    keywords: Math.min(hits, 3) * w.keyword,
    excerpt: cleanExcerpt(a.feed_excerpt) ? w.has_excerpt : 0,
    demote: has(where, demote) ? w.demote : 0,
  };
  return { total: Math.round(Object.values(parts).reduce((x, y) => x + y, 0) * 100) / 100, parts, about_ai: AI.test(text), demoted: parts.demote < 0 };
}

// Articles eligible for this issue: collected (not duplicates), on-topic, published in the window ending on issueDate.
function eligible(articles, { issueDate, windowDays }) {
  const end = new Date(`${issueDate}T23:59:59Z`);
  const start = new Date(end.getTime() - windowDays * 86400000);
  return articles.filter((a) => a.status === 'collected' && a.topic_check !== 'off_topic_flagged' && a.published_at
    && new Date(a.published_at) >= start && new Date(a.published_at) <= end);
}

// One entry per story: the best-placed article leads, the other outlets are listed under "also".
function stories(articles, opts) {
  const root = clusters(articles, opts.minShared);
  const groups = new Map();
  articles.forEach((a, i) => { if (!groups.has(root[i])) groups.set(root[i], []); groups.get(root[i]).push(a); });
  const out = [];
  for (const g of groups.values()) {
    // Other outlets that ran it: news/primary sources count 1, newsletters and forums count half.
    const bySource = new Map(g.map((a) => [a.source, a.source_tier]));
    const lead0 = g.reduce((b, a) => (a.source_tier < b.source_tier ? a : b));
    const cov = [...bySource].filter(([src]) => src !== lead0.source).reduce((n, [, tier]) => n + (tier <= 2 ? 1 : 0.5), 0);
    const scored = g.map((a) => ({ ...a, digest: score(a, cov, opts) }))
      .sort((x, y) => Number(!!y.editorial_candidate) - Number(!!x.editorial_candidate) || y.digest.total - x.digest.total);
    const [lead, ...rest] = scored;
    const seen = new Set([lead.source]);
    lead.also = rest.filter((a) => !seen.has(a.source) && seen.add(a.source)).map((a) => ({ source: a.source, url: a.url }));
    lead.digest.coverage = cov;
    out.push(lead);
  }
  return out.sort((x, y) => y.digest.total - x.digest.total || String(y.published_at).localeCompare(String(x.published_at)));
}

function matches(a, m) {
  if (m.categories && m.categories.includes(a.source_category)) return true;
  if (m.title_terms && has(a.title, m.title_terms)) return true;
  return !!(m.terms && has(`${a.title} ${a.feed_excerpt || ''}`, m.terms));
}

function build(articles, { issueDate, now = new Date(`${issueDate}T12:00:00Z`), config = {} } = {}) {
  const c = { ...DEFAULTS, ...config, weights: { ...DEFAULTS.weights, ...(config.weights || {}) } };
  const pool = stories(eligible(articles, { issueDate, windowDays: c.window_days }),
    { now, weights: c.weights, keywords: c.keywords, demote: c.demote_terms, minShared: c.same_story_shared_words });
  const usable = pool.filter((a) => a.digest.about_ai && !a.digest.demoted);
  const candidates = usable.filter((a) => a.editorial_candidate);
  const signals = usable.filter((a) => !a.editorial_candidate);

  // Top stories: highest score, at most N per category so the issue isn't five changelog items.
  const top = [], perCat = {}, perSrc = {};
  for (const a of candidates) {
    if (top.length === c.top_stories) break;
    const k = a.source_category || 'other';
    if ((perCat[k] || 0) >= c.max_per_category || (perSrc[a.source] || 0) >= c.max_per_source) continue;
    top.push(a); perCat[k] = (perCat[k] || 0) + 1; perSrc[a.source] = (perSrc[a.source] || 0) + 1;
  }
  const used = new Set(top.map((a) => a.article_id));
  const sections = c.sections.map((s) => {
    const items = candidates.filter((a) => !used.has(a.article_id) && matches(a, s.match)).slice(0, c.per_section);
    items.forEach((a) => used.add(a.article_id));
    return { ...s, items };
  });
  const community = signals.slice(0, 4);
  return { issueDate, top, sections, community, counts: { eligible: pool.length, stories: pool.length, candidates: candidates.length, signals: signals.length, left_out_off_topic: pool.length - usable.length }, config: c };
}

const trim = (s, n) => { const w = cleanExcerpt(s).split(' ').filter(Boolean); return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' '); };
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
// The renderer only understands **bold**, *italic*, `code` and [text](url), so drop those characters from feed text.
const plain = (s) => (s || '').replace(/[*`]/g, '').replace(/\[/g, '(').replace(/\]/g, ')');
const also = (a) => (a.also.length ? ` · also: ${a.also.map((o) => `[${plain(o.source)}](${o.url})`).join(', ')}` : '');

const item = (a, n) => {
  const ex = trim(a.feed_excerpt, n);
  return [`- **[${plain(a.title)}](${a.url})**`, `  - ${a.source} · ${fmtDate(a.published_at)}${also(a)}`, ...(ex ? [`  - From the publisher: “${plain(ex)}”`] : [])].join('\n');
};

function toMarkdown(d, { name = 'AI Operator Weekly', owner = 'Mohil' } = {}) {
  const n = d.config.excerpt_words;
  const date = new Date(`${d.issueDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const take = `[DRAFT TAKE - ${owner} to confirm]`;
  const out = [
    `# ${name}`,
    `*Week ending ${date}*`,
    '',
    '> **EDITOR REVIEW REQUIRED — delete this box before sending.**',
    '> This is the free draft: the stories were picked and ordered automatically from the news feeds, with no AI.',
    `> 1. Read each top story and replace every **${take}** line with a sentence or two of your own.`,
    '> 2. Fill in Tool of the Week, Workflow of the Week and One Thing to Try, or delete them.',
    '> 3. Quotes are the publisher\'s own words and unchecked. Open the link before repeating a claim.',
    '> Want the fully written issue instead? In Claude Code, run `/write-issue` (uses your Claude plan, not API credits).',
    '',
    '## The 5 Biggest Things in AI This Week',
  ];
  if (!d.top.length) out.push('', '*No stories in the feeds for this week. Check that the daily collection ran.*');
  d.top.forEach((a, i) => {
    out.push('', `### ${i + 1}. ${plain(a.title)}`, `${a.source} · ${fmtDate(a.published_at)}${also(a)}`);
    const ex = trim(a.feed_excerpt, n);
    if (ex) out.push('', `From the publisher: “${plain(ex)}”`);
    out.push('', `**Why it matters:** ${take}`, '', `[Read it at ${a.source}](${a.url})`);
  });
  for (const s of d.sections) if (s.items.length) out.push('', `## ${s.title}`, '', ...s.items.map((a) => item(a, 25)));
  out.push('', '## Tool of the Week', '', `${take} Pick one tool from above, check its pricing page today, and give a verdict: Use, Watch or Skip.`);
  out.push('', '## Workflow of the Week', '', `${take} One problem, the tools, 3–5 steps, the cost, and where a person reviews the output.`);
  if (d.community.length) out.push('', '## Chatter Worth Watching', '*From newsletters and forums. Unverified: trace it to the original before relying on it.*', '', ...d.community.map((a) => item(a, 20)));
  out.push('', '## One Thing to Try', '', take, '', '---', '', `*${name} is put together from public news sources and reviewed by ${owner} before it's sent.*`);
  return `${out.join('\n')}\n`;
}

function sourcesMarkdown(d) {
  const all = [...d.top, ...d.sections.flatMap((s) => s.items), ...d.community];
  return [`# Sources: issue ${d.issueDate}`, '', `${d.counts.stories} stories in the window (${d.counts.candidates} from tier 1–2 sources; ${d.counts.left_out_off_topic} left out as off-topic).`, '',
    '| # | Score | Source | Published | Title | Also covered by |', '|---|---|---|---|---|---|',
    ...all.map((a, i) => `| ${i + 1} | ${a.digest.total} | ${a.source} (tier ${a.source_tier}) | ${a.published_at.slice(0, 10)} | [${plain(a.title).replace(/\|/g, '/')}](${a.url}) | ${a.also.map((o) => o.source).join(', ') || '–'} |`),
    '', 'Score = source tier + recency + other outlets running the story + business keywords. Weights: `lib/digest.js` DEFAULTS, override in `config/digest.json`.', ''].join('\n');
}

module.exports = { build, toMarkdown, sourcesMarkdown, stories, eligible, clusters, cleanExcerpt, DEFAULTS };
