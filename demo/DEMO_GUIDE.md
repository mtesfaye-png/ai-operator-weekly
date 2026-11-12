# AI Operator Weekly: live demo guide (browser only, $0)

Everything here runs in the browser. There's nothing to install and no laptop acting as a server.

| Piece | Where it runs | Status (verified Nov 3, 2026, 22:47 UTC) |
|---|---|---|
| RSS collection → Airtable | GitHub Actions (free minutes) | **Fully live.** Scheduled daily for 7:17am New York time (GitHub has started these scheduled runs late: between 12:44pm and 5:21pm New York time on Nov 4–12), plus **Run workflow**. Six successful runs today (links in `FINAL_CHECKLIST.md`) |
| Airtable database | The existing base `appYiy5hPq7BNDosa` | **Fully live.** 110 real articles + 29 sources, with 0 duplicate IDs |
| n8n | **n8n Cloud** (free trial) | **Fully live.** The Cloud execution started [run 41733527751 "RSS collect · n8n-cloud"](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/41733527751), started by `mtesfaye-png`, all steps green. Manual only: no n8n schedule |
| Newsletter | `demo/2026-11-03/` and the demo page | **Draft for Mohil.** Written in a Claude Code session from verified sources, not by the paid pipeline |
| beehiiv | Manual import | **Manual.** The one-draft API workflow is built but hasn't been run: Create Post needs the Pro or Enterprise plan |
| Claude pipeline (scout, writer) | – | **Not connected.** It needs paid Anthropic credits |

---

## One-time setup

### A. GitHub secrets (needed for the cloud run, 2 minutes)
1. Open https://github.com/mtesfaye-png/ai-operator-weekly → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**. Name: `AIRTABLE_TOKEN`. Value: your Airtable `pat…` token. Click **Add secret**.
3. Click **New repository secret** again. Name: `AIRTABLE_BASE_ID`. Value: `appYiy5hPq7BNDosa`. Click **Add secret**.

### B. n8n Cloud trial (optional, about 10 minutes)
1. Go to https://n8n.io → **Get started for free** and sign up. The trial needs no credit card.
2. In your n8n workspace, click **Create workflow**, then the **⋯** menu (top right) → **Import from File**.
3. To get the file: in GitHub, open `n8n/cloud-demo.json` and click **Download raw file**.
4. Create a **GitHub token** for n8n:
   - If you're signed in to GitHub as **mtesfaye-png**:
     1. Go to https://github.com/settings/personal-access-tokens/new.
     2. **Repository access:** *Only select repositories*, and choose `ai-operator-weekly`.
     3. **Permissions → Actions:** *Read and write*.
     4. Click **Generate token**.
   - If you're a collaborator rather than the owner, a fine-grained token can't reach this repo. Either ask `mtesfaye-png` to create the token, or use a classic token with the `repo` scope. A classic token has broader access; delete it after the demo.
5. In n8n, double-click **Start GitHub Actions collect** → **Credential** → **Create new credential** → **Header Auth**:
   - **Name:** `Authorization`
   - **Value:** `Bearer ` followed by your token
   - Save it. Then open **Check run status** and select the same credential.
6. Create a read-only Airtable token:
   1. Go to https://airtable.com/create/tokens → **Create token**.
   2. Add the scope `data.records:read`, and give it access to the base **AI Operator Weekly**.
   3. Create it and copy it.
7. In n8n, double-click **Read newest articles from Airtable** → **Credential** → **Create new credential**. The type is already set to Airtable's personal access token. Paste the token and save.
8. **Don't add a schedule in n8n.** GitHub Actions already runs the collection every day, and a second schedule would run it twice.

### C. beehiiv draft through the API (optional, only on the Pro or Enterprise plan)
1. In beehiiv, go to **Settings → API** → create an API key, and copy your **Publication ID** (`pub_…`).
2. In GitHub, add the repository secrets `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID`, the same way as in step A.
3. Go to **Actions** → **beehiiv draft (manual, one draft only)** → **Run workflow**. Type `CREATE ONE DRAFT` and click **Run workflow**.
4. If beehiiv refuses because of the plan, the run says so and creates nothing. Use the manual import instead (below).

### Manual import into beehiiv (works on any plan)
1. Open the newsletter page in your browser (the demo page, or download `demo/2026-11-03/issue.html` from GitHub and open it).
2. In beehiiv, go to **Posts** → **Start writing** (or **New post**).
3. **Title:** use subject line 1 from `subjects.md`.
4. In the newsletter page, select from **"AI Operator Weekly"** down to the end, copy, and paste into the beehiiv editor. Headings, lists and links come across. Check the formatting after pasting.
5. Open the post's **email settings**. Set the **subject line** and the **preview text** from `subjects.md`.
6. **Don't click Publish or Schedule.** beehiiv saves the post automatically. In **Posts** it shows as **Draft**.

---

## The demo, in 7 steps (about 8 minutes)

1. **Start the automation from the browser.**
   - Open GitHub → **Actions** → **RSS collect (free)** → **Run workflow** → **Run workflow**.
   - Or, in n8n Cloud, open the workflow and click **Execute**: n8n starts the same GitHub run and waits for it.
2. **Show that real news was collected.**
   - Click the run when it turns green, about 1–2 minutes later.
   - Its summary page shows a table: feeds read, new articles, **Added to Airtable this run**, duplicates, and **Paid API calls: 0**.
   - The **Newest editorial candidates** list links to the real articles.
3. **Open Airtable and show the records.**
   - Open https://airtable.com/appYiy5hPq7BNDosa → **Articles**. Sort by `first_seen_at`, newest first.
   - Point out the `verification_status` column. It says **unverified**: feed text is the publisher's own claim until someone has checked it.
4. **Open the completed newsletter.**
   - Use the demo page link (from Claude), or `demo/2026-11-03/issue.html`.
   - Show the **Sources** under each story, the price "checked Nov 3", and the **Estimate** label in AI → ROI.
   - Show `sources.md`, the verification log: it lists what was checked and how.
5. **Show the beehiiv draft.** In beehiiv → **Posts**, the post's status is **Draft**. Open it with **Preview**.
6. **Explain how n8n connects everything.**
   - Show the n8n canvas: Start → start the GitHub Actions run → wait and check → finished? → read the newest articles from Airtable.
   - In n8n's **Executions** tab, a failed run turns red with a link to the GitHub run.
7. **Show that publication needs Mohil's approval.**
   - The yellow **EDITOR REVIEW REQUIRED** box sits at the top of the draft, and the **[DRAFT TAKE - Mohil to confirm]** markers appear in every story.
   - The beehiiv integration can only create drafts: its code refuses any status other than `draft` and has no send, schedule or publish call.
   - Only Mohil clicks **Publish** in beehiiv.

## Real screenshots in this folder
**From the live services** (taken by you, Nov 12, 2026):
- `screenshots/github-run-n8n-cloud-summary.png`: GitHub run #7, **RSS collect · n8n-cloud**, started by `mtesfaye-png` from n8n Cloud. It shows the summary table: 12 of 14 feeds read, **Added to Airtable this run: 6**, **Paid API calls: 0**.
- `screenshots/n8n-cloud-execution-success.png`: an n8n Cloud execution (Nov 12, 18:46 New York time) that **Succeeded in 38.4 s**, every node green. It started GitHub run [43331716105](https://github.com/mtesfaye-png/ai-operator-weekly/actions/runs/43331716105).
- `screenshots/airtable-sources.png`: the Airtable base **AI Operator Weekly**, Sources table, 32 records.
- `screenshots/beehiiv-draft-editor.png`: the Nov 3 issue pasted into a beehiiv post on the Free plan, with a **[DRAFT TAKE - Mohil to confirm]** line visible.

**Rendered and tested in Claude's session:**
- `screenshots/newsletter-top.png` and `screenshots/newsletter-tool-of-week.png`: the rendered newsletter.
- `screenshots/n8n-cloud-demo-workflow.png`: the n8n workflow canvas (n8n 2.44.7 in Claude's session).
- `screenshots/n8n-cloud-demo-execution-success.png`: the self-hosted test at 16:39 UTC on Nov 3 (run 41676377849).
- `screenshots/n8n-cloud-demo-execution.png`: a failed execution (run 41673616802, before the Airtable secrets existed), which shows how n8n reports an error.
