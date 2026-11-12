# AI Operator Weekly: operator handoff (for Mohil)

## What runs by itself
- **Every day**, GitHub Actions reads 14 public AI news feeds and drops duplicates. It's scheduled for 7:17am New York time, but GitHub has started it between 12:44pm and 5:21pm (Nov 4–12). That's normal for GitHub's free scheduler.
- It adds up to **15 new editorial candidates per run** to Airtable, in the **AI Operator Weekly → Articles** table.
- It costs $0, uses no AI, and never publishes anything.
- If a run fails, GitHub emails the repository's watchers.

## Your 2-minute morning check
1. Open Airtable → **AI Operator Weekly** → **Articles**, sorted by `first_seen_at`, newest first.
2. Skim the new rows. Everything is marked `verification_status: unverified`: it's the publisher's own text, a lead to check, not a fact.
3. Optional: open https://github.com/mtesfaye-png/ai-operator-weekly/actions. Today's **RSS collect · daily schedule** run should show a green tick. Check after about 6pm New York time, since GitHub starts it late.

## Run a collection on demand
Use either route:
- **GitHub:** go to https://github.com/mtesfaye-png/ai-operator-weekly/actions/workflows/rss-collect.yml → **Run workflow** → **Run workflow**. It finishes in about 30 seconds.
- **n8n Cloud:** open **AI Operator Weekly - Cloud collect** → **Execute workflow**. n8n starts the same GitHub run (named **RSS collect · n8n-cloud**), waits for it, and shows the 10 newest articles. Verified live on Nov 3 ([run 41733527751](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41733527751)).

Running it again is safe: you get only genuinely new articles and never duplicates.

## Producing and sending an issue (you approve everything)
1. The issue draft is written and checked against its sources. For this demo, that was done in a Claude Code session; the automatic writer needs paid API credits.
2. The files are in `demo/<date>/`:
   - `issue.html`: the page to read and paste from
   - `issue.md`: the editable text
   - `subjects.md`: subject lines and preview text
   - `sources.md`: what was checked, and how
3. In beehiiv: **Posts → Start writing**. Paste the issue, then set the subject and preview text. It stays a **Draft**.
4. **Your edits before sending:**
   - Rewrite or approve every **[DRAFT TAKE - Mohil to confirm]** line.
   - Confirm the verdicts and any **Estimate**.
   - Spot-check the sources the log marks *Reported* or *Not opened*.
   - Delete the **EDITOR REVIEW REQUIRED** box.
5. **You click Publish or Schedule in beehiiv.** Nothing in this system can publish, schedule or send.

## If something goes wrong
| You see | Do this |
|---|---|
| A red run in GitHub Actions | Open it. The first red step names the problem. A missing or expired `AIRTABLE_TOKEN` is the usual cause: Settings → Secrets and variables → Actions → update it |
| A red execution in n8n | Open **Executions** and click it. The red node's message says which credential or step failed (see `docs/N8N_CLOUD_SETUP.md`, section 7) |
| Nothing new in Airtable | That's normal when no source has published since the last run |
| A non-AI story in Articles | Feeds aren't topic-filtered. Ignore it or delete the row |

## Limits and costs
- **Airtable Free:** 1,000 records per base and 1,000 API calls a month.
  - The app stops adding rows at 900 records and stops calling Airtable at 800 calls.
  - On Nov 12: 367 records (268 articles, 32 sources and Mohil's imported stories, scores and research). Articles grow by about 17 a day, so archive old Articles rows when the total passes about 700 (around early December). Each run uses about 4 calls.
  - To make room, download a CSV of old Articles rows from a filtered view, then delete those rows in Airtable. Deleting in the Airtable UI costs no API calls.
- **GitHub Actions:** about 1 minute per run, out of 2,000 free minutes a month for private repos.
- **n8n Cloud trial:** 14 days and 1,000 executions, then it expires. Don't upgrade without approval; the workflow file stays in GitHub.
- **Don't:**
  - add a schedule in n8n (GitHub already runs one),
  - add Anthropic or beehiiv keys to anything,
  - share the tokens.

## Where things are
- **Code and workflows:** https://github.com/mtesfaye-png/ai-operator-weekly
  - `.github/workflows/rss-collect.yml`: the daily collection
  - `n8n/cloud-demo.json`: the n8n workflow
- **Demo checklist and requirement status:** `demo/FINAL_CHECKLIST.md`
- **Setup and demo steps:**
  - `docs/N8N_CLOUD_SETUP.md`: n8n Cloud
  - `demo/DEMO_GUIDE.md`: the browser demo
