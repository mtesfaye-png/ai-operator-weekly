// Draft-only beehiiv client (brief §10). This module CANNOT publish:
//  - payload status is hard-coded to "draft" and re-asserted before every request
//  - scheduled_at / override_scheduled_at / recipients are stripped
//  - only two endpoints are allowed: POST /posts (create) and GET /posts/:id (poll)
// API facts verified 2026-10-18 at developers.beehiiv.com/api-reference/posts/create:
//  status defaults to draft; creation is async (201 + id, then GET returns 202 until done,
//  404 POST_CREATION_FAILED on failure); provide blocks OR body_content, not both;
//  <style>/<link> are stripped so HTML must use inline styles; plan: Pro and Enterprise.
// Idempotency: once beehiiv answers 201 the post id is handed to onAccepted() before any polling, and
// an accepted-but-unfinished post is reported as pending (never as failed). Nothing here ever retries
// the create POST, so a network failure can't silently produce a second draft.

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
const DRAFT_TAKE_RE = /\[DRAFT TAKE[^\]]*\]/g;
function inline(s) {
  return esc(s)
    .replace(DRAFT_TAKE_RE, (m) => `<span style="background:#fde68a;color:#7c2d12;font-weight:700;padding:0 4px;">${m} (needs Mohil's approval)</span>`)
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

// Editor checklist shown at the top of the draft whenever something needs a human decision.
// It says to delete it before sending; the automation never sends, so Mohil always sees it.
function reviewBox(flags) {
  if (!flags || !flags.length) return { md: '', html: '' };
  const md = `> **EDITOR REVIEW REQUIRED - delete this box before sending**\n${flags.map((f) => `> - ${f}`).join('\n')}\n\n`;
  const html = `<div style="border:3px solid #b91c1c;background:#fef2f2;padding:12px 16px;margin:0 0 20px;font-family:system-ui,sans-serif;">
<p style="margin:0 0 6px;font-weight:700;color:#b91c1c;">EDITOR REVIEW REQUIRED - delete this box before sending</p>
<ul style="margin:0;padding-left:20px;">${flags.map((f) => `<li style="margin:2px 0;">${esc(f)}</li>`).join('')}</ul></div>\n`;
  return { md, html };
}

function renderIssue(draft, { reviewFlags = [] } = {}) {
  const md = draft.sections.map((s) => `## ${s.title}\n\n${s.markdown}`).join('\n\n');
  const box = reviewBox(reviewFlags);
  return { markdown: box.md + md, html: box.html + mdToHtml(md) };
}

function buildPayload(draft, { title, subject, templateId, reviewFlags } = {}) {
  const { html } = renderIssue(draft, { reviewFlags });
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

// Read-only status check for a post that beehiiv accepted. Never creates anything.
// Returns { state: 'ready' | 'pending' | 'failed', detail }. Only a 404 (POST_CREATION_FAILED) is a
// definite failure; 202, timeouts, 5xx and network errors all mean "not known yet".
async function checkDraft({ apiKey, publicationId, postId, fetchImpl = fetch, alert = async () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPolls = 10 }) {
  let detail = 'no response yet';
  for (let i = 0; i < maxPolls; i++) {
    let g;
    try { g = await request(fetchImpl, apiKey, 'GET', `/publications/${publicationId}/posts/${postId}`); }
    catch (e) { if (String(e.message).startsWith('SAFETY')) throw e; detail = `network error: ${e.message}`; await sleep(2000); continue; }
    if (g.status === 200) {
      const post = (await g.json()).data || {};
      if (post.status && post.status !== 'draft') await alert(`WARNING: post ${postId} status is ${post.status}, expected draft`);
      return { state: 'ready', detail: 'created' };
    }
    if (g.status === 404) return { state: 'failed', detail: 'beehiiv reports POST_CREATION_FAILED' };
    detail = g.status === 202 ? 'still being created' : `poll returned ${g.status}`;
    await sleep(Number(g.headers?.get?.('Retry-After') || 2) * 1000);
  }
  return { state: 'pending', detail };
}

// Creates the draft and polls until ready. Never throws except on a SAFETY violation, so the body is
// never lost. Result status:
//   draft_in_beehiiv  - created; beehiiv_post_id + preview_url set
//   draft_pending     - accepted (201) but not finished yet; beehiiv_post_id set; check again later, don't paste
//   manual_fallback   - not created (or creation failed); paste the HTML by hand. beehiiv_post_id set if known.
//                       `uncertain: true` means the request may have reached beehiiv: check Posts before pasting.
async function createDraft({ draft, apiKey, publicationId, templateId, subject, reviewFlags = [], fetchImpl = fetch, alert = async () => {}, onAccepted = async () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPolls = 10 }) {
  const payload = buildPayload(draft, { subject, templateId, reviewFlags });
  const { markdown, html } = renderIssue(draft, { reviewFlags });
  const base = { subject: payload.email_settings.email_subject_line, preview_text: draft.preview_text, html, markdown };
  const fallback = async (reason, extra = {}) => {
    await alert(`beehiiv draft creation failed: ${reason}. Issue body preserved for manual paste.`);
    return { status: 'manual_fallback', reason, ...base, ...extra };
  };

  let res;
  try { res = await request(fetchImpl, apiKey, 'POST', `/publications/${publicationId}/posts`, payload); }
  catch (e) {
    if (String(e.message).startsWith('SAFETY')) throw e; // safety violations must never be swallowed
    return fallback(`create request got no response (${e.message}); beehiiv MAY have created the post, so check Posts in beehiiv before pasting`, { uncertain: true });
  }
  if (res.status !== 201) return fallback(`create returned ${res.status}: ${await res.text().catch(() => '')}`);
  let data;
  try { ({ data } = await res.json()); } catch { data = null; }
  if (!data?.id) return fallback('beehiiv accepted the post (201) but returned no post id; check Posts in beehiiv before pasting', { uncertain: true });
  const accepted = { beehiiv_post_id: data.id, preview_url: data.preview_url };
  await onAccepted(accepted); // persist the id before anything else can go wrong

  const c = await checkDraft({ apiKey, publicationId, postId: data.id, fetchImpl, alert, sleep, maxPolls });
  if (c.state === 'ready') return { status: 'draft_in_beehiiv', ...accepted, ...base };
  if (c.state === 'failed') return fallback(`post ${data.id} was accepted but ${c.detail}`, accepted);
  await alert(`beehiiv accepted post ${data.id} but it isn't ready yet (${c.detail}). It is saved; the next weekly run for this date checks it again. Don't paste a copy.`);
  return { status: 'draft_pending', reason: c.detail, ...accepted, ...base };
}

// Read-only: fetch a post with stats for the analytics loop. Returns { post } or { pending } or throws.
async function getPostStats({ apiKey, publicationId, postId, fetchImpl = fetch }) {
  const res = await request(fetchImpl, apiKey, 'GET', `/publications/${publicationId}/posts/${postId}`, null, '?expand[]=stats');
  if (res.status === 202) return { pending: true };
  if (res.status !== 200) throw new Error(`beehiiv get post ${postId} returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return { post: (await res.json()).data };
}

module.exports = { buildPayload, createDraft, checkDraft, getPostStats, assertDraftOnly, assertAllowed, renderIssue, mdToHtml };
