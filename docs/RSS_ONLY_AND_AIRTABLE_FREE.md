# RSS-only collection and Airtable Free

A $0 way to run the project before any Claude API credit is available.

## 1. RSS-only collection (`collect`)

```
node src/cli.js collect            # last 3 days (config/runtime.json → limits.collect.lookback_days)
node src/cli.js collect --days 7
```

What it does:

- Reads the active sources (`config/sources.csv`, or the Airtable **Sources** table once Airtable is set up)
  and fetches every public RSS/Atom feed. Sources without a feed (Reuters, Bloomberg, Product Hunt, …) are
  listed in `sources_without_rss` and skipped. They need web search later.
- Normalizes each item into an **article**: title, URL, normalized URL, source, tier, the source's configured
  category, published time and date (newsletter time zone), and the feed's own teaser text (`feed_excerpt`).
  The teaser is unverified publisher text, capped at 500 characters.
- Deduplicates deterministically:
  - **Same URL**: after removing `www.`, `utm_*`/`ref` parameters, `#fragments` and trailing slashes. The
    copy is dropped (`url_duplicates_in_run`) or recognized as already stored (`already_stored`).
  - **Same headline**: identical after folding case and punctuation, at least 4 words. The later or lower-tier
    copy is saved with `status: duplicate`, `duplicate_of` and `duplicate_reason: same_title`.
  - Near-duplicates (same event, different wording) are **not** guessed. That needs the Claude Scout.
- Saves to `data/articles.json` (always) and prints a JSON report covering working and failed feeds, counts,
  date range, duplicates, saved records and five examples.

What it does **not** do: there are no scores, story category, companies, summary, research or fact-check.
Every article carries `claude_status: pending`, `verification_status: unverified` and
`requires_claude: ai_scores, story_category, companies, factual_summary, research, fact_check`.

### Zero paid calls

- `collect` never loads the Claude client, and its budget is 0 calls / $0.
- At the network layer it refuses `api.anthropic.com` (and any `AOW_ANTHROPIC_BASE_URL` host) and
  `api.beehiiv.com`. Every run reports `network.attempts_by_host`, `paid_api_calls: 0` and
  `blocked_paid_attempts`.
- beehiiv, n8n and Slack are not used. Alerts print to the console unless `SLACK_WEBHOOK_URL` is set.
- `tests/collect.test.js` checks all of this.

### Where to run it

Any machine with Node 20+ and normal internet access, e.g. your Windows PC:

```
cd ai-operator-weekly
node src/cli.js collect
```

In a Claude Code cloud session, the environment's network policy must allow the feed hosts:
`openai.com, deepmind.google, blog.google, blogs.microsoft.com, blogs.nvidia.com, huggingface.co,
github.blog, techcrunch.com, www.theverge.com, venturebeat.com, importai.substack.com, latent.space,
hnrss.org, www.reddit.com` (plus `api.airtable.com` for Airtable). See
https://code.claude.com/docs/en/cloud-environments#network-access. Node's built-in `fetch` only uses the
session's proxy with `NODE_USE_ENV_PROXY=1`, so there run `NODE_USE_ENV_PROXY=1 node src/cli.js collect`.

Known feed issues (2026-10-27): VentureBeat answers automated clients with a Vercel bot challenge (HTTP 429),
so it fails from scripts. Microsoft's `/ai/feed/` is gone (410), so the whole Official Microsoft Blog feed is used
instead and includes some non-AI posts. Hugging Face's feed has no descriptions, so `feed_excerpt` is empty.

## 2. Labels on every article

| Field | Values | Meaning |
|---|---|---|
| `signal_type` | `primary_source` (tier 1), `news_reporting` (tier 2), `discovery_unverified` (tier 3), `community_unverified` (tier 4) | Reddit, Hacker News and newsletters are discovery signals only: never cite them, trace to the original |
| `topic_check` | `ai_feed`, `keyword_match`, `off_topic_flagged` | Feeds in `limits.collect.mixed_topic_domains` (Microsoft, NVIDIA, GitHub Changelog) get a deterministic AI-keyword check. Off-topic items are kept but flagged |
| `editorial_candidate` | true/false (+ local `candidate_note`) | Tier ≤ `candidate_max_tier` (2), not off-topic, not a duplicate |
| `ranking_status`, `research_status`, `fact_check_status` | `pending_claude` | Nothing has been ranked, researched or fact-checked yet |
| `verification_status` | `unverified` | Feed text is the publisher's own claim |

## 3. Airtable Free

### What the Free plan allows

Check these on Airtable's pricing page and **Workspace settings → Summary**.

- **1,000 records per base**, counted across all tables.
- **1,000 API calls per workspace per month.** Going over starts a one-time 30-day grace period. After that, calls
  over the limit are blocked until the 1st of the next month.
- **5 requests/second per base.**
- **10 records per write.**
- Every field type in `airtable/schema.json` is a basic type: text, number, URL, checkbox, date, single select,
  currency, percent. Personal access tokens are available on all plans.
- **Not confirmed:** whether Free allows creating a base through the API. If it doesn't, create an empty base by
  hand and the setup script adds the tables to it (see step 6).

### How the app stays inside it

- **Full archive stays local.** All articles are kept in `data/articles.json`. Only editorial candidates are
  mirrored: at most `airtable_max_new_per_run` (15) per run, tier 1 first, newest first, from the last 7 days.
- **Record budget.** `runtime.json → airtable.record_budget` is 900. Sources rows plus mirrored articles count
  against it, and the app stops adding rows when it's reached. To free space, delete old Articles rows in the
  Airtable UI (UI deletes don't cost API calls). The local estimate is conservative and won't notice the
  deletes, so after deleting, raise the budget or reset `airtable_synced_at` locally.
- **Call budget.** `airtable.monthly_call_budget` is 800. Every Airtable request is counted in
  `data/airtable_usage.json`. At the budget, `collect` reads sources from `config/sources.csv`, makes no Airtable
  calls, and keeps candidates queued locally.
- **Calls per run.** A normal `collect` run uses 1 call (read Sources) plus 1–2 calls (upsert ≤ 15 Articles).
  The Run Log stays local. Daily runs come to about 90 calls a month.
- **No duplicates, no losses.** Upserts merge on `article_id`. A batch is marked synced only after Airtable accepts
  it. A failed sync leaves articles queued locally and is retried next run. The 429 "billing limit" error stops
  at once instead of retrying.
- **Restarts.** If `data/airtable_sync_state.json` is missing (new cloud container, new machine) or names a
  different base, `collect` first reads the base's article IDs (1 call per 100 rows, fields `article_id` only)
  and marks those local articles as synced, before writing anything. If that read fails, nothing is written that
  run and candidates stay queued locally. A lost archive costs at most one extra read, never duplicates.
- **API counter.** `data/airtable_usage.json` only counts this machine's calls and restarts at 0 in a new
  container. Airtable's own count in **Workspace settings → Summary** is the authoritative figure.
- **Initial import.** Use `--max-sync N` to lower the per-run cap, e.g. `collect --days 7 --max-sync 10`.
  It can't raise the cap.

### Setup, step by step (≈ 4–15 API calls, once)

1. **Account.** Go to airtable.com and sign up with email, Google or Microsoft. If asked to pick a plan, choose
   **Free**. Close any "Start a free trial of Team" prompt and never enter card details.
2. **Workspace.** A default workspace is created for you. Open it from the Home screen and copy the
   `wsp…` ID from the browser address bar (`airtable.com/workspaces/wspXXXXXXXX`).
3. **Personal access token.** Open https://airtable.com/create/tokens, then **Create token**.
   - Name: `ai-operator-weekly`
   - Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`
   - Access: **Add a base → All current and future bases in workspace "<your workspace>"**
   - Click **Create token**, then copy the `pat…` value. It is shown once.
   - Keep it secret: don't paste it into chat, email, screenshots or a commit.
4. **Store it locally.** In the project folder, create or edit `.env` (it's in `.gitignore`):
   ```
   AIRTABLE_TOKEN=pat...
   AIRTABLE_WORKSPACE_ID=wsp...
   ```
   In a Claude Code cloud session, add both as **environment variables** named exactly `AIRTABLE_TOKEN` and
   `AIRTABLE_WORKSPACE_ID` (environment menu in the session title bar → Edit), not in chat. Also add
   `api.airtable.com` (and `latent.space`) under Allowed domains. Start a new session afterwards: running
   sessions don't pick up changes.
5. **Preview.** Run `npm run airtable:dry`. It makes no calls.
6. **Create the tables.** Run `npm run airtable:setup` (≈ 4 calls). It prints `AIRTABLE_BASE_ID=app…`. Add that line to `.env`.
   - If base creation is refused on Free, create an empty base named **AI Operator Weekly** in the
     workspace, copy its `app…` ID from the URL, put `AIRTABLE_BASE_ID=app…` in `.env`, and run the same command
     again. It adds the 10 tables to that base (≈ 15 calls). Then delete the default "Table 1".
   - Re-running is safe: existing tables are skipped and Sources are upserted on `domain`.
7. **Narrow the token.** Optionally, edit it so it can only access the new base.
8. **First sync.** Run `npm run doctor`, then `node src/cli.js collect --days 7` (≈ 3 calls; up to 15 articles).
9. **Verify.** Run `node src/cli.js airtable-check` (1 call). It should report `missing_in_airtable: 0` and
   `duplicate_article_ids: 0`. In Airtable, open **Articles** and add views (the UI is free, no API calls):
   - Grid view, filter `editorial_candidate` is checked and `signal_type` is `primary_source`, sorted by `published_at` descending.
   - Group by `source`.

Note: with Airtable configured, the Claude-based `daily`/`weekly` workflows would also use Airtable. They stay off
until Claude API access exists.
