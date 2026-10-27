# First controlled live test: `doctor` + `daily`, Anthropic only

This first test connects **only the Anthropic API**. Airtable, beehiiv, Slack and n8n stay disconnected:
- Stories are stored as local JSON in `data/`.
- Alerts print to the terminal.
- `daily` never touches beehiiv.

Besides Anthropic, the run reads about 16 public RSS feeds from `config/sources.csv`. Those need no account and cost nothing.

## Expected cost

One `daily` run makes one Scout request to `claude-sonnet-5-5` (about $2 input / $10 output per million
tokens) with up to 10 web searches (about $0.01 each). The app may add up to 4 `pause_turn` continuations and one JSON
repair. A typical run should cost **$0.10–$0.60**.

## Budget: two layers, and why the app's cap is not enough

1. **App-side cap (an estimate).** Before each request the app estimates the cost and refuses to send it if the
   run's total would pass the cap. Afterwards it records what Anthropic reports. The estimate uses the prices in
   `config/runtime.json`. It **cannot stop a request already in progress**: one request with many web searches
   can cost more than the estimate. It is a guard against runaway loops, not a spending limit.
   For this test, lower it with `AOW_MAX_USD=2`. That setting can lower the cap, never raise it.
2. **Provider-side limit (the real one).** Set a spend limit in the Claude Console. Ideally create a
   separate workspace for this project, with its own API key and a low monthly limit such as **$5**. Then even a
   bug can't spend more than that. Look under the Console's settings for workspaces and limits.

Also confirm in the Console that **web search is enabled** for your organization (an admin setting). If it isn't,
the Scout request fails with an error and costs nothing.

## Option A: run it on your own computer (recommended)

You need Node.js 20 or newer. Run these from the unzipped `ai-operator-weekly/` folder.

```bash
cd ai-operator-weekly
npm test                      # offline, free; expect "# pass 71" and "# fail 0"

# 1. Make sure nothing else is connected in this shell
unset AIRTABLE_TOKEN AIRTABLE_BASE_ID BEEHIIV_API_KEY BEEHIIV_PUBLICATION_ID BEEHIIV_POST_TEMPLATE_ID SLACK_WEBHOOK_URL

# 2. Enter the key without it appearing on screen, in shell history, or in a file:
read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
#    (paste the key, press Enter; nothing is echoed)

# 3. Lower the app-side cap for this test
export AOW_MAX_USD=2

# 4. Check the configuration (free, no network calls)
npm run doctor
```

`doctor` should show:
- `✔ ANTHROPIC_API_KEY`, and `✘` on every other line;
- `daily $2 / 8 calls (lowered by AOW_MAX_USD)`;
- `Daily run will contact: Anthropic API, public RSS feeds (no account).`

It never prints the key. **Stop here and check this output before spending anything.**

```bash
# 5. The paid step: only after you've approved it
npm run daily 2>&1 | tee daily-first-run.log
echo "exit code: ${PIPESTATUS[0]}"

# 6. Remove the key from the shell when done
unset ANTHROPIC_API_KEY AOW_MAX_USD
```

If you'd rather keep the key in a file: `cp .env.example .env`, put it after `ANTHROPIC_API_KEY=` in a text editor
(not with `echo`, which leaves it in shell history), then run `chmod 600 .env`. `.env` is in `.gitignore` and in no
archive. Leave every other line in it blank.

Never paste the key into a chat, an issue, a commit or a log.

## Option B: have Claude run it in the cloud session

1. Push the project to a private GitHub repository. A new cloud session can't see this container's files.
2. Add `ANTHROPIC_API_KEY` in the cloud environment's settings (the environment menu in the session's title bar →
   Edit → network secrets / environment variables). Never paste it into the chat.
3. Start a new session on that repository. Ask Claude to run `AOW_MAX_USD=2 npm run doctor`, then, after you
   approve, `AOW_MAX_USD=2 npm run daily`.

## What a good result looks like

- Exit code `0`. The JSON printed at the end shows `new_or_updated` > 0, plus a `budget` block with `calls` (usually
  1–3) and `est_usd`.
- `data/stories.json` holds 8–20 stories, each with a real `primary_url`, an `event_date` inside the last 2 days,
  and scores.
- `data/run_log.json` has one record with status `ok`.
- `RSS: … failed` lines and `Feed failures:` warnings are expected for a few feeds. Note which ones fail, so
  `config/sources.csv` can be fixed later.
- Compare `est_usd` with the usage the Claude Console shows for the key. If they differ a lot, the
  prices in `config/runtime.json` need updating.

## If it fails

The run stops and nothing is published (daily has no publishing step). Send me the last 30 lines of
`daily-first-run.log`, with the key removed if it somehow appears; it shouldn't.

| Error | Likely cause |
|---|---|
| `Claude API 401` | Wrong or revoked key |
| `Claude API 400 … tools` / `web_search` | Web search isn't enabled in the Console, or the tool version isn't available to the account |
| `Claude API 400 … fallbacks` / `anthropic-beta` | Set `"refusal_fallback": null` in `config/runtime.json` and retry |
| `Claude API 400 … output_config` / `effort` | Remove the `effort` block in `config/runtime.json` and retry |
| `BUDGET: … cap` | The app-side cap stopped further requests; nothing else is wrong |
| `still paused after 4 continuations` | Lower `scout_max_searches` in `config/runtime.json` |
