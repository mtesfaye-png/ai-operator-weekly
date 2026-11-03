# Final demonstration checklist (for Mohil)

Everything below was verified on November 3, 2026, at 22:47 UTC, from GitHub's API and by reading the Airtable base directly.

## Links to have open
| Tab | Link |
|---|---|
| Demo page | https://claude.ai/artifact/69VXJKKaT6RtpWMqhPVnTh (private: share it from its Share menu) |
| Run button | https://github.com/mtesfaye-png/ai-operator-weekly/actions/workflows/rss-collect.yml |
| n8n Cloud run (the proof) | https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41733527751 |
| Airtable | https://airtable.com/appYiy5hPq7BNDosa → **Articles** |
| n8n Cloud | your workspace → **AI Operator Weekly - Cloud collect (GitHub Actions → Airtable)** |
| Newsletter files | https://github.com/mtesfaye-png/ai-operator-weekly/tree/main/demo/2026-11-03 |
| beehiiv | https://app.beehiiv.com → **Posts** |

## Before the demo (5 minutes)
- [ ] The beehiiv draft exists and shows status **Draft**, with nothing scheduled.
- [ ] You're signed in to GitHub, Airtable, n8n Cloud and beehiiv in the same browser.
- [ ] In Airtable's **Articles** table, sort by `first_seen_at`, newest first.
- [ ] Don't add a schedule in n8n. GitHub Actions is the only daily scheduler.

## Live demonstration
- [ ] **1. Start it from the browser.** In n8n Cloud, click **Execute workflow**. Nodes light up in about 40 seconds.
- [ ] **2. Show the GitHub run.** Open the Actions list: the newest run is **RSS collect · n8n-cloud** with a green tick. Open it to show the summary table, including **Paid API calls: 0**.
- [ ] **3. Show the articles.** In n8n, double-click **Newest articles (result)** to show 10 articles from Airtable. Then open Airtable → **Articles** and show the same rows, marked `verification_status: unverified`.
- [ ] **4. Show duplicate prevention.** Run it once more: only genuinely new articles are added. The demo page's runs table shows 89 → 89 with writes enabled.
- [ ] **5. Open the newsletter.** Scroll to it on the demo page. Show the sources under each story, the prices "checked Nov 3", the **Estimate** label, and `sources.md`.
- [ ] **6. Show the beehiiv draft.** Posts → the post → status **Draft**.
- [ ] **7. Show the approval gate.** Point to the **EDITOR REVIEW REQUIRED** box and the **[DRAFT TAKE]** markers. Nothing can publish; Mohil clicks Publish in beehiiv.

## Today's verified runs
| Run | Started by | Result | Airtable articles |
|---|---|---|---|
| [41673616802](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41673616802) | n8n test (Claude's session) | Stopped at the secrets check, as designed (secrets not set yet) | 51 |
| [41675953990](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41675953990) | Run workflow (API) | Success | 51 → 66 |
| [41676187770](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41676187770) | Run workflow (API) | Success | 66 → 81 |
| [41676377849](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41676377849) | n8n test (Claude's session) | Success | 81 → 89 |
| [41676519089](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41676519089) | Run workflow (API) | Success | 89 → 89 (0 new, 0 duplicates) |
| [41728080038](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41728080038) | Run workflow (API), label check | Success | 89 → 104 |
| [41733527751](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41733527751) | **n8n Cloud** (`mtesfaye-png`) | **Success**, all 11 steps | 104 → 110 |

**Final state:** 110 articles, 110 unique article IDs, 0 duplicates. 139 of the 1,000 records Airtable Free allows.

**Paid calls:** 0 Anthropic and 0 beehiiv.
- The workflow receives only the `AIRTABLE_TOKEN` and `AIRTABLE_BASE_ID` secrets, which a test enforces.
- `collect` refuses `api.anthropic.com` and `api.beehiiv.com` at the network level.

## Original assignment: what is operational
| # | Requirement | Status | What's still needed |
|---|---|---|---|
| 1 | Automation: find → research/rank → verify → write → beehiiv draft | **Partly.** *Find* is fully automated (RSS → Airtable). Research, ranking, verification and writing were done once in a Claude Code session for this demo | Paid Anthropic API credits for the automated Scout, Researcher, Writer and Fact Checker, which are already built and tested offline |
| 2a | Anthropic connected | Not connected | An API key, a workspace spend limit, and web search enabled (paid) |
| 2b | Airtable connected | **Fully live** | Nothing (Free plan; archive old rows monthly) |
| 2c | beehiiv connected | **Manual draft.** The one-draft API workflow is built and tested offline, never run live | The Pro or Enterprise plan for the Create Post API (paid), or keep importing by hand |
| 2d | n8n orchestration | **Fully live** on the n8n Cloud trial (manual trigger, monitoring, Airtable read-back) | After the 14-day trial: a paid n8n plan or self-hosting, if n8n is to stay. GitHub Actions keeps the schedule either way |
| 2e | Hosting | **Not needed for collection.** GitHub Actions runs it for free | For the Claude pipeline: GitHub Actions can run it too, once API keys exist |
| 2f | Alerts | **Partly.** GitHub emails on failed runs, and n8n shows red executions | Slack is optional, via a free incoming webhook |
| 3 | Content covers the brief (news, tools + pricing, workflows, ROI, risks, recommendations) | **Met for this issue.** 12 of 13 sections, each fact sourced, prices checked, estimates labelled | Automating it each week needs the paid API |
| 4 | Real end-to-end demo (start → finished beehiiv draft) | **Partly.** Start → collection → Airtable → n8n read-back is live. The draft step is manual | The paid API (writing) and the beehiiv plan (API draft) |
| 5 | Walkthrough of every component | **Met** | `DEMO_GUIDE.md`, `docs/N8N_CLOUD_SETUP.md`, `OPERATOR_HANDOFF.md` |
| 6 | Operating manual with real screenshots | **Partly.** There are real screenshots of the newsletter and n8n | GitHub, Airtable, beehiiv and n8n Cloud screenshots, which need your logged-in browser; take them during the demo |
| 7 | Nothing publishes without Mohil | **Met** | The code only creates drafts, the issue carries a review box, and Mohil publishes in beehiiv |
