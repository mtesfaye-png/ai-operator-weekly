# How it all connects, plus the Loom script

```
                 Mohil at the Mac 30 min, no meeting (checked every 5 min)
                                     │
                          deploy/mac/gate.js (scheduler)
                                     │  webhook (token)
                                     ▼
                         n8n  http://localhost:5678
           collect · daily scout · weekly production · analytics workflows
                                     │  HTTP (token), 127.0.0.1 only
                                     ▼
                  AOW pipeline service  src/server.js :8787
   ┌──────────────┬──────────────┬───────────────┬──────────────┬───────────────┐
   RSS feeds      Claude Scout   Claude Research  Claude Writer  Claude Fact-check
   (free)         (score)        (sources+price)  (13 sections)  (Opus, stricter)
                                     │
                         Quality gate (code, not AI)
                     pass ▼                      ▼ fail
            beehiiv DRAFT (never sent)      alert + draft kept for fixing
                     │
           "Draft ready" alert → Mohil reviews, edits, SENDS by hand
                     │
              Analytics next day → Performance → informs next week

  Airtable (shared database) ← every step reads/writes Stories, Scores, Research, Issues, Run Log
  Alerts → Mac notification + email (Gmail)       Backups → Sundays, last 8 kept
```

## Loom script (about 6 minutes)

1. **The promise (30s).** One email a week: what changed in AI, what to use, what it costs, where the money is.
   Built to be 90–95% automatic, but it never sends anything by itself.
2. **Airtable (1 min).** Show Sources (tiers 1–4, untick to pause), Stories (today's candidates and scores),
   Issues (the weekly issue row, subject options, gate result, beehiiv post id).
3. **When it runs (45s).** Run `deploy/mac/gate.js --status`: active minutes, meeting check, what's due.
   Explain why it isn't on fixed times: the Mac sleeps.
4. **n8n (1 min).** Show the four workflows and the weekly one: start, wait 10 minutes, check, alert on failure.
   Open Executions to show a past run.
5. **One weekly run (2 min).** Start the weekly run with `node src/cli.js weekly` (costs about $4–7) and follow
   `logs/aow.log`: picks 5 stories with a mix of topics, research drops evidence that isn't from official
   pricing pages, the writer drafts, the fact-checker checks every claim, the gate passes or blocks with reasons.
6. **The draft (1 min).** Open the beehiiv draft: the red EDITOR REVIEW box, highlighted [DRAFT TAKE]s, sources
   under every story, prices with "checked on" dates. Delete the box, pick a subject, send.
7. **Safety (30s).** Draft only; the $25 Claude cap; alerts; backups; `setup.sh` without `--paid` turns every
   paid step off.
