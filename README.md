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
5. **Schedule it.** Deploy the trigger server (`npm start`, or the Dockerfile) with `AOW_TRIGGER_TOKEN` set.
   In n8n, import the three files in `n8n/`, create a *Header Auth* credential named **AOW Trigger Token**
   (`Authorization: Bearer <token>`), replace `https://YOUR-AOW-SERVER` and the Slack URL, then activate.
   No n8n? Use cron: `45 6 * * * cd /app && node src/cli.js daily` (and the same for weekly/analytics).

Try it with no keys and no cost: `npm run demo` runs daily → weekly → analytics against simulated APIs
(fictional `*.example` companies) and writes the issue to `out-mock/2026-10-18/`.

## Commands

| Command | Does |
|---|---|
| `npm run daily` | Scout today's stories |
| `npm run weekly -- --date 2026-10-24` | Produce that week's issue (defaults to today). Re-running a week that already has a draft does nothing unless you add `--force`. A week whose beehiiv post is still being created is only re-checked. |
| `npm run weekly -- --force` | Regenerate the issue. If a beehiiv post already exists it is left untouched and **no second draft is created**: paste `out/<date>/issue.html` into it (status `regenerated_manual_update`). |
| `npm run weekly -- --force --new-beehiiv-draft` | Regenerate and deliberately create a second beehiiv draft. The old post id is kept in `previous_beehiiv_post_ids`. Sent issues are never regenerated. |
| `npm run analytics` | Pull stats for sent issues |
| `npm run doctor` | Show which keys and services are configured |
| `npm start` | Trigger server for n8n: `POST /run/{daily,weekly,analytics}`, `GET /runs/:id`, `GET /health` |
| `npm test` | 47 tests: brief §13 acceptance tests, full simulated cycles on local files and on Airtable, n8n checks, review and stabilization regressions |

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
| Models, effort per agent, refusal fallback, search/fetch limits, budget caps, API prices | `config/runtime.json`. Re-check prices on Anthropic's pricing page when models change. Set `refusal_fallback` to `null` to turn the server-side fallback off. |
| Mohil's takes | `notes/<issue-date>.md` or the Issues row's `mohil_notes` field |
| Gate rules | `lib/quality_gate.js`, and add a test for each new rule |

## What the code enforces (not just the prompts)

- **Evidence is real.** Claude's evidence URLs are checked against the pages it actually retrieved in that call.
  Anything else is stripped and the claim becomes *unverified*, which the writer can't use. Pricing, benchmark and
  funding claims need a page that was actually fetched.
- **Prices are fresh and official.** "Checked on" times come from the fetch, not the model. A price only counts if
  its page is on the vendor's domain. Stored research with prices older than 72 hours is re-fetched on re-runs.
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

## Manual fallback

If the Claude API is down: run each prompt in `prompts/` by hand in Claude and paste results into Airtable.
If beehiiv is down or not on a supporting plan: paste `out/<date>/issue.html` into a new beehiiv post.
Delete the EDITOR REVIEW REQUIRED box (if any) before sending.

## Not yet verified against live services

Every path is tested against simulated APIs that follow the official docs, but no live run has happened yet:
the first `npm run daily` and `npm run weekly` with real keys are that check. The RSS URLs in `sources.csv` are a
starting list; the daily run reports any that fail.
