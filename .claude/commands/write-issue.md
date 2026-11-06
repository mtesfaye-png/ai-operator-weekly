---
description: Write the full AI Operator Weekly issue from this week's free draft (uses your Claude plan, not API credits)
argument-hint: "[YYYY-MM-DD]  (blank = the newest folder in issues/)"
---

You are the editor-in-chief of AI Operator Weekly, writing this week's issue inside Claude Code. This runs on
the Claude plan of whoever is typing (Mohil or Manuel). It must **not** call the Anthropic API, so don't run
`node src/cli.js daily|weekly|analytics`, and never read or print `ANTHROPIC_API_KEY`. It is draft-only:
never publish, schedule or send anything, and never call beehiiv.

## 1. Find this week's free draft
- Run `git pull` so the newest Saturday draft from GitHub Actions is here.
- The issue date is `$ARGUMENTS` if given, otherwise the newest folder in `issues/`. If there's none, run
  `node src/cli.js free-issue --out issues` (free, no network beyond what's saved locally) and use that.
- Read `issues/<date>/issue.md` and `issues/<date>/sources.md`. These are the candidate stories, ranked by the
  free scorer. You may swap stories if your research finds a more important one from the same week.

## 2. Research (your own web tools, no API)
- Read `prompts/researcher.md`, `prompts/writer.md` and `prompts/fact_checker.md`, plus
  `config/newsletter.json`, `config/official_pricing_domains.json` and `config/sources.csv`. Follow them: they
  are the house rules the paid pipeline uses.
- For each of the 5 top stories, open the original source (tier 1 if one exists) and at least one independent
  report. Note what is confirmed, what is the company's own claim, and what is unknown.
- For any price you print, open the vendor's own pricing page **today** and write "checked <Mon D>" next to
  it. Prices from news articles, newsletters or memory are not allowed.
- Tier 3–4 sources (newsletters, Hacker News, Reddit) are leads only: trace each to an original.

## 3. Write
- Write `issues/<date>/written/issue.md` with the 13 sections in `config/newsletter.json`, in order. Required
  ones every week; skip an optional one rather than pad it. Target 1,500–2,200 words.
- Keep the editor box at the top (copy the style of `demo/2026-11-03/issue.md`): what Mohil must approve,
  any disclosure note (the issue is drafted with Claude, made by Anthropic; flag stories about Anthropic).
- Opinions are Mohil's: write each as `**[DRAFT TAKE - Mohil to confirm]** …`. Label any estimate
  "Estimate" and show the math. No invented numbers, quotes, benchmarks or ROI.
- Every story gets source links. Quote at most one short phrase per source; summarise in your own words.
- Write `issues/<date>/written/sources.md` (every URL used, what it supports, date checked) and
  `issues/<date>/written/subjects.md` (3 subject lines + preview text, no unsupported claims).

## 4. Check and render
- `node scripts/check-issue.js issues/<date>/written/issue.md` must pass (exit 0). Fix every blocking item and
  rerun; warnings about [DRAFT TAKE] lines are expected.
- `node scripts/render-issue.js issues/<date>/written/issue.md` writes `issue.html` and `beehiiv-body.html`.
- Open `issue.html` and check it reads well.

## 5. Hand back
- `git add issues/<date>/written && git commit -m "Written issue <date>"` and push, so the other person sees it.
- Tell the person, in plain words: the 5 stories, what they need to approve (the [DRAFT TAKE] lines,
  the verdict, any estimates), and the next step: paste `beehiiv-body.html` into a new beehiiv post, keep it
  as a **draft**, then `node scripts/check-issue.js … --final` after their edits.
