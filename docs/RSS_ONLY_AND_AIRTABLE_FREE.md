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
github.blog, techcrunch.com, www.theverge.com, venturebeat.com, importai.substack.com, www.latent.space,
hnrss.org, www.reddit.com` (plus `api.airtable.com` for Airtable). See
https://code.claude.com/docs/en/cloud-environments#network-access.

## 2. Airtable Free

### Free-plan limits that matter here

Check these figures on Airtable's pricing page; they change.

| Limit | Free plan | How this project stays inside it |
|---|---|---|
| API calls | 1,000 per workspace per month | A `collect` run uses ≤ 4 calls (see below), so daily runs use ≈ 120/month |
| Records | 1,000 per base | Only new, non-duplicate articles are mirrored, at most `airtable_max_new_per_run` (20) per run. The full history stays in `data/articles.json` |
| Rate | 5 requests/second per base | The store waits 220 ms between requests |
| Batch size | 10 records per write | Writes go in batches of 10 via `performUpsert` (no read-before-write) |

Calls per `collect` run with Airtable connected:

1. 1 × GET **Sources** (one page, under 100 rows)
2. 0–2 × PATCH **Articles** (upsert, 10 per call, capped at 20 new per run)
3. 1 × POST **Run Log**

Already-mirrored articles are never re-sent: `data/articles.json` remembers `airtable_synced_at`, so no read
is needed to decide. Updating `last_seen_at` stays local. If the monthly cap is hit, Airtable answers 429 with
`PUBLIC_API_BILLING_LIMIT_EXCEEDED`. The store stops at once instead of retrying, because retries would also count.

**Record budget:** 29 Sources plus about 30 Run Log rows per month leave room for about 900 articles. At 20 per day
that is roughly six weeks. Either lower `airtable_max_new_per_run` to 10 in `config/runtime.json`, or delete
old Articles rows in the Airtable UI once a month. UI deletes don't count as API calls.

### Setup (≈ 4 API calls, one time)

1. Sign up for or log in to Airtable on the **Free** plan. Don't start a trial: dismiss any "Try Team"
   prompts, and don't enter payment details.
2. Find your **workspace ID**: open the workspace on airtable.com and copy the `wsp…` part of the URL.
3. Create a **personal access token** at https://airtable.com/create/tokens:
   - Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`
   - Access: that workspace
   - Copy the `pat…` token. It's shown once. Never commit it or paste it into chat.
4. Put it in `.env` in the project folder (git ignores this file):
   ```
   AIRTABLE_TOKEN=pat...
   AIRTABLE_WORKSPACE_ID=wsp...
   ```
5. Preview the schema without calling Airtable: `npm run airtable:dry`.
6. Create the base and seed Sources. This makes 1 call to create the base and 3 calls to seed:
   ```
   node --env-file=.env airtable/setup_airtable.js
   ```
   Don't create the base by hand first. The script creates **AI Operator Weekly** and prints its `app…` ID.
7. Add `AIRTABLE_BASE_ID=app...` to `.env`. Optionally, edit the token's access down to just that base.
8. Run `npm run doctor`, then `node src/cli.js collect`. Check the report's `airtable.synced` and the
   **Articles** table.

Note: with `AIRTABLE_TOKEN` and `AIRTABLE_BASE_ID` set, the Claude-based `daily`/`weekly` workflows would also
use Airtable. They are not run until Claude API access exists.
