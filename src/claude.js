// Claude Messages API client with server-side web search / web fetch.
// - Resumes `pause_turn` responses (long-running server tools)
// - Retries 429 / 5xx / 529 with backoff, honouring retry-after
// - Records the cost of every request in the run Budget
// - Sets effort per agent; opts into server-side refusal fallback; fails loudly on a final refusal
// - Returns every URL Claude actually retrieved (search results + fetched pages, with retrieved_at)
//   so downstream code can reject evidence URLs that were never opened.

const { validate } = require('./validate');

const RETRY = new Set([408, 429, 500, 502, 503, 504, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toolDefs(cfg, { search = 0, fetch = 0, allowedDomains } = {}) {
  const t = [];
  if (search > 0) t.push({ ...cfg.runtime.tools.web_search, max_uses: search });
  if (fetch > 0) {
    const f = { ...cfg.runtime.tools.web_fetch, max_uses: fetch };
    if (allowedDomains && allowedDomains.length) f.allowed_domains = allowedDomains;
    t.push(f);
  }
  return t;
}

function collectRetrieved(content, into) {
  for (const b of content || []) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) into.push({ url: r.url, kind: 'search', title: r.title, page_age: r.page_age || null });
    }
    if (b.type === 'web_fetch_tool_result' && b.content && b.content.type === 'web_fetch_result') {
      into.push({ url: b.content.url, kind: 'fetch', retrieved_at: b.content.retrieved_at || new Date().toISOString() });
    }
  }
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

async function post(cfg, fetchImpl, body) {
  const { retries, request_timeout_ms } = cfg.runtime.limits;
  const headers = { 'x-api-key': cfg.anthropic.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (body.fallbacks) headers['anthropic-beta'] = FALLBACK_BETA;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), request_timeout_ms);
    let res;
    try {
      res = await fetchImpl(`${cfg.anthropic.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) { // network error or timeout: retry
      clearTimeout(timer);
      lastErr = new Error(`Claude API request failed: ${e.message}`);
      if (attempt < retries) await sleep(cfg.runtime.retry_base_ms * 2 ** attempt);
      continue;
    }
    clearTimeout(timer);
    if (res.status === 200) return res.json();
    const text = await res.text().catch(() => '');
    lastErr = new Error(`Claude API ${res.status}: ${text.slice(0, 500)}`);
    if (!RETRY.has(res.status)) throw lastErr;
    const ra = Number(res.headers?.get?.('retry-after'));
    if (attempt < retries) await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : cfg.runtime.retry_base_ms * 2 ** attempt);
  }
  throw lastErr;
}

// One logical agent call. Returns { text, retrieved, usage, stop_reason }.
async function callClaude({ cfg, fetchImpl, budget, step, model, system, messages, tools = [], maxTokens, effort }) {
  if (!cfg.anthropic.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  // Pre-flight estimate: prompt size (~4 chars/token), a modest output, and the full search allowance.
  const maxSearches = tools.find((t) => t.name === 'web_search')?.max_uses || 0;
  budget.check({ model, input_tokens: Math.ceil(JSON.stringify({ system, messages }).length / 4), output_tokens: 2000, searches: maxSearches });
  const convo = [...messages];
  const retrieved = [];
  const usage = { input_tokens: 0, output_tokens: 0, searches: 0, fetches: 0 };
  let finalText = '';
  let stop = null;
  let stopDetails = null;

  for (let turn = 0; turn <= cfg.runtime.limits.max_pause_turns; turn++) {
    if (turn > 0) budget.check({ model, ...usage }); // a resumed turn is another paid request
    const body = { model, max_tokens: maxTokens || cfg.runtime.limits.max_output_tokens, system, messages: convo };
    if (tools.length) body.tools = tools;
    if (effort) body.output_config = { effort };
    if (cfg.runtime.refusal_fallback) body.fallbacks = cfg.runtime.refusal_fallback;
    const res = await post(cfg, fetchImpl, body);
    const u = res.usage || {};
    usage.input_tokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    usage.output_tokens += u.output_tokens || 0;
    usage.searches += u.server_tool_use?.web_search_requests || 0;
    usage.fetches += u.server_tool_use?.web_fetch_requests || 0;
    collectRetrieved(res.content, retrieved);
    finalText = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    stop = res.stop_reason;
    stopDetails = res.stop_details || null;
    if (stop !== 'pause_turn') break;
    convo.push({ role: 'assistant', content: res.content });
  }

  budget.record(step, { model, ...usage });
  if (stop === 'refusal') throw new Error(`${step}: Claude declined the request (${stopDetails?.category || 'no category'}); fallback model also declined or is off. Re-run, or do this step by hand with prompts/.`);
  if (stop === 'max_tokens') throw new Error(`${step}: response hit max_tokens; raise limits.max_output_tokens or shrink the batch`);
  return { text: finalText, retrieved, usage, stop_reason: stop };
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}

// Agent call that must return JSON matching a schema. On a parse or schema failure it asks once
// for a corrected object (no tools, so the repair is cheap).
async function askJson({ schema, user, ...opts }) {
  const messages = [{ role: 'user', content: user }];
  const first = await callClaude({ ...opts, messages });
  let parsed, errors;
  try {
    parsed = extractJson(first.text);
    ({ errors } = validate(schema, parsed));
  } catch (e) { errors = [`not valid JSON: ${e.message}`]; }
  if (!errors.length) return { data: parsed, retrieved: first.retrieved, usage: first.usage };

  const repair = await callClaude({
    ...opts, tools: [], step: `${opts.step}:repair`,
    messages: [...messages, { role: 'assistant', content: first.text || '(empty)' },
      { role: 'user', content: `Your output failed validation:\n- ${errors.slice(0, 30).join('\n- ')}\n\nReturn ONLY the corrected JSON object. Do not add facts that were not in your previous answer.` }],
  });
  parsed = extractJson(repair.text);
  const v = validate(schema, parsed);
  if (!v.valid) throw new Error(`${opts.step}: output still invalid after repair: ${v.errors.slice(0, 5).join('; ')}`);
  return { data: parsed, retrieved: first.retrieved, usage: first.usage };
}

module.exports = { callClaude, askJson, extractJson, toolDefs };
