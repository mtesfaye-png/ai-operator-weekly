# AI Operator Weekly

The automated research → ranking → writing → fact-check → **beehiiv draft** system from the intern build brief.
It never publishes. Every issue lands in beehiiv as a draft; Mohil reviews, edits and sends it by hand.

```
Daily 6:45am     Scout: RSS + web search → Claude Scout → validate → date window → dedupe → score → Stories
Saturday 7:00am  Weekly: select (diversity rule) → Researcher verifies sources + live pricing → Writer plans
                 → Researcher answers plan's requests → Writer drafts → Fact Checker (Opus) → quality gate
                 → one revision if needed → beehiiv DRAFT (or export for manual paste) → Slack "draft ready"
Daily 10:00am    Analytics: once an issue is sent, pull stats → Performance → learning summary for next week
```

No npm dependencies. Node 20+ only.

## How it runs today: free, $0 a week

This repo (`mtesfaye-png/ai-operator-weekly`) is the one shared home for Manuel and Mohil.

| When | What | Where | Cost |
|---|---|---|---|
| Every day, 12:17 UTC | **RSS collect**: public feeds → dedupe → label → Airtable | GitHub Actions: `rss-collect.yml` | $0 |
| Saturday, 13:40 UTC | **Free issue**: ranks the week's articles and writes a draft with no AI → commits it to `issues/<date>/` | GitHub Actions: `weekly-free-issue.yml` | $0 |
| When you want it | **Full written issue**: type `/write-issue` in Claude Code in this folder. It researches, writes and checks the issue | Your own Claude plan (no API credits) | $0 extra |
| By hand | Paste `beehiiv-body.html` into a new beehiiv post and keep it as a **draft**. Publish yourself | beehiiv | $0 |

**The free issue** (`node src/cli.js free-issue`) picks the five biggest stories with plain arithmetic: source tier, how
recent it is, how many outlets ran it, and business keywords. It groups the same story from different outlets, leaves
out gaming and other off-topic posts, and adds Tools / Pricing / Models / Business sections. It never writes an
opinion: every "why it matters", Tool of the Week and Workflow of the Week is a **[DRAFT TAKE]** box for the editor.
Tune it in `config/digest.json` (any key of `DEFAULTS` in `lib/digest.js`).

**Check an issue before beehiiv:** `node scripts/check-issue.js issues/<date>/written/issue.md` (add `--final` after
your edits: it then also blocks leftover [DRAFT TAKE] lines and the editor box).

The paid Claude pipeline (daily scout + weekly research/writing/fact-check, below) is built and live-tested but
**switched off** to save credits. Turning it on is a deliberate step: `deploy/mac/setup.sh --paid` on the Mac.

## Go live in five steps

1. **Configure.** `cp .env.example .env` and fill in at least `ANTHROPIC_API_KEY`. Run `npm run doctor`.
2. **Create the Airtable base** (optional but recommended):
   `AIRTABLE_TOKEN=... AIRTABLE_WORKSPACE_ID=... npm run airtable:setup`, then put the printed base ID in
   `AIRTABLE_BASE_ID`. Without Airtable, everything is kept in `data/` as JSON.
3. **Connect beehiiv** (optional): set `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID` and ideally
   `BEEHIIV_POST_TEMPLATE_ID`. The Create Post API needs a supported plan (beehiiv's docs on 2026-10-18 say Pro and
   Enterprise; the brief said Max/Enterprise). Without it, each issue is exported to `out/<date>/issue.html` for
   manual paste and Slack tells you where.
4. **First live run by hand:** `npm run daily` (about $0.10–0.50), check `data/` or Airtable, then
   `npm run weekly` (about $3–8, capped at $20). Open `out/<date>/preview.html` and the beehiiv draft.
5. **Schedule it.** Deploy the trigger server (`npm start`, or the Dockerfile) with `AOW_TRIGGER_TOKEN` set and
   `AOW_SERVER_WORKFLOWS=collect,daily,weekly,analytics` (the server only allows `collect` unless told otherwise).
   In n8n, import `daily-scout.json`, `weekly-production.json` and `analytics.json` from `n8n/`, create a *Header Auth* credential named **AOW Trigger Token**
   (`Authorization: Bearer <token>`), replace `https://YOUR-AOW-SERVER` and the Slack URL, then activate.
   No n8n? Use cron: `45 6 * * * cd /app && node src/cli.js daily` (and the same for weekly/analytics).

Try it with no keys and no cost: `npm run demo` runs daily → weekly → analytics against simulated APIs
(fictional `*.example` companies) and writes the issue to `out-mock/2026-10-18/`.

## Commands

| Command | Does |
|---|---|
| `npm run collect` | RSS-only: fetch public feeds, normalize, dedupe, save to `data/articles.json`. No Claude, no paid calls. See [docs/RSS_ONLY_AND_AIRTABLE_FREE.md](docs/RSS_ONLY_AND_AIRTABLE_FREE.md) |
| `npm run daily` | Scout today's stories |
| `npm run weekly -- --date 2026-10-24` | Produce that week's issue (defaults to today). Re-running a week that already has a draft does nothing unless you add `--force`. A week whose beehiiv post is still being created is only re-checked. |
| `npm run weekly -- --force` | Regenerate the issue. If a beehiiv post already exists it is left untouched and **no second draft is created**: paste `out/<date>/issue.html` into it (status `regenerated_manual_update`). |
| `npm run weekly -- --force --new-beehiiv-draft` | Regenerate and deliberately create a second beehiiv draft. The old post id is kept in `previous_beehiiv_post_ids`. Sent issues are never regenerated. |
| `npm run analytics` | Pull stats for sent issues |
| `npm run doctor` | Show which keys and services are configured |
| `node src/cli.js airtable-check` | Read back the Articles mirrored to Airtable and check for missing or duplicate rows (1 call per 100 rows) |
| `node src/cli.js airtable-status` | Real record count across all tables and this month's API calls vs the Free limits; marks rows you deleted in Airtable as archived so they free up the budget (≈10 calls) |
| `npm start` | Trigger server for n8n: `POST /run/{collect,daily,weekly,analytics}` (only those in `AOW_SERVER_WORKFLOWS`, default `collect`; collect accepts `{"days":3,"max_sync":10,"wait":true}`), `GET /runs/:id`, `GET /health`. Listens on 127.0.0.1 unless `HOST` is set |
| `node src/cli.js free-issue [--date …] [--out issues]` | The weekly draft with no AI and no paid calls (see above) |
| `node scripts/check-issue.js <issue.md> [--final]` | Rules check on a finished issue: required sections, banned claims, prices with a checked date, sources |
| `node scripts/copy-airtable.js [--write]` | One-time copy of one base into another (dry run without `--write`) |
| `npm test` | 110 tests: brief §13 acceptance tests, full simulated cycles on local files and on Airtable, n8n checks, review, stabilization and pricing-source regressions, RSS-only collection, Stage 3 trigger server / lock / repeated-run / archive / deployment checks |

Exit codes: `0` ok · `2` issue blocked by the quality gate · `1` error.

Issue statuses: `drafting` · `blocked` (gate failed, no beehiiv post) · `draft_pending` (beehiiv accepted the post
but hadn't finished; the id is saved and the next weekly run checks it, don't paste a copy) · `draft_in_beehiiv` ·
`manual_fallback` (paste `issue.html`; if the alert says the request *may* have reached beehiiv, check Posts first) ·
`regenerated_manual_update` · `sent` (never changed again).

## Where things live

```
src/agents/   scout · researcher · writer (plan / write / revise) · factcheck
src/steps/    daily · weekly · analytics
src/          claude.js (API client) · store/ (Airtable + local) · rss.js · server.js · cli.js
lib/          scoring · dedupe · dates · pricing · budget · quality_gate · beehiiv (draft-only)
prompts/      the four system prompts          schemas/   JSON contracts between agents
config/       sources.csv · scoring.json · newsletter.json · runtime.json (models, limits, prices)
n8n/          importable workflows             notes/     Mohil's takes per issue
out/<date>/   issue.md · issue.html · preview.html · research_packet.json · fact_check.json · gate.json · budget.json
```

## How to change things

| Change | Edit |
|---|---|
| Sources | `config/sources.csv` before setup, then the Airtable **Sources** table (untick `active` to pause one) |
| Scoring weights, diversity, dedupe sensitivity | `config/scoring.json` |
| Sections, word target, banned superlatives (and harmless phrases like "best practices"), price freshness (72h) | `config/newsletter.json` |
| Agent behaviour | `prompts/*.md` (keep output shapes in line with `schemas/`) |
| Official pricing domains per vendor (e.g. Anthropic → claude.com) | `config/official_pricing_domains.json`. Only add a domain after checking it belongs to that vendor |
| Models, effort per agent, refusal fallback, search/fetch limits, budget caps, API prices | `config/runtime.json`. Re-check prices on Anthropic's pricing page when models change. Set `refusal_fallback` to `null` to turn the server-side fallback off. |
| Mohil's takes | `notes/<issue-date>.md` or the Issues row's `mohil_notes` field |
| Gate rules | `lib/quality_gate.js`, and add a test for each new rule |

## What the code enforces (not just the prompts)

- **Evidence is real.** Claude's evidence URLs are checked against the pages it actually retrieved in that call.
  Anything else is stripped and the claim becomes *unverified*, which the writer can't use. Pricing, benchmark and
  funding claims need a page that was actually fetched.
- **Prices are fresh and official.** "Checked on" times come from the fetch, not the model. A price only counts if
  its page was fetched successfully and is on the *product vendor's* own domains: the vendor's verified domain
  (Tier 1 in the registry, or the story's own fetched primary page) or a domain listed for that vendor in
  `config/official_pricing_domains.json`. A Tier 1 page is never official for a different vendor, and
  publisher/community domains are never vendors. Otherwise the price is marked unverified, hidden from the
  writer, and the gate blocks the issue (`PRICE_UNVERIFIED`). Stored research with prices older than 72 hours is re-fetched on re-runs.
- **Dates are event dates.** Crawl dates are ignored for the issue window.
- **Fact check is independent.** It runs on a different model (Opus, effort `high`) than the writer, and FAIL is
  recomputed in code from the table. A request Claude declines (`refusal`) fails the step loudly instead of
  producing an empty answer; the server-side fallback is tried first.
- **Research belongs to its week.** Stored research is reused only on re-runs of the same issue week, so a
  request id like `req-tool-of-week` can never pick up last month's answer. A sent issue is never regenerated.
- **The gate blocks** unsourced links, unverified claims, stale or unofficial prices, prices without a checked
  date, out-of-window stories, repeated story angles, unsupported "best / first / largest / Nx", unlabelled ROI
  dollars, workflows without a human review step, tool picks without audience / skip / verdict, bare or
  broken links, and missing required sections. Mixed `utm_source` values are a warning.
- **Nothing can publish.** beehiiv payloads are always `draft`; scheduling and recipient fields are refused; only
  "create post" and "get post" calls are allowed; n8n workflows never touch beehiiv.
- **Cost is capped.** The cap is checked before every HTTP request to Claude (first request, each `pause_turn`
  continuation, each JSON repair) and every completed request is logged with its own usage in `budget.json`.
  Per-run caps in `runtime.json`.
- **Incomplete output never moves on.** A `max_tokens` stop, a stream that ends early, a refusal, or a call still
  paused after `max_pause_turns` continuations is an error: the run stops before the gate and nothing reaches
  beehiiv. Calls without tools (plan, write, expand, revise, repairs) stream, so they can use a 64k output limit
  (thinking included) without HTTP timeouts.
- **One beehiiv post per issue.** The post id is saved the moment beehiiv answers 201, before polling. An accepted
  post that hasn't finished is `draft_pending`, never "failed"; the create request is never retried
  automatically.
- **Length is handled, not faked.** A draft under 1,500 words gets one expansion pass that may only deepen what
  the verified research supports; it is fact-checked and gated like everything else. If it is still short (or
  over 2,200), the draft is kept and an **EDITOR REVIEW REQUIRED** box at the top of the draft, the Slack alert and
  `Issues.review_flags` say so. Optional sections can still be left out. `[DRAFT TAKE]` placeholders are
  highlighted in the draft as needing Mohil's approval and listed in the same box.
- **Failures keep the work.** Research, draft and fact check are saved before beehiiv is called. Any failure
  alerts Slack and leaves the issue ready to paste.

## Running on Mohil's Mac (current setup)

Everything runs on Mohil's Mac as background services (launchd). No Docker, no server, and nothing is
reachable from outside the Mac: every service listens on 127.0.0.1 only.

| Service | What it does |
|---|---|
| `com.aiopweekly.aow` | The pipeline's trigger server (`src/server.js`) on port 8787. Runs collect / daily / weekly / analytics when n8n asks, and sends alerts |
| `com.aiopweekly.n8n` | n8n 2.44.7 at http://localhost:5678 (login in `.env`: `N8N_OWNER_EMAIL` / `N8N_OWNER_PASSWORD`). Runs each workflow, polls the weekly run, alerts on failure |
| `com.aiopweekly.gate` | Every 5 minutes, `deploy/mac/gate.js` decides whether to start the day's jobs (below) |
| `com.aiopweekly.maintain` | Sundays 9am (or the next wake): backup, Airtable clean-up, log rotation (`deploy/mac/maintain.js`) |

**Now that GitHub Actions does the daily collect, the Mac is optional.** It's set to `AOW_SERVER_WORKFLOWS=none`, so
it starts nothing on its own and doesn't double the Airtable API calls. It still runs the Sunday backup.

**When things run (if switched on).** Not at fixed times: a sleeping Mac would miss them. A job starts once the Mac has been
used for **30 minutes in a row** (keyboard/mouse within the last 5 minutes), **no meeting is on** (any microphone
in use, or a Zoom meeting), and it's after 6am. Order: free RSS collect → daily scout → weekly issue (Saturday, or
the first qualifying day after) → analytics. Each runs once per day (weekly once per week).
`node deploy/mac/gate.js --status` shows the active minutes, meeting state and what's due.

**Commands**

| Do | Run |
|---|---|
| Health check | `deploy/mac/setup.sh --status` |
| Enter or replace keys (hidden input) | `deploy/mac/set-secrets.sh` |
| Reinstall / update services (safe to repeat) | `deploy/mac/setup.sh --paid` (`--paid` keeps the Claude workflows on; without it only the free collect runs) |
| Run a step now, by hand | `node src/cli.js daily` · `node src/cli.js weekly` |
| Backup now | `node deploy/mac/maintain.js --dry-run` (backs up; removes nothing) |

Logs: `~/Operator-Weekly-AI-work/logs/` (`aow.log`, `n8n.log`, `scheduler.log`, `maintenance.log`).
Backups: `~/Operator-Weekly-AI-work/backups/` (last 8). Keys: `.env` (mode 600, never committed).

**Costs.** Claude: about $0.30 a day for the scout plus about $3–8 for each weekly issue, capped at $25 a month
by the Claude Console's **Newsletter** workspace. Airtable Free, n8n Community Edition: $0.

**Alerts** go to email (Gmail SMTP, needs `SMTP_PASS`: a Gmail app password) and to a Mac notification.

## Manual fallback

See [`docs/MANUAL_FALLBACK.md`](docs/MANUAL_FALLBACK.md). Short version: if the Claude API is down, run each
prompt in `prompts/` by hand in Claude and paste results into Airtable. If beehiiv is down or not on a supporting
plan, paste `out/<date>/issue.html` into a new beehiiv post. Delete the EDITOR REVIEW REQUIRED box (if any)
before sending.

## First live test

See [`docs/FIRST_LIVE_TEST.md`](docs/FIRST_LIVE_TEST.md): Anthropic only, local storage, a lowered app-side cap
(`AOW_MAX_USD`), and why a provider-side spend limit is still needed.

## What has been verified live (2026-11-05)

Live on Mohil's Mac: RSS collect into Airtable (15/15 feeds), the daily scout with real Claude (18 stories, 0
rejected), story selection, deep research with official-pricing enforcement, n8n orchestration and its failure
alerts, the at-the-Mac scheduler and meeting check, backups. The live runs found and fixed three real bugs
(Scout categories, research labels, writer JSON parsing).

Not yet live: a weekly run all the way to the gate (spending was paused after the parsing fix), beehiiv draft
creation (beehiiv not connected yet), email alerts (needs a Gmail app password). All three pass in the simulated
end-to-end run (`npm run demo`). Status per brief item: `docs/AI_Operator_Weekly_Operating_Manual.pdf`, section 7.
