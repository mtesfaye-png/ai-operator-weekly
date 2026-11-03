#!/usr/bin/env node
// Creates exactly ONE beehiiv draft from a rendered demo issue. It can never publish, schedule or send:
// lib/beehiiv.js's guards allow only POST /posts and GET /posts/:id, require status "draft", and reject
// scheduled_at / recipients. The create request is never retried. A marker file records the post id, and when
// it exists nothing is created again.
//   BEEHIIV_API_KEY=… BEEHIIV_PUBLICATION_ID=pub_… node scripts/beehiiv-demo-draft.js demo/2026-11-03 <marker.json>

const fs = require('fs');
const path = require('path');
const { assertDraftOnly, assertAllowed, checkDraft } = require('../lib/beehiiv');

const BASE = 'https://api.beehiiv.com/v2';

function readIssue(dir) {
  const subjects = fs.readFileSync(path.join(dir, 'subjects.md'), 'utf8');
  const subject = (subjects.match(/^1\.\s+\*\*(.+?)\*\*/m) || [])[1];
  const preview = (subjects.match(/^>\s*(.+)$/m) || [])[1];
  const html = fs.readFileSync(path.join(dir, 'beehiiv-body.html'), 'utf8');
  if (!subject || !preview || !html.trim()) throw new Error(`Missing subject, preview text or HTML in ${dir}`);
  return { subject, preview, html };
}

function buildDemoPayload({ subject, preview, html }) {
  const payload = {
    title: subject,
    body_content: html,
    status: 'draft',
    email_settings: { email_subject_line: subject, email_preview_text: preview },
    content_tags: ['ai-operator-weekly', 'demo'],
  };
  assertDraftOnly(payload);
  return payload;
}

async function main([dir, markerFile], { env = process.env, fetchImpl = fetch } = {}) {
  const apiKey = env.BEEHIIV_API_KEY, publicationId = env.BEEHIIV_PUBLICATION_ID;
  if (!apiKey || !/^pub_[0-9a-f-]+$/i.test(publicationId || '')) throw new Error('Set BEEHIIV_API_KEY and BEEHIIV_PUBLICATION_ID (pub_…).');
  if (fs.existsSync(markerFile)) {
    const m = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    return { created: false, reason: `A draft was already created for this issue (post ${m.post_id} at ${m.created_at}). Nothing was sent to beehiiv.`, post_id: m.post_id };
  }
  const payload = buildDemoPayload(readIssue(dir));
  const p = `/publications/${publicationId}/posts`;
  assertAllowed('POST', p);
  assertDraftOnly(payload);
  const res = await fetchImpl(`${BASE}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('beehiiv rejected the API key (401). Create a new key in beehiiv: Settings → API.');
  if (res.status === 403 || res.status === 404 || res.status === 400) {
    return { created: false, plan_blocked: res.status === 403, reason: `beehiiv answered ${res.status}: ${JSON.stringify(json).slice(0, 300)}. Create Post is documented for the Pro and Enterprise plans; use the manual import steps in demo/DEMO_GUIDE.md.` };
  }
  if (!res.ok) throw new Error(`beehiiv answered ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  const postId = json.data?.id;
  fs.mkdirSync(path.dirname(markerFile), { recursive: true });
  fs.writeFileSync(markerFile, JSON.stringify({ post_id: postId, created_at: new Date().toISOString(), issue: dir }, null, 2));
  const check = await checkDraft({ apiKey, publicationId, postId, fetchImpl, maxPolls: 6 });
  return { created: true, post_id: postId, status_requested: 'draft', check: check.state, detail: check.detail };
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.created || /already created/.test(r.reason || '') ? 0 : 1); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { main, buildDemoPayload, readIssue };
