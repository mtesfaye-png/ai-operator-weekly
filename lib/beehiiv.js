// Draft-only beehiiv client (brief §10). This module CANNOT publish:
//  - payload status is hard-coded to "draft" and re-asserted before every request
//  - scheduled_at / override_scheduled_at / recipients are stripped
//  - only two endpoints are allowed: POST /posts (create) and GET /posts/:id (poll)
// API facts verified 2026-10-18 at developers.beehiiv.com/api-reference/posts/create:
//  status defaults to draft; creation is async (201 + id, then GET returns 202 until done,
//  404 POST_CREATION_FAILED on failure); provide blocks OR body_content, not both;
//  <style>/<link> are stripped so HTML must use inline styles; plan: Pro and Enterprise.

const BASE = 'https://api.beehiiv.com/v2';
const FORBIDDEN_KEYS = ['scheduled_at', 'override_scheduled_at', 'recipients'];
const ALLOWED = [
  { method: 'POST', re: /^\/publications\/pub_[0-9a-f-]+\/posts$/i },
  { method: 'GET', re: /^\/publications\/pub_[0-9a-f-]+\/posts\/post_[0-9a-f-]+$/i },
];

function assertDraftOnly(payload) {
  if (payload.status !== 'draft') throw new Error(`SAFETY: status must be "draft", got "${payload.status}"`);
  const bad = FORBIDDEN_KEYS.filter((k) => k in payload);
  if (bad.length) throw new Error(`SAFETY: forbidden fields present: ${bad.join(', ')}`);
}

function assertAllowed(method, path) {
  if (!ALLOWED.some((a) => a.method === method && a.re.test(path))) throw new Error(`SAFETY: ${method} ${path} is not an allowed beehiiv call`);
}

// --- Minimal markdown -> inline-styled HTML (beehiiv strips <style>) ---
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="color:#1a56db;text-decoration:underline;">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
function mdToHtml(md) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{2,4})\s+(.*)/))) { close(); const l = m[1].length; out.push(`<h${l} style="margin:24px 0 8px;font-size:${[0, 0, 22, 18, 16][l]}px;">${inline(m[2])}</h${l}>`); }
    else if ((m = line.match(/^[-*]\s+(.*)/))) { if (list !== 'ul') { close(); list = 'ul'; out.push('<ul style="padding-left:20px;margin:8px 0;">'); } out.push(`<li style="margin:4px 0;">${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\d+\.\s+(.*)/))) { if (list !== 'ol') { close(); list = 'ol'; out.push('<ol style="padding-left:20px;margin:8px 0;">'); } out.push(`<li style="margin:4px 0;">${inline(m[1])}</li>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p style="margin:8px 0;line-height:1.55;">${inline(line)}</p>`); }
  }
  close();
  return out.join('\n');
}

function renderIssue(draft) {
  const md = draft.sections.map((s) => `## ${s.title}\n\n${s.markdown}`).join('\n\n');
  return { markdown: md, html: mdToHtml(md) };
}

function buildPayload(draft, { title, subject, templateId } = {}) {
  const { html } = renderIssue(draft);
  const payload = {
    title: title || subject || draft.subject_options[0],
    body_content: html,
    status: 'draft', // never changed anywhere in this codebase
    email_settings: { email_subject_line: subject || draft.subject_options[0], email_preview_text: draft.preview_text },
    content_tags: ['ai-operator-weekly'],
  };
  if (templateId) payload.post_template_id = templateId;
  assertDraftOnly(payload);
  return payload;
}

async function request(fetchImpl, apiKey, method, path, body, query = '') {
  assertAllowed(method, path);
  if (body) assertDraftOnly(body);
  return fetchImpl(`${BASE}${path}${query}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Creates the draft, polls until ready, and on ANY failure returns a manual-paste fallback
// instead of throwing — so the body is never lost. Caller stores the result in Issues.
async function createDraft({ draft, apiKey, publicationId, templateId, subject, fetchImpl = fetch, alert = async () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPolls = 10 }) {
  const payload = buildPayload(draft, { subject, templateId });
  const { markdown, html } = renderIssue(draft);
  const fallback = async (reason) => {
    await alert(`beehiiv draft creation failed: ${reason}. Issue body preserved for manual paste.`);
    return { status: 'manual_fallback', reason, subject: payload.email_settings.email_subject_line, preview_text: draft.preview_text, html, markdown };
  };

  try {
    const res = await request(fetchImpl, apiKey, 'POST', `/publications/${publicationId}/posts`, payload);
    if (res.status !== 201) return fallback(`create returned ${res.status}: ${await res.text().catch(() => '')}`);
    const { data } = await res.json();

    for (let i = 0; i < maxPolls; i++) {
      const g = await request(fetchImpl, apiKey, 'GET', `/publications/${publicationId}/posts/${data.id}`);
      if (g.status === 200) {
        const post = (await g.json()).data || {};
        if (post.status && post.status !== 'draft') await alert(`WARNING: post ${data.id} status is ${post.status}, expected draft`);
        return { status: 'draft_in_beehiiv', beehiiv_post_id: data.id, preview_url: data.preview_url, html, markdown };
      }
      if (g.status === 202) { await sleep(Number(g.headers?.get?.('Retry-After') || 2) * 1000); continue; }
      return fallback(`poll returned ${g.status} (POST_CREATION_FAILED or error)`);
    }
    return fallback('timed out waiting for async creation');
  } catch (e) {
    if (String(e.message).startsWith('SAFETY')) throw e; // safety violations must never be swallowed
    return fallback(e.message);
  }
}

// Read-only: fetch a post with stats for the analytics loop. Returns { post } or { pending } or throws.
async function getPostStats({ apiKey, publicationId, postId, fetchImpl = fetch }) {
  const res = await request(fetchImpl, apiKey, 'GET', `/publications/${publicationId}/posts/${postId}`, null, '?expand[]=stats');
  if (res.status === 202) return { pending: true };
  if (res.status !== 200) throw new Error(`beehiiv get post ${postId} returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return { post: (await res.json()).data };
}

module.exports = { buildPayload, createDraft, getPostStats, assertDraftOnly, assertAllowed, renderIssue, mdToHtml };
