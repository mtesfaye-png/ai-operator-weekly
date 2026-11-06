# Update for Manuel (from Mohil), November 6, 2026

Hey Manuel, this repo is now the **one home** for AI Operator Weekly. Everything I did on my Mac has been
merged in here, so you have all of it. My old copy (`MatchappAI/Operator-Weekly-AI`) is archived (read-only).
Please keep working here.

## What's new in your repo

1. **Everything from the live runs on my Mac** (my repo's PR #1):
   - real Claude, Airtable and n8n, all tested live;
   - **3 bugs fixed**, with tests:
     1. The Scout threw away most real stories because the prompt never listed the allowed categories.
     2. Research failed on claim labels, for the same reason. The fix now covers every Claude step.
     3. The Writer's whole draft was thrown away because the reader took a code block inside the draft as the answer.
   - email and Mac alerts;
   - weekly Airtable backups, plus clean-up so the base stays under the Free limit;
   - the operating manual PDF with real screenshots (`docs/AI_Operator_Weekly_Operating_Manual.pdf`);
   - `docs/WALKTHROUGH.md`, which has the Loom script.
2. **A free weekly issue, with no AI and no credits.** `node src/cli.js free-issue` ranks the week's collected articles:
   - It scores each one by source tier, how recent it is, how many outlets covered it, and business keywords.
   - It merges the same story from different outlets into one item.
   - It leaves out gaming and other off-topic posts.
   - It builds the issue, with a **[DRAFT TAKE]** box wherever an opinion is needed. It never makes one up.

   A new GitHub Actions workflow, **Weekly free issue**, runs it every Saturday and commits the result to `issues/<date>/`.
   See `issues/2026-11-06/` for the first one.
3. **`/write-issue` in Claude Code.** Open this folder in Claude Code and type `/write-issue`. It turns the free
   draft into the full 13-section issue, using `prompts/` and the pricing rules. It runs on the Claude plan of
   whoever types it, **not** API credits. The command lives in `.claude/commands/write-issue.md`.
4. **`scripts/check-issue.js`** checks a finished issue:
   - every required section is there;
   - no banned claim words ("revolutionary", "the first"…);
   - every price has a "checked <date>";
   - every story has a source link.

   Add `--final` after your edits.
5. **`scripts/copy-airtable.js`** copies one base into another. It does a dry run first, never deletes anything,
   and running it twice adds nothing new.

Paid Claude runs stay **off**: I've used $13.33 of the $25 cap and want to keep the rest. Your daily RSS
collection keeps running on GitHub Actions exactly as you built it, and it's now the only daily collector.

## What I need you to finish

1. **Saturday routine**, every week:
   1. Open `issues/<date>/issue.html`. GitHub builds it every Saturday morning.
   2. Either fill in the [DRAFT TAKE] lines, or run `/write-issue` in Claude Code for the fully written version.
   3. Run `node scripts/check-issue.js issues/<date>/written/issue.md --final`.
   4. Paste `beehiiv-body.html` into a new beehiiv post and leave it as a **draft**. I review it and press Publish.

   This week's (Nov 7) is already written: `issues/2026-11-07/written/`.
2. **n8n Cloud:** let the trial run out. GitHub does the scheduling now.
3. **Later, only with my OK:** the paid AI steps and the beehiiv API (it needs beehiiv's Pro plan).

Already done, so nothing for you here:
- The new Saturday job has been run on GitHub and works.
- Mohil's Airtable data (144 rows) is copied into your base by the one-time "Import Airtable export" job. Your
  base now has 255 of the 1,000 Free records. Your base doesn't have the newer `scores` column on Stories, or the
  `claims`, `pricing` and `packet` columns on Research, so those details stayed in Mohil's old base. Nothing
  needs them for the free newsletter.

## Rules that still hold
- Draft only: nothing publishes or sends automatically.
- No keys in the repo or in chat. Use repository secrets and `.env` only.
- Every fact has a source, and every price has a "checked" date.
- Opinions are marked [DRAFT TAKE] until I approve them.

Thanks for all of this. The build held up really well. Mohil
