# Stage 3: daily RSS collection with n8n on your Windows PC ($0)

Following along step by step? Use [RUNBOOK.md](RUNBOOK.md): it covers this setup and every phase after it.

n8n runs on your own PC and starts the free RSS collection every morning. New articles go into the existing
Airtable base (`appYiy5hPq7BNDosa`). Claude Code and the cloud container aren't involved, and nothing paid is used.

## How it fits together

```
Windows PC (Docker Desktop)
┌────────────────────────────────────────────────────────────────────────────┐
│  n8n container (Community Edition 2.44.7)        aow container (this repo) │
│  - schedule: every day 7:05am ET                 - trigger server, allows   │
│  - "Execute workflow" button for tests             ONLY /run/collect        │
│  - execution log (90 days)    ── POST /run/collect ──►  - RSS feeds → dedupe │
│  - optional free alert           Bearer token          - Airtable upsert    │
│  http://localhost:5678                              http://localhost:8787   │
│  volume: n8n_data                                   volume: aow_data        │
└────────────────────────────────────────────────────────────────────────────┘
          both ports bound to 127.0.0.1: unreachable from your network
                                   │
                    public RSS feeds + api.airtable.com (existing base)
```

| Piece | What it does | Where its data lives |
|---|---|---|
| **aow** container | The repo's trigger server. It can only start `collect`: `/run/daily`, `/run/weekly` and `/run/analytics` answer 403. It has no Anthropic or beehiiv keys. | Volume `aow_data`: article archive, Airtable sync state, API-call ledger, run log |
| **n8n** container | Schedule, manual test button, execution log, failure alert | Volume `n8n_data`: workflows, encrypted credential, execution history |
| `deploy\windows\.env` | Airtable token, base ID, trigger token. Created by `setup.ps1`, gitignored, readable only by your Windows user | Your PC only |

**Duplicates can't happen.** Every Airtable write is an upsert on `article_id`. Only one collect runs at a time,
enforced both in the server and with a lock file. If the volume is ever empty (new PC, reinstall), the first run
reads the IDs already in Airtable before it writes anything. All of this was tested against the real base.

## What it costs

- **Docker Desktop:** free for personal use, education, and businesses with **fewer than 250 employees and
  less than $10 million in annual revenue**. Larger organizations need a paid Docker subscription, so ask before
  installing if that applies to Gupta Partners.
- **n8n Community Edition:** free and self-hosted. Don't enter a license key, start a trial, or create an
  n8n Cloud account. None of that is needed.
- **Airtable Free:** about 3 API calls a day (≈ 100 a month, out of the 1,000 allowed). See "Limits" below.
- **No** Anthropic, beehiiv, hosting or n8n Cloud.

## What to install (two things)

1. **Docker Desktop for Windows.** It runs both containers. You need 64-bit Windows 10 (22H2) or 11, about
   4 GB of free RAM and 5 GB of disk. Node.js and n8n don't need installing; they're inside the containers.
2. **Git for Windows.** It downloads this repository, and you sign in to GitHub in your browser on first use.

## Step by step

### 1. Install Docker Desktop
1. Go to https://www.docker.com/products/docker-desktop/ → **Download for Windows (AMD64)**. Use ARM64 only on
   an ARM laptop such as a Surface Pro X.
2. Run the installer. Keep **Use WSL 2 instead of Hyper-V** ticked. Restart Windows if it asks.
3. Open **Docker Desktop** from the Start menu and accept the terms. You can skip signing in ("Continue
   without signing in" / "Skip").
4. Wait until the bottom-left corner says **Engine running**.
5. Settings (gear icon) → **General** → tick **Start Docker Desktop when you sign in to your computer** →
   **Apply**. Otherwise nothing runs after a reboot until you open Docker yourself.

If Docker says virtualization or WSL is missing, follow the link in its message. It usually needs one
restart, or "Virtualization" switched on in the BIOS.

### 2. Install Git
https://git-scm.com/download/win → run the installer → keep every default.

### 3. Download the project
Open **Windows PowerShell** (Start menu → type "PowerShell") and run:
```powershell
cd $HOME\Documents
git clone https://github.com/MatchappAI/Operator-Weekly-AI.git ai-operator-weekly
cd ai-operator-weekly
git checkout stage3-n8n-rss-local     # skip this line once the branch is merged into main
cd deploy\windows
```
A browser window opens the first time so you can sign in to GitHub. The repository is private.

### 4. Run the setup script
Still in `...\ai-operator-weekly\deploy\windows`:
```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```
- **Airtable token:** paste your `pat…` token and press Enter. Nothing appears while you paste; that's
  intentional. You can use the same token you set up in Stage 2.
- **Base ID:** press Enter to accept `appYiy5hPq7BNDosa`, the existing base. The script never creates a base.
- The first build takes a few minutes. It ends with **Open the n8n editor: http://localhost:5678**.

### 5. Open the n8n editor and create your local login
1. Open **http://localhost:5678** in your browser.
2. n8n asks you to **set up an owner account**: email, name, password. The account exists only on your PC and
   isn't an n8n Cloud account. Use a real password; it protects the editor.
3. Skip or close any survey or "unlock paid features" prompt.

### 6. Manual test, before you turn on the schedule
1. On the **Overview** page, open **AI Operator Weekly - RSS Collect (free)**.
2. Click **Execute workflow** at the bottom. If n8n asks which trigger to start from, pick **Run now (manual test)**.
   It takes 10–60 seconds.
3. The nodes turn green. Click **Summarize run** to see the result:
   - `outcome: ok`
   - `new_articles` (saved locally), `synced_to_airtable` (added to Airtable, at most 15 per run)
   - `failed_feeds`: VentureBeat (and sometimes Reddit) block automated readers with HTTP 429. That's expected
     and doesn't count as a failure.
   - `paid_api_calls: 0`
4. In Airtable, open **Articles**: any new rows are there. The first run on a new PC first checks which
   articles Airtable already has, so the existing ones are never duplicated.
5. Click **Execute workflow** again. `synced_to_airtable` should now be `0`, or a few genuinely new articles,
   and nothing in Airtable is repeated.

**Stop here and share the Summarize run output so we can check it together before turning on the schedule.**

### 7. Turn on the daily schedule
Click **Publish** (top right) → **Publish**. From then on it runs every day at **7:05am New York time**,
as long as the PC is on and Docker Desktop is running. If the PC is off at 7:05, that day is skipped. Each run
looks back 3 days, so up to two missed days are picked up by the next run.

## Execution log

- **n8n:** left sidebar → **Executions**, or the workflow's **Executions** tab. Green means succeeded, red means
  failed. Click a run, then **Summarize run**, for the details. Runs are kept for 90 days, both scheduled and manual.
- **Collector:** `docker compose logs aow --tail 50` (run it in `deploy\windows`).
- **Every run's full report** is in the `aow_data` volume (`run_log.json`) and in every backup.

## Failure alerts

A run counts as **failed** (red in Executions) when:
- the collector can't be reached,
- the trigger token is wrong,
- the collection errors,
- Airtable refuses a write (the articles stay queued locally and retry next run), or
- no feed at all can be read.

It counts as a **warning** when Airtable usage reaches 80% of the app's budget or more than 3 feeds fail.

To get a message as well (optional, free):
1. Create an incoming webhook: Slack (https://api.slack.com/messaging/webhooks, free workspace) or a Discord
   channel (Edit channel → Integrations → Webhooks → New Webhook → Copy URL).
2. In n8n, double-click **Alert webhook (optional)** and paste the URL into **URL**.
3. Close the node, right-click it → **Activate** (it's deactivated by default), then save and **Publish** again.
4. For Slack, you can also put the URL in `SLACK_WEBHOOK_URL=` in `deploy\windows\.env`, then run
   `.\setup.ps1 -SkipImport`, so the collector sends its own alerts too.

## Limits: Airtable Free (1,000 records per base, 1,000 API calls per workspace per month)

The app stops itself below both limits. It stops adding rows at **900 records** and stops calling Airtable at
**800 calls a month**, and articles keep collecting locally either way.

| What | How often | How |
|---|---|---|
| Quick check | Every run | **Summarize run** → `records_used_estimate`, `airtable_calls_this_month` |
| Real count (all 10 tables) | Weekly | `docker compose exec aow node src/cli.js airtable-status` (≈ 10 API calls) |
| Authoritative numbers | Monthly | Airtable → your workspace → **Settings → Usage / Summary** (counts every app on the token) |

Expect about 100 calls a month. Expect records to grow by about 10–15 new candidates a day, so the base reaches
the 900 budget after roughly two months. That's what archiving is for.

### Archiving old articles (free, no API calls)
1. In Airtable, open **Articles** → create a grid view filtered on `published_date` *is before* a date
   (for example, 30 days ago).
2. View menu (▾ next to the view name) → **Download CSV**. Keep the file. The complete archive also stays in the
   `aow_data` volume and in your backups.
3. Select all rows in that view → right-click → **Delete selected records**. UI deletes cost no API calls.
4. Run `docker compose exec aow node src/cli.js airtable-status`. It marks those articles as archived locally, so
   the freed records count again, and they are never re-sent.

## Backups
Weekly, with the containers running: `powershell -ExecutionPolicy Bypass -File .\backup.ps1`. It writes to
`deploy\windows\backups\<date-time>\`. The `n8n-home` folder contains your n8n login and encrypted credential,
so keep the backups private. They're gitignored.

## Everyday commands (run in `deploy\windows`)

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Stop / start | `docker compose stop` / `docker compose start` |
| Update after `git pull` | `powershell -ExecutionPolicy Bypass -File .\setup.ps1 -SkipImport` |
| Re-import the workflow after it changed in the repo | `.\setup.ps1` without `-SkipImport`. This **unpublishes** it, so click **Publish** again |
| Collector health | open http://localhost:8787/health → `{"ok":true}` |

## Don't
- **Don't run `docker compose down -v`.** `-v` deletes the volumes: article archive, sync state and n8n.
- Don't import `daily-scout.json`, `weekly-production.json` or `analytics.json` yet. They start paid Claude runs,
  and this collector refuses them anyway.
- Don't run `npm run airtable:setup`. It would create a second base.
- Don't change the ports to anything but `127.0.0.1:…` or open them in Windows Firewall. Remote access comes later,
  with HTTPS.
- Don't commit or share `deploy\windows\.env`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `setup.ps1`: "Docker Desktop is not running" | Open Docker Desktop and wait for **Engine running** |
| `setup.ps1` cannot be loaded / is not digitally signed | Use the full command with `-ExecutionPolicy Bypass` |
| Summarize run: "Collector unreachable" | `docker compose ps`; if `aow` isn't Up: `docker compose up -d`, then `docker compose logs aow` |
| "Trigger token rejected" | Re-run `.\setup.ps1`. It re-imports the credential from `.env` |
| Airtable 401/403 in the message | The token expired or lost access to the base: create a new one, delete `.env`, re-run `setup.ps1` |
| Nothing ran this morning | The PC was asleep or Docker wasn't started. Check that the workflow is **Published** and that Docker starts at sign-in |
| Port 5678 or 8787 already in use | Another program uses it: stop it, or change the left-hand port in `docker-compose.yml` (keep `127.0.0.1:`) |
