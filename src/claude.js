// Claude Messages API client with server-side web search / web fetch.
// - Resumes `pause_turn` responses (long-running server tools); running out of continuations is an error
// - Retries 429 / 5xx / 529 with backoff, honouring retry-after
// - Budget: checks the cap before EVERY HTTP request and records every completed one (first request,
//   each pause_turn continuation, each JSON repair), so budget.calls equals requests actually sent
// - Streams calls that use no tools (planning, writing, revising, repairs) so long outputs can use a
//   large max_tokens without hitting HTTP timeouts; a stream that ends early is an error, never text
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

function usageOf(u = {}) {
  return {
    input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    output_tokens: u.output_tokens || 0,
    searches: u.server_tool_use?.web_search_requests || 0,
    fetches: u.server_tool_use?.web_fetch_requests || 0,
  };
}

// Rebuilds a Message object from a server-sent-event stream. Throws (with whatever usage was seen
// attached as err.usage) if the stream errors or ends before message_stop.
async function readStream(res, idleMs) {
  const msg = { content: [], stop_reason: null, stop_details: null, usage: {} };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', complete = false;
  const fail = (m) => Object.assign(new Error(m), { usage: msg.usage });
  const handle = (ev) => {
    if (ev.type === 'message_start') { Object.assign(msg.usage, ev.message?.usage || {}); msg.model = ev.message?.model; }
    else if (ev.type === 'content_block_start') msg.content[ev.index] = { ...ev.content_block };
    else if (ev.type === 'content_block_delta') {
      const b = msg.content[ev.index], d = ev.delta || {};
      if (!b) return;
      if (d.type === 'text_delta') b.text = (b.text || '') + d.text;
      else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
      else if (d.type === 'signature_delta') b.signature = d.signature;
      else if (d.type === 'input_json_delta') b._json = (b._json || '') + d.partial_json;
      else if (d.type === 'citations_delta') (b.citations ||= []).push(d.citation);
    } else if (ev.type === 'content_block_stop') {
      const b = msg.content[ev.index];
      if (b && b._json !== undefined) { b.input = b._json ? JSON.parse(b._json) : {}; delete b._json; }
    } else if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) msg.stop_reason = ev.delta.stop_reason;
      if (ev.delta?.stop_details) msg.stop_details = ev.delta.stop_details;
      Object.assign(msg.usage, ev.usage || {});
    } else if (ev.type === 'message_stop') complete = true;
    else if (ev.type === 'error') throw fail(`Claude API stream error: ${ev.error?.type || 'error'}: ${ev.error?.message || ''}`);
  };
  for (;;) {
    let idle;
    const chunk = await Promise.race([reader.read(), new Promise((_, rej) => { idle = setTimeout(() => rej(fail(`Claude API stream stalled for ${idleMs / 1000}s`)), idleMs); })])
      .finally(() => clearTimeout(idle));
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (data) handle(JSON.parse(data));
    }
  }
  if (!complete) throw fail('Claude API stream ended before message_stop (incomplete response)');
  msg.content = msg.content.filter(Boolean);
  return msg;
}

async function post(cfg, fetchImpl, body) {
  const lim = cfg.runtime.limits;
  const timeoutMs = body.stream ? lim.stream_timeout_ms : lim.request_timeout_ms;
  const headers = { 'x-api-key': cfg.anthropic.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (body.fallbacks) headers['anthropic-beta'] = FALLBACK_BETA;
  let lastErr;
  for (let attempt = 0; attempt <= lim.retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${cfg.anthropic.baseUrl}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) { // network error or timeout before a response: nothing was generated, retry
      clearTimeout(timer);
      lastErr = new Error(`Claude API request failed: ${e.message}`);
      if (attempt < lim.retries) await sleep(cfg.runtime.retry_base_ms * 2 ** attempt);
      continue;
    }
    if (res.status === 200) {
      // Once generation has started, a failure is NOT retried: the caller records the partial usage and stops.
      try { return body.stream ? await readStream(res, lim.stream_idle_timeout_ms) : await res.json(); }
      finally { clearTimeout(timer); }
    }
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    lastErr = new Error(`Claude API ${res.status}: ${text.slice(0, 500)}`);
    if (!RETRY.has(res.status)) throw lastErr;
    const ra = Number(res.headers?.get?.('retry-after'));
    if (attempt < lim.retries) await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : cfg.runtime.retry_base_ms * 2 ** attempt);
  }
  throw lastErr;
}

// One logical agent call (one or more HTTP requests). Returns { text, retrieved, usage, stop_reason }.
async function callClaude({ cfg, fetchImpl, budget, step, model, system, messages, tools = [], maxTokens, effort }) {
  if (!cfg.anthropic.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const lim = cfg.runtime.limits;
  const stream = tools.length === 0;
  const maxSearches = tools.find((t) => t.name === 'web_search')?.max_uses || 0;
  const convo = [...messages];
  const retrieved = [];
  const usage = { input_tokens: 0, output_tokens: 0, searches: 0, fetches: 0 };
  let finalText = '';
  let stop = null;
  let stopDetails = null;

  for (let turn = 0; turn <= lim.max_pause_turns; turn++) {
    const label = turn === 0 ? step : `${step}:continue${turn}`;
    // Pre-flight: prompt size (~4 chars/token), a modest output, and the remaining search allowance.
    budget.check({ model, input_tokens: Math.ceil(JSON.stringify({ system, convo }).length / 4), output_tokens: 2000, searches: Math.max(0, maxSearches - usage.searches) });
    const body = { model, max_tokens: maxTokens || (stream ? lim.stream_max_output_tokens : lim.max_output_tokens), system, messages: convo };
    if (tools.length) body.tools = tools;
    if (stream) body.stream = true;
    if (effort) body.output_config = { effort };
    if (cfg.runtime.refusal_fallback) body.fallbacks = cfg.runtime.refusal_fallback;
    let res;
    try { res = await post(cfg, fetchImpl, body); }
    catch (e) { if (e.usage) budget.record(`${label}:incomplete`, { model, ...usageOf(e.usage) }); throw new Error(`${label}: ${e.message}`); }
    const u = usageOf(res.usage);
    budget.record(label, { model, ...u });
    for (const k of Object.keys(usage)) usage[k] += u[k];
    collectRetrieved(res.content, retrieved);
    finalText = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    stop = res.stop_reason;
    stopDetails = res.stop_details || null;
    if (stop !== 'pause_turn') break;
    convo.push({ role: 'assistant', content: res.content });
  }

  if (stop === 'pause_turn') throw new Error(`${step}: still paused after ${lim.max_pause_turns} continuations; the answer is incomplete. Raise limits.max_pause_turns or reduce the batch size.`);
  if (stop === 'refusal') throw new Error(`${step}: Claude declined the request (${stopDetails?.category || 'no category'}); fallback model also declined or is off. Re-run, or do this step by hand with prompts/.`);
  if (stop === 'max_tokens') throw new Error(`${step}: response hit max_tokens, so the output is incomplete and was discarded; raise the output limit in config/runtime.json or shrink the batch`);
  if (stop !== 'end_turn' && stop !== 'stop_sequence') throw new Error(`${step}: unexpected stop_reason "${stop}"; output discarded`);
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
  try { parsed = extractJson(repair.text); }
  catch (e) { throw new Error(`${opts.step}: output still not valid JSON after repair (${e.message}); nothing downstream was run`); }
  const v = validate(schema, parsed);
  if (!v.valid) throw new Error(`${opts.step}: output still invalid after repair: ${v.errors.slice(0, 5).join('; ')}`);
  return { data: parsed, retrieved: first.retrieved, usage: first.usage };
}

module.exports = { callClaude, askJson, extractJson, toolDefs };
