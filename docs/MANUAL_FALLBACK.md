# Manual fallback: getting an issue out when something is down

Nothing in this system can send an email. Every issue ends as a beehiiv **draft**, and Mohil sends it.
When a piece is down, the steps below still get an issue out. You'll get an alert by Mac notification
(and by email once the Gmail app password is set). Check `~/Operator-Weekly-AI-work/logs/aow.log` for details.

## Which part is down?

| Symptom | Likely cause | Do this |
|---|---|---|
| Alert: `Claude API 401` | Key revoked or wrong | Create a new key in the Claude Console, in the **Newsletter** workspace. Save it with `deploy/mac/set-secrets.sh` |
| Alert: spend limit / `429` from Claude | $25 Newsletter workspace limit reached, or rate limit | Raise the limit in Console → Spend limits, or wait until the 1st of the month |
| Alert: `BLOCKED by the quality gate` | The gate found a real problem (missing source, stale price, missing section) | Read the reasons in the alert. Fix the draft by hand, or rerun with `node src/cli.js weekly --force` once the cause is fixed |
| Alert: `Airtable 401/403/422` | Token expired, base renamed, or the Free plan limit reached | Check the token at airtable.com/create/tokens. Run `node src/cli.js airtable-status` for the record count |
| No beehiiv draft, but alert says "paste issue.html" | beehiiv API not set up or not on a supporting plan | Paste the issue by hand (below) |
| No alerts and nothing happening | Mac asleep, or not used for 30 minutes in a row since 6am, or in a meeting | Normal: it runs once you're at the Mac. Check with `deploy/mac/setup.sh --status` |
| `setup.sh --status` shows a service not running | A crash, or launchd agents removed | Run `deploy/mac/setup.sh --paid` again (safe to repeat) |

## Paste an issue into beehiiv by hand

1. Open `~/Operator-Weekly-AI-work/repo/out/<issue-date>/preview.html` in a browser to read it.
2. In beehiiv, create a new post from your template.
3. Open `out/<issue-date>/issue.html`, copy everything, and paste it into the post's HTML block.
4. Subject line and preview text options are at the top of `out/<issue-date>/issue.md`.
5. Delete the **EDITOR REVIEW REQUIRED** box (if there is one) once you've dealt with each item in it.
6. Review, edit and send as usual.

## Write an issue without the Claude API

If the API is down for the whole weekend:

1. The week's candidate stories are in Airtable → **Stories**, sorted by `total_score`.
2. Paste the top stories into Claude (claude.ai) with the four prompts from `prompts/`, in this order:
   `researcher.md` → `writer.md` → `fact_checker.md`. Paste each step's output into the next one.
3. Check every price on the vendor's own pricing page and note the date checked.
4. Paste the final copy into beehiiv as above.

## Restore from a backup

Weekly backups (the last 8) are in `~/Operator-Weekly-AI-work/backups/<date>/`:

- `airtable/*.json`: every table, as returned by the Airtable API;
- `data/` and `out/`: the local archive and every generated issue;
- `n8n-workflows.json`: re-import with the n8n CLI (`import:workflow`).

Rows removed from Airtable by the weekly clean-up (old, unused articles and stories) are only in these files.
