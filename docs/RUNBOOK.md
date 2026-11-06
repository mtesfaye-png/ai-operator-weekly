# AI Operator Weekly: step-by-step runbook from here to the finish

This is the full list of what **you** do, in order, from where you are now (setting up Stage 3 on your
Windows PC) until the project is finished and handed over. Do the steps in order and don't skip ahead.
Every **🛑 STOP** means: send me what it asks for and wait for my answer before continuing.

Some steps need code changes from me first. Those steps give you a **message to send Claude**, word for
word. Paste it into this Claude Code session, or into a new session started on the
`mtesfaye-png/ai-operator-weekly` repository.

---

## Progress checklist

Tick these off as you go.

- [ ] **Phase 1:** Docker Desktop running
- [ ] **Phase 2:** Stage 3 installed, manual test checked by Claude, daily schedule published
- [ ] **Phase 3:** Stage 3 ran on its own for 7 days
- [ ] **Phase 4:** decisions and approvals for the paid stages
- [ ] **Phase 5:** Anthropic account, spend limit and API key ready
- [ ] **Phase 6:** Daily Scout (Claude) live from n8n
- [ ] **Phase 7:** beehiiv connected (or the manual-paste route chosen)
- [ ] **Phase 8:** Weekly production live from n8n
- [ ] **Phase 9:** Slack alerts and Analytics live
- [ ] **Phase 10:** end-to-end demo week (Mohil reviews and sends the issue himself)
- [ ] **Phase 11:** handoff: walkthrough, operating manual with screenshots, recording
- [ ] **Phase 12:** routine operation (daily / weekly / monthly)

**Money:** Phases 1–4 cost **$0**. Spending starts only at Phase 6, and only after you've approved it in Phase 4.

---

## Rules that apply to every phase

1. **Never paste a secret into chat, email or a screenshot.** That includes the Airtable token (`pat…`), the
   Anthropic key (`sk-ant-…`), the beehiiv key, the trigger token and the Slack webhook URL. Secrets go only
   into `deploy\windows\.env` on your PC, or into the n8n credential screens.
2. **"Open PowerShell in the project folder"** always means:
   1. Press the Windows key, type `PowerShell`, press Enter.
   2. Paste this line and press Enter:
      ```powershell
      cd $HOME\Documents\ai-operator-weekly\deploy\windows
      ```
3. **"Get the latest code"** always means: open PowerShell in the project folder, then run
   ```powershell
   git pull
   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -SkipImport
   ```
   `-SkipImport` keeps your n8n workflows exactly as you left them.
4. **To send me output:** select the text in PowerShell with the mouse, press **Enter** (that copies it), then
   paste it into chat. For a screenshot, press **Windows + Shift + S**, drag over the area, then paste into chat.
5. **Never run `docker compose down -v`.** The `-v` deletes all collected data and your n8n setup.

---

## Phase 1: Get Docker Desktop running (now)

Your last attempt failed because Docker Desktop's engine wasn't running ("500 Internal Server Error").

1. Click Start, type **Docker Desktop**, and open it.
2. Wait **2 minutes**. Look at the **bottom-left corner** of the Docker Desktop window.
3. If it says **Engine running** (green), go to step 7.
4. If it still says **Engine starting**, shows **Engine stopped**, or shows an error:
   1. Click the **bug icon** (Troubleshoot) at the top right of Docker Desktop.
   2. Click **Restart**. Wait 2 minutes.
5. If it still isn't green:
   1. Close Docker Desktop: right-click the whale icon near the clock, then **Quit Docker Desktop**.
   2. Click Start, type **PowerShell**, right-click **Windows PowerShell**, then **Run as administrator**, then **Yes**.
   3. Run:
      ```powershell
      wsl --update
      ```
   4. When it finishes, restart Windows.
   5. Open Docker Desktop again and wait 2 minutes.
6. If it's **still** not green: 🛑 **STOP.** Send me a screenshot of the Docker Desktop window and the output of
   `wsl --status` (run in normal PowerShell).
7. Make Docker start by itself:
   1. In Docker Desktop, click the **gear icon** (Settings) at the top right.
   2. Under **General**, tick **Start Docker Desktop when you sign in to your computer**.
   3. Click **Apply** (bottom right). If a restart button appears, click it.
8. Test Docker. Open a normal PowerShell and run:
   ```powershell
   docker run --rm hello-world
   ```
   ✅ Success: the output includes **Hello from Docker!**
9. **Licence check:** Docker Desktop is free only if the company has **fewer than 250 employees and less
   than $10 million annual revenue**. If Gupta Partners is bigger than that, 🛑 STOP and tell me.

---

## Phase 2: Finish Stage 3 (free RSS collection, scheduled by n8n)

### 2A. Run the setup

1. Open PowerShell in the project folder (rule 2).
2. Run these two lines one at a time:
   ```powershell
   git pull
   powershell -ExecutionPolicy Bypass -File .\setup.ps1
   ```
3. It asks: **Paste your Airtable personal access token**.
   1. Paste your `pat…` token. Nothing appears on screen while you paste; that's intentional.
   2. Press **Enter**.
   3. If you don't have the token anymore: go to https://airtable.com/create/tokens, click **Create token**, and
      name it `ai-operator-weekly`.
      - **Scopes:** add `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`.
      - **Access:** add the base **AI Operator Weekly**.
      - Click **Create token** and copy it (it's shown only once).
4. It asks: **Airtable base ID [press Enter for appYiy5hPq7BNDosa]**. Just press **Enter**.
5. Wait. The first time takes **3–10 minutes**: it downloads n8n and builds the collector.
6. ✅ Success: the last lines say **Done** and **Open the n8n editor: http://localhost:5678**.
7. If it stops with a red error: 🛑 **STOP.** Send me the last 20 lines.

### 2B. Create your n8n login

1. Open your browser and go to **http://localhost:5678**.
2. On **Set up owner account**, enter your email, first name, last name and a password. Write the password down
   somewhere safe. This login exists only on your PC; it isn't an n8n.io account.
3. Click **Next**.
4. If a questionnaire appears, click **Skip** or **Get started**.
5. If a box offers a free licence key or paid features, close it. Never enter payment details.

### 2C. First manual test

1. You're on **Overview**. Click **AI Operator Weekly - RSS Collect (free)**.
2. You'll see a chain of boxes: **Run now (manual test)** → **Collect RSS (free, no Claude)** → **Summarize run** → …
3. Click **Execute workflow** at the bottom centre. If it asks which trigger to use, choose **Run now (manual test)**.
4. Wait up to **1 minute** until the boxes have green ticks.
5. Double-click the **Summarize run** box. On the right (**OUTPUT**), switch the view to **JSON** (tabs at the top
   of the panel).
6. 🛑 **STOP.** Copy everything in that JSON panel and send it to me with the message:
   > Stage 3 manual test output:
   > (paste)

   I'll check it. Expected: `"outcome": "ok"`, `"paid_api_calls": 0`, and `synced_to_airtable` between 0 and 15.
7. Close the node panel (the **X** or **Back to canvas**).

### 2D. Second manual test (duplicate check)

Do this only after I've confirmed 2C.

1. Click **Execute workflow** again.
2. Open **Summarize run** again and copy the JSON.
3. 🛑 **STOP.** Send it to me with: `Stage 3 second test output:`. Expected: `already_stored` is large,
   `new_articles` is small or 0, and nothing in Airtable is duplicated.
4. In Airtable (https://airtable.com, base **AI Operator Weekly**, table **Articles**), scroll through and confirm
   the new rows look like real AI news.

### 2E. Turn on the daily schedule

1. In the workflow, click **Publish** (top right).
2. In the window that opens, click **Publish** again.
3. ✅ The button now shows it's published. The workflow runs every day at **7:05am New York time** while your
   PC is on and Docker Desktop is running.
4. The PC must be **switched on and awake** at 7:05am ET; a sleeping PC doesn't run anything. To prevent sleep:
   Windows **Settings → System → Power & battery → Screen and sleep** → set **"When plugged in, put my device
   to sleep after"** to **Never**. The screen may still turn off; that's fine.

### 2F. Check the first automatic run (next morning, after 7:05am ET)

1. Open **http://localhost:5678** and click **Overview** in the left sidebar.
2. Click the **Executions** tab at the top (or the **Executions** icon in the left sidebar).
3. You should see a run at about 7:05 with status **Success** (green).
4. Click it, then double-click **Summarize run**, switch to JSON, and copy.
5. 🛑 **STOP.** Send it to me with: `First scheduled run:`.

### 2G. First backup

1. Open PowerShell in the project folder.
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\backup.ps1
   ```
3. ✅ It ends with **Backup saved to …\backups\<date>**.
4. Copy that backups folder to OneDrive, Google Drive or a USB stick. It contains your n8n login data, so don't
   share it with anyone.

---

## Phase 3: Let Stage 3 run on its own for 7 days

**Every morning (1 minute):**
1. Open http://localhost:5678 → **Executions**.
2. Today's 7:05 run should be green.
3. If it's **red** or missing, click it, double-click **Summarize run**, copy the JSON (or screenshot the error),
   and send it to me with: `Stage 3 run failed:`.

**On day 7:**
1. Open PowerShell in the project folder and run:
   ```powershell
   docker compose exec aow node src/cli.js airtable-status
   ```
2. Run the backup again (Phase 2G, steps 2–4).
3. 🛑 **STOP.** Send me the `airtable-status` output with: `Stage 3 week 1 done:`.
   I'll tell you how fast the base is filling up and when to archive.

---

## Phase 4: Decisions and approvals before anything paid

Answer these in **one message** to me. Copy this template, fill it in, and send it.

```
Phase 4 decisions:
1. Monthly Anthropic budget I approve (hard limit set in the Anthropic Console): $____
   (Expected use: daily scout ≈ $3–18/month + weekly issue ≈ $12–32/month → about $15–50/month. Test month: $25.)
2. Docker Desktop licence: we are under 250 employees AND under $10M revenue: yes / no
3. Required sections: should every issue be forced to include Tool of the Week, Workflow of the Week,
   AI → ROI and What Not to Do?  yes (an issue without solid material for them is blocked) / no (writer may drop thin ones)
4. Alerts: Slack (I'll create a free incoming webhook) / no alerts beyond n8n's red runs
5. beehiiv plan name (beehiiv → Settings → Billing): ______
6. Airtable: stay on Free and archive monthly (I accept pruning old Stories/Scores/Research) / pay for a plan: ______
7. Who reviews and sends each issue in beehiiv: Mohil / other: ______
```

How to find **item 5**: log in at https://app.beehiiv.com → **Settings** (bottom left) → **Billing**. The plan
name is at the top. Send me only the plan name.

🛑 **STOP.** Wait for my reply. I'll confirm what each answer means and which phases change.

---

## Phase 5: Anthropic account, spend limit and API key (≈ 15 minutes)

1. Go to **https://platform.claude.com** and sign in, or click **Sign up** and create the organization for
   Gupta Partners.
2. **Add billing:** **Settings → Billing**. Add a payment method and buy the smallest prepaid credit amount that
   covers your approved budget, or set up invoicing as offered.
3. **Create a separate workspace:** **Settings → Workspaces → Create workspace**, name it `ai-operator-weekly`.
4. **Set the hard spend limit** on that workspace:
   1. Open the workspace's settings and find **Limits** (spend limit).
   2. Set the **monthly spend limit** to the amount you approved in Phase 4 (for the test month, **$25**).
   3. Save.
5. **Turn on web search:** look in **Settings** for **Web search** (an organization or privacy setting) and
   make sure it's **enabled**. If you can't find it, take a screenshot of the Settings menu and send it to me.
6. **Create the API key:**
   1. **Settings → API keys → Create key**.
   2. Workspace: **ai-operator-weekly**. Name: `aow-windows-pc`.
   3. Click **Create** and **copy the key now** (it's shown once). Don't paste it anywhere except the next step.
7. **Store the key on your PC:**
   1. Open PowerShell in the project folder.
   2. Run `notepad .env`. Notepad opens your settings file.
   3. At the bottom, add a new line exactly like this (your key after the `=`, no spaces, no quotes):
      ```
      ANTHROPIC_API_KEY=sk-ant-...
      ```
   4. **File → Save**, then close Notepad.
8. 🛑 **STOP.** Send me **this message** (no key in it):
   > Phase 5 done. Anthropic key is in deploy\windows\.env, workspace spend limit is $__, web search is enabled.
   > Please enable the Daily Scout for the Windows setup (Phase 6).

---

## Phase 6: Daily Scout (Claude) live from n8n

What I'll change when you send the Phase 5 message:
- the collector gets the Anthropic key;
- the trigger server allows `collect,daily`;
- a test cap of **$2 per run** is set;
- `n8n/daily-scout.json` is pointed at the local collector with a manual test button;
- `setup.ps1` gets an option to import it.

You'll get a reply saying **"Phase 6 ready"**. Then:

### 6A. Install the update
1. Get the latest code (rule 3).
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -ImportDaily
   ```
   (I'll confirm the exact switch name in my "Phase 6 ready" reply.)
3. Check the configuration (free, no paid call):
   ```powershell
   docker compose exec aow node src/cli.js doctor
   ```
4. 🛑 **STOP.** Send me the `doctor` output. It never shows the key. I'm looking for `✔ ANTHROPIC_API_KEY` and
   the $2 cap.

### 6B. First paid run (≈ $0.10–0.60). Only after I say "go"
1. Open http://localhost:5678 → **Overview** → **AI Operator Weekly - Daily Scout**.
2. Click **Execute workflow** and pick the manual trigger if asked. It takes 1–5 minutes.
3. Double-click the result box I name in my reply, switch to **JSON**, and copy.
4. In Airtable, open the **Stories** table and look at the new rows: titles, links, scores.
5. In the Anthropic Console: **Usage** → note today's cost for the `ai-operator-weekly` workspace.
6. 🛑 **STOP.** Send me: the JSON, the Console cost, and a screenshot of the Stories table.

### 6C. Schedule it
Only after I confirm 6B:
1. In the Daily Scout workflow, click **Publish → Publish**.
2. It runs every day at **6:45am ET**. I'll tell you whether to keep or unpublish the free RSS Collect
   workflow; the Scout reads the same feeds.
3. Run it for **at least 2 days**, checking **Executions** each morning as in Phase 3.
4. 🛑 **STOP** after day 2. Send me the two Summaries and the Console cost so far.

---

## Phase 7: beehiiv

What happens depends on the plan name you sent in Phase 4.

### 7A. If I said your plan supports the Create Post API
1. Log in at https://app.beehiiv.com.
2. **Settings → API** (under Workspace/Integrations; the label can vary).
3. Click **Create New API Key**, name it `ai-operator-weekly`, and copy the key (shown once).
4. On the same page, copy the **Publication ID** (starts with `pub_`).
5. Optional but recommended: create a post template.
   1. **Settings → Templates → New post template**.
   2. Set up the header and footer the way Mohil wants.
   3. Save, open it, and copy the ID from the address bar.
6. Open PowerShell in the project folder, run `notepad .env`, and add these lines at the bottom:
   ```
   BEEHIIV_API_KEY=...
   BEEHIIV_PUBLICATION_ID=pub_...
   BEEHIIV_POST_TEMPLATE_ID=...
   ```
   Leave the template line empty after `=` if you skipped step 5. Save and close.
7. 🛑 **STOP.** Send: `Phase 7 beehiiv keys are in .env. Please enable Weekly (Phase 8).`

### 7B. If your plan doesn't support it (manual-paste route, no beehiiv keys)
Nothing to set up. Each week the finished issue is saved as `issue.html`, and you paste it into a new beehiiv
post by hand (steps in Phase 10). Send: `Phase 7: manual paste route. Please enable Weekly (Phase 8).`

---

## Phase 8: Weekly production live from n8n

What I'll change:
- the trigger server allows `collect,daily,weekly`;
- a test cap of **$10** for the first weekly run is set (normal cap $20);
- `n8n/weekly-production.json` is pointed at the local collector, with a manual trigger and completion polling;
- `setup.ps1` gets an option to import it.

You'll get a reply saying **"Phase 8 ready"**. Then:

### 8A. Install
1. Get the latest code (rule 3).
2. Import the weekly workflow with the command from my reply.
3. 🛑 **STOP.** Send me the `doctor` output again (Phase 6A, step 3).

### 8B. First weekly run (≈ $3–8). Only after I say "go"
1. Make sure the Daily Scout has run for at least 2 days (Phase 6C).
2. n8n → **AI Operator Weekly - Weekly Production** → **Execute workflow**. It can take **15–40 minutes**;
   leave the PC on.
3. When it finishes:
   - **beehiiv route:** open beehiiv → **Posts**. There's a new post with status **Draft**. Open it and click
     **Preview**. Confirm it is **not** scheduled.
   - **Manual route:** in PowerShell in the project folder, run
     ```powershell
     docker compose cp aow:/data/out .\out
     ```
     Then open `deploy\windows\out\<date>\preview.html` in your browser.
4. In Airtable, open **Issues**: there's one row for this week, with a status.
5. 🛑 **STOP.** Send me: the final JSON from n8n, the Console cost for the run, and screenshots of the draft
   (top, middle, bottom).

### 8C. Schedule it
After I confirm:
1. Weekly Production → **Publish → Publish**.
2. It runs every **Saturday at 7:00am ET**. The PC must be on Saturday morning until about 8am.

---

## Phase 9: Alerts and Analytics

### 9A. Slack alerts (if you chose Slack in Phase 4)
1. In Slack, create a channel `#aow-alerts`.
2. Go to https://api.slack.com/apps → **Create New App** → **From scratch**. Name it `AOW Alerts` and pick your
   workspace.
3. In the app's left menu: **Incoming Webhooks** → switch **Activate Incoming Webhooks** to **On**.
4. Click **Add New Webhook to Workspace**, choose `#aow-alerts`, then **Allow**.
5. Copy the **Webhook URL** (starts with `https://hooks.slack.com/services/`).
6. PowerShell in the project folder → `notepad .env` → set the line `SLACK_WEBHOOK_URL=` to your URL → save.
7. Get the latest code (rule 3). This restarts the collector with the webhook.
8. In n8n, for **each** workflow, add the alert:
   1. Open the workflow, double-click the alert box (**Alert webhook (optional)** or **Alert: …**).
   2. Paste the URL into **URL** and close the box.
   3. If the box looks grey (deactivated), right-click it → **Activate**.
   4. Click **Publish → Publish**.
9. **Test the alert:**
   1. Run `docker compose stop aow`.
   2. In n8n, open **RSS Collect** → **Execute workflow**.
   3. A message should arrive in `#aow-alerts` within a minute.
   4. Run `docker compose start aow`.
10. 🛑 **STOP.** Send me a screenshot of the Slack alert.

### 9B. Analytics (after the first issue has been sent)
1. Send: `Please enable Analytics (Phase 9B).` (needs beehiiv API keys; not available on the manual route).
2. After my "ready" reply: get the latest code (rule 3), import the Analytics workflow with the command I give
   you, then **Publish** it. It runs daily at 10:00am ET and fills the **Performance** table once an issue has
   been sent.

---

## Phase 10: End-to-end demo week (the proof that everything works)

1. **Monday–Friday:** Daily Scout runs at 6:45am. Check **Executions** each morning (green).
2. **Saturday 7:00am:** Weekly Production runs by itself. Don't press anything.
3. **Saturday after 8am:**
   - **beehiiv route:** beehiiv → **Posts** → the new **Draft**.
   - **Manual route:**
     1. Run `docker compose cp aow:/data/out .\out`.
     2. Open `deploy\windows\out\<date>\issue.html` in Notepad, then **Ctrl + A**, **Ctrl + C**.
     3. In beehiiv: **Start writing** → add an HTML block to the post → paste. The block's name differs by plan,
        so I'll tell you the exact button in my Phase 8 reply, from a screenshot of your editor.
4. **Mohil reviews:**
   1. Read the whole draft.
   2. If there's a box saying **EDITOR REVIEW REQUIRED**, handle what it lists, then **delete the box**.
   3. Check every price and link he's unsure of.
   4. Edit wording as he likes.
5. **Mohil sends it himself** in beehiiv: **Publish → Send** or schedule. The system never sends anything.
6. **Sunday:** Analytics runs at 10am and fills **Performance**. If you're on the manual route, skip this.
7. 🛑 **STOP.** Send me: the issue date, a screenshot of the sent issue, and anything Mohil changed or disliked.
   I'll tune the prompts and settings from that feedback.

---

## Phase 11: Handoff documents

1. Send: `Please write the walkthrough, the operating manual and the screenshot shot list (Phase 11).`
2. I write two documents in the repo:
   - **Walkthrough:** every component and how they connect.
   - **Operating manual:** run, edit, approve/publish, settings, troubleshooting.

   With them comes a **shot list**: a numbered list of screenshots with exactly what to show.
3. Take the screenshots from the shot list with **Windows + Shift + S**, and save each as `01.png`, `02.png`, …
   in a folder.
4. Upload them in a message to me, or put them in Google Drive and tell me the folder name.
5. I put them into the manual and push it. You read it and tell me anything unclear.
6. **Recording:** I write a 10-minute script. You record your screen with the **Snipping Tool**:
   **Windows + Shift + R**, or open the Snipping Tool and choose **Record**. Read the script while clicking
   through. Save the video and share it with Mohil.
7. **Final check:** someone who hasn't seen the project follows the manual alone to:
   - run a manual Daily Scout,
   - change a source's `active` box in Airtable,
   - find a failed run,
   - get the week's draft.

   Fix the manual where they got stuck. ✅ **The project is finished.**

---

## Phase 12: Routine operation (after the project is finished)

| When | What | How |
|---|---|---|
| Every morning (1 min) | Runs are green | n8n → **Executions** |
| Saturday after 8am | Draft is ready, Mohil reviews and sends | Phase 10, steps 3–5 |
| Every Sunday (5 min) | Backup | Phase 2G |
| First of the month (10 min) | Airtable usage + archiving | `docker compose exec aow node src/cli.js airtable-status`; then archive (below) if `records_total` is above 700 |
| First of the month | Anthropic spend | Console → **Usage**. Compare it with your limit |
| When I push an update | Get it | Rule 3 |
| Every 6 months | Rotate keys | Create new Airtable / Anthropic / beehiiv keys, put them in `.env` with Notepad, then rule 3, then delete the old keys on each website |

**Archiving in Airtable (free, no API calls):**
1. Open the table (**Articles**, later also **Stories**, **Scores**, **Research**).
2. Click **Grid view** → **Create** → **Grid**, and name it `Archive`.
3. Click **Filter** → **+ Add condition**: `published_date` (or `event_date`) **is before** → **number of days ago** → `30`.
4. Click the view name's **▾** → **Download CSV**. Keep the file in your backups folder.
5. Hover over the row-number column header (top left of the grid), tick the checkbox that appears there to select
   every row in this view, then right-click a selected row → **Delete selected records**. Check that the view
   still has the `Archive` filter before deleting.
6. Run `docker compose exec aow node src/cli.js airtable-status` so the freed space counts again.

**If something breaks:** send me a screenshot of the red execution, and the output of
`docker compose ps` and `docker compose logs aow --tail 50`. Remove any key from the output first, though none
should appear.
