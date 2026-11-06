# Integration plan: from simulated pipeline to an operational system

Status as of commit `33bdd3c` (57 offline tests passing). The definition of done is the seven deliverables below.
Nothing here is complete until it has passed its **live** acceptance test.

## 1. Checklist against the seven deliverables

Legend: ✅ done and verified live · 🧪 built, verified only against simulated APIs · ⬜ not started / not connected

| # | Deliverable | Status | What exists | What's missing |
|---|---|---|---|---|
| 1 | Automation: find → research/rank → verify facts + pricing → write → beehiiv draft | 🧪 | Full pipeline in `src/`, quality gate, draft-only beehiiv client, 57 tests | No run against real Claude, Airtable or beehiiv yet |
| 2a | Anthropic / Claude connected | ⬜ | Client, models, web search/fetch, budget caps | API key, Console workspace + spend limit, web search enabled, first live `daily` |
| 2b | Airtable connected | ⬜ | `airtable/schema.json` (9 tables), `setup_airtable.js`, Airtable store | Token, workspace, base created, live read/write check |
| 2c | beehiiv connected | ⬜ | Create Post (draft only), status polling, stats pull | Plan with Create Post API access, API key, publication id, template id, live draft |
| 2d | n8n orchestration + scheduling | 🧪 | 3 importable workflows: daily 6:45, Saturday 7:00 with completion polling and failure alerts, analytics 10:00 | No n8n instance; never imported; placeholders `YOUR-AOW-SERVER` and the Slack URL; credential not created; not activated |
| 2e | Hosting for the pipeline (the "AOW server" n8n calls) | ⬜ | `src/server.js` (authenticated trigger API), `Dockerfile` | No always-on host, no HTTPS address, no persistent volume, no deployment |
| 2g | **Stage 3 (free): RSS-only collection scheduled by n8n on a Windows PC** | 🧪 | `n8n/rss-collect.json` (manual test, daily 7:05 ET, outcome log, optional free alert), collect-only trigger server, `deploy/windows/` (Docker Compose, setup + backup scripts), [WINDOWS_LOCAL_SETUP.md](WINDOWS_LOCAL_SETUP.md). Tested against real n8n 2.44.7 in Docker and the real base: 0 duplicates, 0 paid calls | Install on the Windows PC, manual test together, then Publish |
| 2f | Alerts (Slack) | 🧪 | Server-side Slack alerts, n8n alert nodes | Webhook URL; live alert check |
| 3 | Content covers the 13-section brief (news, tools + pricing, workflows, costs, ROI, risks, recommendations) | 🧪 | Locked 13-section format, writer rules, gate checks, length pass | Never produced from real news. **Decision needed:** only 3 sections are required today; the brief lets the writer drop thin optional sections, but this deliverable says the issue *must* cover tools/pricing, workflows, ROI and risks |
| 4 | Real end-to-end demo: workflow start → finished beehiiv draft | ⬜ | Offline demo only | Needs 2a-2e live, then one n8n-started weekly run |
| 5 | Walkthrough of every component and how it connects | ⬜ | README, BUILD_ORDER, FIRST_LIVE_TEST (developer-level) | Operator-level walkthrough document + recorded walkthrough |
| 6 | Operating manual with real screenshots (run, edit, approve/publish, settings, troubleshooting) | ⬜ | – | All of it; screenshots need the live n8n, Airtable, beehiiv and Slack |
| 7 | Nothing publishes or sends without Mohil | ✅ (by construction) 🧪 (live) | Draft-only payloads, endpoint allow-list, no send route in code or n8n, tests | Live check in beehiiv: post status is Draft and nothing is scheduled |

## 2. Shortest reliable path (existing architecture, no rebuild)

The pipeline runs as one small Node service (`src/server.js`). **n8n is the orchestrator**:
- It owns the schedules.
- It starts each run through the service's authenticated API.
- It polls the run until it finishes.
- It routes failures and "draft ready" notices.
- It is where Mohil presses "Execute" for an on-demand run.

Airtable is the shared database Mohil can see and edit. beehiiv receives drafts only.

**Recommended hosting:** one small always-on Linux server running Docker, with two containers on the same private network:
- **n8n** (self-hosted, community edition) behind HTTPS for Mohil to log in to;
- **the AOW service**, reachable only from n8n (no public endpoint).

That means one bill, one place to look, and persistent disks for both. If you already pay for n8n Cloud, use it instead and host only the AOW service; it then needs its own HTTPS address.

Controlled sequence. Each step ends with its acceptance test, and nothing paid happens without your go-ahead.

| Step | Connect | Paid? | Acceptance test (live) |
|---|---|---|---|
| 0 | Private GitHub repo (source of truth + deploy source) | No | Repo contains `33bdd3c`; CI-free `npm test` passes from a fresh clone |
| 1 | Anthropic (local storage) | ~$0.10–0.60, needs approval | **A1:** `doctor` ✔ key; `daily` exits 0; 8–20 stories in the last 2 days with real primary URLs and scores; `est_usd` within ~25% of Console usage |
| 2 | Airtable | Free (Airtable API) + Step 1 cost again | **A2:** `airtable:setup` creates the base with 9 tables and 29 sources; a `daily` run writes Stories, Scores and Run Log rows visible in the Airtable UI; editing a Source's `active` box changes the next run |
| 3 | beehiiv | Weekly ~$3–8 (cap $20), needs approval | **A3:** `weekly` passes the gate or blocks with clear reasons; a post appears in beehiiv as **Draft** with subject, preview text and a working preview link; Issues row has `beehiiv_post_id` + `preview_url`; nothing scheduled; re-run does not create a second post |
| 4 | Hosting + Slack | Server ~$6–12/month | **A4:** `/health` OK from n8n; a call without the token is refused (401); a Slack test alert arrives; a container restart keeps data |
| 5 | n8n | n8n hosting only | **A5:** the 3 workflows imported, credential set, placeholders replaced; manual "Execute" of Daily finishes and shows in Airtable; a stopped AOW service produces a Slack failure alert; schedules activated with the correct time zone |
| 6 | **End-to-end demo** | Daily + weekly costs, needs approval | **A6:** daily runs on its n8n schedule for at least 2 days → Weekly started from n8n → Draft in beehiiv covering the required sections, with sources, checked prices, workflow, ROI with labelled estimates, risks, and EDITOR REVIEW box as applicable → Mohil reviews, edits and sends manually → next day Analytics fills Performance |
| 7 | Handoff docs | – | **A7:** walkthrough + operating manual with screenshots taken from this live system; a second person can run, edit, approve and troubleshoot using only the manual; recorded demo |

## 3. What I need from you (accounts, credentials, access)

| Item | Used for | How to hand it over |
|---|---|---|
| Private GitHub repo | Keep the code safe; deploy from it; lets a new cloud session see the code | Repo name `owner/repo`; I push |
| Anthropic Console: dedicated workspace, API key, monthly spend limit ~$25 for the integration period, web search enabled | Scout, research, writing, fact check | Environment variable `ANTHROPIC_API_KEY` in the cloud environment settings (never in chat) |
| Airtable: workspace + personal access token with `schema.bases:write`, `data.records:read`, `data.records:write`, limited to that workspace | Database | `AIRTABLE_TOKEN`, `AIRTABLE_WORKSPACE_ID` as environment variables; `AIRTABLE_BASE_ID` after setup |
| beehiiv: confirm the plan includes **Create Post API**; API key; publication id (`pub_…`); optional post template id | Drafts + stats | `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID`, `BEEHIIV_POST_TEMPLATE_ID` |
| n8n: existing instance (Cloud or self-hosted) **or** OK to self-host on the server below | Orchestration | Owner login for me to configure, stored as a secret, or you follow my click-by-click steps |
| An always-on Linux server (VPS) with Docker + a (sub)domain for n8n's HTTPS | Hosting | SSH access for whoever deploys; I provide `docker-compose` + steps |
| Slack incoming-webhook URL for the alerts channel | Alerts | `SLACK_WEBHOOK_URL` as an environment variable and in n8n |
| `AOW_TRIGGER_TOKEN`: a long random string you generate | n8n → AOW auth | Same value in the AOW service and in the n8n credential |

## 4. Decisions needed

1. **n8n:** do you already have an instance (Cloud or self-hosted)? If not, OK to self-host it on the same server?
2. **Required sections:** make Tool of the Week, Workflow of the Week, AI → ROI and What Not to Do required (config only, `config/newsletter.json`) so every issue covers pricing, workflows, ROI and risks? With that change, a week without solid material for them blocks instead of shipping without them.
3. **Alerts:** Slack (already built) or email (needs an n8n email node)?
4. **Screenshots and recording:**
   - I can capture n8n and terminal screenshots myself.
   - Airtable, beehiiv and Slack screens need a logged-in browser: you take them from my shot list, or connect Claude in Chrome on your computer and I take them.
   - The recorded walkthrough and demo need a person to record; I'll write the script.

## 5. Known limits to plan around

- **Airtable plan:** the free plan's per-base record limit fills up within weeks at ~15 stories a day plus scores and research. Use a paid plan or prune old Stories/Scores monthly.
- **Run status after a restart:** the AOW service keeps live run status in memory. After a restart, n8n reports "status lost" and the Run Log in Airtable keeps the outcome.
- **Settings changes:** sources and Mohil's notes change live in Airtable. Prompts, sections, weights and limits are files and need a redeploy (`git pull` + restart), which the manual will cover.
