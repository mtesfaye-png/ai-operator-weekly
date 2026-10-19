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
| `npm run weekly -- --date 2026-10-24` | Produce that week's issue (defaults to today). Re-running a week that already has a draft does nothing unless you add `--force`. |
| `npm run analytics` | Pull stats for sent issues |
| `npm run doctor` | Show which keys and services are configured |
| `npm start` | Trigger server for n8n: `POST /run/{daily,weekly,analytics}`, `GET /runs/:id`, `GET /health` |
| `npm test` | 25 tests: brief §13 acceptance tests, full simulated cycles on local files and on Airtable, n8n checks |

Exit codes: `0` ok · `2` issue blocked by the quality gate · `1` error.

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
| Sections, word target, banned superlatives, price freshness (72h) | `config/newsletter.json` |
| Agent behaviour | `prompts/*.md` (keep output shapes in line with `schemas/`) |
| Models, search/fetch limits, budget caps, API prices | `config/runtime.json`. Re-check prices on Anthropic's pricing page when models change. |
| Mohil's takes | `notes/<issue-date>.md` or the Issues row's `mohil_notes` field |
| Gate rules | `lib/quality_gate.js`, and add a test for each new rule |

## What the code enforces (not just the prompts)

- **Evidence is real.** Claude's evidence URLs are checked against the pages it actually retrieved in that call.
  Anything else is stripped and the claim becomes *unverified*, which the writer can't use. Pricing, benchmark and
  funding claims need a page that was actually fetched.
- **Prices are fresh and official.** "Checked on" times come from the fetch, not the model. A price only counts if
  its page is on the vendor's domain. Stored research with prices older than 72 hours is re-fetched on re-runs.
- **Dates are event dates.** Crawl dates are ignored for the issue window.
- **Fact check is independent.** It runs on a different model (Opus) than the writer, and FAIL is recomputed in
  code from the table.
- **The gate blocks** unsourced links, unverified claims, stale or unofficial prices, prices without a checked
  date, out-of-window stories, repeated story angles, unsupported "best / first / largest / Nx", unlabelled ROI
  dollars, workflows without a human review step, tool picks without audience / skip / verdict, and missing
  required sections.
- **Nothing can publish.** beehiiv payloads are always `draft`; scheduling and recipient fields are refused; only
  "create post" and "get post" calls are allowed; n8n workflows never touch beehiiv.
- **Cost is capped.** Every call is estimated before it's made and recorded after; per-run caps in `runtime.json`.
- **Failures keep the work.** Research, draft and fact check are saved before beehiiv is called. Any failure
  alerts Slack and leaves the issue ready to paste.

## Manual fallback

If the Claude API is down: run each prompt in `prompts/` by hand in Claude and paste results into Airtable.
If beehiiv is down or not on a supporting plan: paste `out/<date>/issue.html` into a new beehiiv post.

## Not yet verified against live services

Every path is tested against simulated APIs that follow the official docs, but no live run has happened yet:
the first `npm run daily` and `npm run weekly` with real keys are that check. The RSS URLs in `sources.csv` are a
starting list; the daily run reports any that fail.
