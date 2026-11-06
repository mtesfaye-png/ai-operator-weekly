// The free weekly issue (no AI, no paid calls): selection, grouping, and what it refuses to invent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const digest = require('../lib/digest');
const { render } = require('../scripts/render-issue');

let n = 0;
const art = (o) => ({ article_id: `art_${++n}`, status: 'collected', topic_check: 'ai_feed', editorial_candidate: true, source_tier: 1,
  source_category: 'tools', source: 'GitHub Changelog', url: `https://example.com/${n}`, published_at: '2026-11-05T12:00:00Z', feed_excerpt: 'An AI agent update.', ...o });

test('FREE ISSUE: picks only AI stories from the week, at most 2 per category, no duplicates of one story', () => {
  const a = [
    art({ title: 'Airbnb is working on an AI travel agent', source: 'The Verge', source_tier: 2, source_category: 'business' }),
    art({ title: 'Airbnb says it is launching an AI travel agent in 2027', source: 'TechCrunch', source_tier: 2, source_category: 'tools' }),
    art({ title: 'Copilot usage API adds code review', }), art({ title: 'Copilot BYOK models in usage API' }), art({ title: 'Copilot in JetBrains' }),
    art({ title: 'Hogwarts Legacy gets DLSS 5 on GeForce NOW', source: 'NVIDIA Blog', source_category: 'infrastructure', feed_excerpt: 'A game update with AI upscaling.' }),
    art({ title: 'Gemini Flash gets cheaper', source: 'Google', source_category: 'frontier_models' }),
    art({ title: 'Old model news from last month', source: 'OpenAI', source_category: 'frontier_models', published_at: '2026-10-01T00:00:00Z' }),
    art({ title: 'Duplicate row', status: 'duplicate' }),
  ];
  const d = digest.build(a, { issueDate: '2026-11-06' });
  const titles = d.top.map((x) => x.title);
  assert.ok(titles.length <= 5);
  assert.equal(titles.filter((t) => /Airbnb/.test(t)).length, 1, 'one story, one entry');
  const airbnb = d.top.find((x) => /Airbnb/.test(x.title));
  assert.equal(airbnb.also.length, 1, 'the other outlet is listed under "also"');
  assert.ok(!titles.some((t) => /Hogwarts|Old model|Duplicate/.test(t)), 'gaming, out-of-window and duplicate rows are left out');
  assert.ok(d.top.filter((x) => x.source_category === 'tools').length <= 2);
  const everywhere = [...d.top, ...d.sections.flatMap((s) => s.items), ...d.community].map((x) => x.article_id);
  assert.equal(everywhere.length, new Set(everywhere).size, 'no article appears twice in the issue');
});

test('FREE ISSUE: the editor fills in every opinion; nothing is presented as checked', () => {
  const d = digest.build([art({ title: 'Copilot agent mode is generally available' })], { issueDate: '2026-11-06' });
  const md = digest.toMarkdown(d, { owner: 'Mohil' });
  assert.match(md, /EDITOR REVIEW REQUIRED/);
  for (const s of ['Why it matters', 'Tool of the Week', 'Workflow of the Week', 'One Thing to Try']) assert.match(md, new RegExp(s));
  assert.ok((md.match(/\[DRAFT TAKE - Mohil to confirm\]/g) || []).length >= 4);
  assert.match(md, /From the publisher: “An AI agent update\.”/);
  assert.doesNotMatch(md, /\b(Use|Skip)\b verdict:/);
  const html = render(md);
  assert.doesNotMatch(html, /\*\*/, 'renders without leftover Markdown');
  assert.match(html, /DRAFT TAKE/);
});

test('FREE ISSUE: feed boilerplate is stripped and Markdown characters in titles cannot break the layout', () => {
  assert.equal(digest.cleanExcerpt('Real text. The post Foo appeared first on Bar.'), 'Real text.');
  assert.equal(digest.cleanExcerpt('Article URL: https://x.y Comments URL: https://z'), '');
  const d = digest.build([art({ title: 'The *new* [beta] `api` for agents' })], { issueDate: '2026-11-06' });
  const md = digest.toMarkdown(d);
  assert.match(md, /### 1\. The new \(beta\) api for agents/);
});

test('FREE ISSUE: CLI writes the four files and makes no network call at all', async () => {
  const { freeIssue } = require('../src/steps/free_issue');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aow-free-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'articles.json'), JSON.stringify([art({ title: 'Claude gets a new agent API' })]));
  const noNet = async () => { throw new Error('network used'); };
  const quiet = { info() {} };
  const r = await freeIssue({ cfg: { dataDir: path.join(dir, 'data'), outDir: path.join(dir, 'out'), timezone: 'America/New_York', airtable: {}, newsletter: { name: 'AI Operator Weekly', owner: 'Mohil' } }, issueDate: '2026-11-06', fetchImpl: noNet, log: quiet });
  assert.equal(r.ok, true);
  assert.equal(r.paid_api_calls, 0);
  for (const f of ['issue.md', 'issue.html', 'beehiiv-body.html', 'sources.md']) assert.ok(fs.existsSync(path.join(dir, 'out', '2026-11-06', f)), f);
  const empty = await freeIssue({ cfg: { dataDir: path.join(dir, 'none'), outDir: path.join(dir, 'out'), timezone: 'America/New_York', airtable: {}, newsletter: {} }, issueDate: '2026-11-06', fetchImpl: noNet, log: quiet });
  assert.equal(empty.ok, false, 'an empty week is reported, not sent out blank');
});

test('GATE: AOW_SERVER_WORKFLOWS=none starts nothing on this Mac', () => {
  const { dueJobs } = require('../deploy/mac/gate');
  assert.deepEqual(dueJobs({ last: {} }, { AOW_SERVER_WORKFLOWS: 'none' }, new Date('2026-11-07T15:00:00Z')), []);
});

test('ACTIONS: the weekly free issue never sees a paid key and runs only free-issue', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'weekly-free-issue.yml'), 'utf8');
  const code = wf.replace(/^\s*#.*$/gm, '');
  assert.equal(/ANTHROPIC_|BEEHIIV_|api\.anthropic|api\.beehiiv/.test(code), false, 'no paid key or paid host');
  assert.deepEqual([...code.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]).sort(), ['AIRTABLE_BASE_ID', 'AIRTABLE_TOKEN']);
  assert.equal(/cli\.js (daily|weekly|analytics)\b/.test(code), false);
  assert.equal((code.match(/- cron:/g) || []).length, 1);
  assert.match(code, /contents: write/);
  assert.equal(/\$\{\{\s*inputs\.\w+\s*\}\}/.test(code.split('steps:')[1]), false, 'inputs reach the shell via env only');
});

test('CHECK-ISSUE: blocks missing sections, banned claims, unlabelled prices and leftover editor notes', () => {
  const { check } = require('../scripts/check-issue');
  const free = digest.toMarkdown(digest.build([art({ title: 'Copilot agent API ships' })], { issueDate: '2026-11-06' }));
  const r = check(free);
  assert.ok(r.blocking.some((b) => /Build Better/.test(b)), 'the free draft is not a finished issue');
  assert.ok(r.warnings.some((w) => /DRAFT TAKE/.test(w)));
  const bad = check('## The 5 Biggest Things\n\n### 1. X\nNo link here.\n\nIt is revolutionary. Plans cost $20/month.\n');
  assert.ok(bad.blocking.some((b) => /revolutionary/.test(b)));
  assert.ok(bad.blocking.some((b) => /price without/.test(b)));
  assert.ok(bad.blocking.some((b) => /without a source link/.test(b)));
  assert.ok(check('> EDITOR REVIEW REQUIRED\n', { final: true }).blocking.some((b) => /EDITOR REVIEW/.test(b)));
  assert.equal(check('Pro is $20/month (checked Nov 7).').blocking.some((b) => /price/.test(b)), false);
});

test('COPY-AIRTABLE: dry run writes nothing; --write upserts on each key; a second run adds nothing', async () => {
  const { main } = require('../scripts/copy-airtable');
  const { KEYS } = require('../src/store/codec');
  const bases = { appFROM00000000001: { Articles: [{ article_id: 'a1', title: 'One' }, { article_id: 'a2', title: 'Two', extra_field: 'x' }], Sources: [{ name: 'S' }] }, appTO0000000000002: { Articles: [{ article_id: 'a1', title: 'One' }] } };
  const writes = [];
  const fakeFetch = async (url, opts = {}) => {
    const u = new URL(url);
    const [, , base, rawTable] = u.pathname.split('/');
    if (u.pathname.includes('/meta/bases/')) return { ok: true, status: 200, json: async () => ({ tables: [{ name: 'Articles', fields: [{ name: 'article_id' }, { name: 'title' }] }, { name: 'Sources', fields: [{ name: 'name' }] }] }) };
    const table = decodeURIComponent(rawTable);
    const rows = (bases[base][table] ||= []);
    if ((opts.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ records: rows.map((f, i) => ({ id: `rec${i}`, fields: f })) }) };
    const body = JSON.parse(opts.body);
    writes.push({ base, table, n: body.records.length });
    for (const r of body.records) {
      const k = KEYS[table];
      const i = rows.findIndex((x) => x[k] === r.fields[k]);
      if (i >= 0) rows[i] = { ...rows[i], ...r.fields }; else rows.push(r.fields);
    }
    return { ok: true, status: 200, json: async () => ({ records: [] }) };
  };
  const env = { FROM_AIRTABLE_BASE_ID: 'appFROM00000000001', AIRTABLE_BASE_ID: 'appTO0000000000002', AIRTABLE_TOKEN: 'patTEST', AOW_TEST_NO_THROTTLE: '1' };
  const quiet = () => {};
  await main({ env, argv: [], fetchImpl: fakeFetch, log: quiet });
  assert.equal(writes.length, 0, 'dry run writes nothing');
  await main({ env, argv: ['--write'], fetchImpl: fakeFetch, log: quiet });
  assert.deepEqual(bases.appTO0000000000002.Articles.map((r) => r.article_id).sort(), ['a1', 'a2']);
  assert.equal('extra_field' in bases.appTO0000000000002.Articles.find((r) => r.article_id === 'a2'), false, 'fields the destination lacks are skipped');
  await main({ env, argv: ['--write'], fetchImpl: fakeFetch, log: quiet });
  assert.equal(bases.appTO0000000000002.Articles.length, 2, 'running it again duplicates nothing');
  assert.equal(bases.appFROM00000000001.Articles.length, 2, 'the source is never changed');
  await assert.rejects(main({ env: { ...env, AIRTABLE_BASE_ID: env.FROM_AIRTABLE_BASE_ID }, fetchImpl: fakeFetch, log: quiet }), /same base/);
});

test('SERVER: AOW_SERVER_WORKFLOWS=none allows nothing instead of crashing', () => {
  const { allowedWorkflows } = require('../src/server');
  assert.equal(allowedWorkflows({ AOW_SERVER_WORKFLOWS: 'none' }).size, 0);
  assert.deepEqual([...allowedWorkflows({})], ['collect']);
});

test('FREE ISSUE: everyday words do not join unrelated stories; one source gets at most one top slot', () => {
  const filler = Array.from({ length: 30 }, (_, i) => art({ title: `Open models and agents update number ${i} for teams`, source: `Src${i}`, source_category: `c${i}` }));
  const a = [
    art({ title: 'The Wizard of Open Weights makes AI easy with open models', source: 'NVIDIA Blog', source_category: 'infrastructure' }),
    art({ title: 'Olla lightweight open models proxy with weights', source: 'r/LocalLLaMA', source_tier: 4, editorial_candidate: false, source_category: 'community' }),
    art({ title: 'Into the Omniverse with AI agents', source: 'NVIDIA Blog', source_category: 'open_source' }),
    art({ title: 'Airbnb is working on an AI travel agent', source: 'The Verge', source_tier: 2, source_category: 'business' }),
    art({ title: 'Airbnb says its AI travel agent launches in 2027', source: 'TechCrunch', source_tier: 2, source_category: 'tools' }),
    ...filler,
  ];
  const d = digest.build(a, { issueDate: '2026-11-06' });
  const wizard = d.top.find((x) => /Wizard/.test(x.title)) || d.sections.flatMap((s) => s.items).find((x) => /Wizard/.test(x.title));
  if (wizard) assert.equal(wizard.also.length, 0, 'not merged with the forum post');
  assert.equal(d.top.filter((x) => x.source === 'NVIDIA Blog').length <= 1, true);
  const airbnb = d.top.find((x) => /Airbnb/.test(x.title));
  assert.ok(airbnb && airbnb.also.length === 1, 'the same story from two outlets is still grouped');
});

test('FREE ISSUE: marketing series, roundups and videos stay out of the top 5', () => {
  const d = digest.build([
    art({ title: 'Into the Omniverse: developers build with AI agents', source: 'NVIDIA Blog', source_category: 'infrastructure' }),
    art({ title: 'The latest AI news we announced in October', source: 'Google', source_category: 'frontier_models' }),
    art({ title: 'Open source AI is booming', source: 'TechCrunch', url: 'https://techcrunch.com/video/open-source-ai', source_category: 'business' }),
    art({ title: 'Copilot agent mode ships to all plans', source: 'GitHub Changelog' }),
  ], { issueDate: '2026-11-06' });
  assert.deepEqual(d.top.map((x) => x.source), ['GitHub Changelog']);
});
