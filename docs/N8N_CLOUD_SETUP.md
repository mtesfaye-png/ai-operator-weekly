# Run the n8n workflow live in n8n Cloud (free trial, about 15 minutes)

The workflow `n8n/cloud-demo.json` does four things:
1. Starts the GitHub Actions **RSS collect (free)** run.
2. Checks every 15 seconds until it finishes.
3. Reads the 10 newest articles from Airtable.
4. Shows them as its result. A failed or refused run turns the execution red, with the reason.

It has **no schedule**: GitHub Actions stays the only daily scheduler (set for 7:17am New York time; GitHub usually starts it in the early afternoon).

**Cost:** $0.
- The n8n Cloud trial is 14 days and needs no credit card. It allows 1,000 executions, and each execution can run for up to 180 seconds; this workflow takes about 40.
- Each execution uses about 1 GitHub Actions minute and about 4 Airtable API calls.
- **Never enter card details or click Upgrade.** When the trial ends, n8n deletes the instance. The workflow file stays in GitHub.

---

## 1. Start the free trial
1. Go to **https://n8n.io** → **Get started for free** (top right).
2. Sign up with your email (or Google) and verify the email if asked.
3. Choose a **workspace name**. It becomes your address, `https://<name>.app.n8n.cloud`. Answer or skip the short questionnaire.
4. When your workspace opens, you're on **Overview**. If a plan picker appears, close it. The trial starts on its own.

## 2. Download the workflow file from GitHub
1. Signed in to GitHub, open https://github.com/mtesfaye-png/ai-operator-weekly/blob/main/n8n/cloud-demo.json
2. Click the **Download raw file** button (the download arrow, top right of the file). This saves `cloud-demo.json`.

## 3. Import it
1. In n8n: **Overview** → **Create workflow** (top right).
2. In the empty editor, click the **⋯** menu (top right) → **Import from File…** → choose `cloud-demo.json`.
3. The canvas shows: **Start demo (manual)** → Remember start time → **Start GitHub Actions collect** → Wait 15 seconds → Check run status → Find our run → Finished? → Run succeeded? → **Read newest articles from Airtable** → **Newest articles (result)**, plus three red stop nodes for failures.
4. Press **Ctrl + S** (or click **Save**).

## 4. Create the GitHub credential (lets n8n start and watch the run)
**Make a token.** Use one of the two options below.

**Option A, if you're signed in to GitHub as `mtesfaye-png`** (the repo owner). This is the preferred option:
1. Go to https://github.com/settings/personal-access-tokens/new.
2. **Token name:** `n8n-cloud-demo`. **Expiration:** 7 days.
3. **Resource owner:** `mtesfaye-png`.
4. **Repository access:** **Only select repositories** → `ai-operator-weekly`.
5. **Permissions** → **Repository permissions** → **Actions**: **Read and write**. Metadata becomes Read-only automatically.
6. Click **Generate token** and copy it (`github_pat_…`).

**Option B, if you're signed in as a collaborator** (for example `MatchappAI`) and the repo doesn't appear in Option A's list:
1. Go to https://github.com/settings/tokens/new.
2. **Note:** `n8n-cloud-demo`. **Expiration:** 7 days.
3. Tick the **repo** scope.
4. Click **Generate token** and copy it (`ghp_…`).
5. This token can reach every repo you can. Store it only in n8n, and delete it after the demo.

**Put the token into n8n:**
1. Double-click the node **Start GitHub Actions collect**.
2. Under **Credential for Header Auth**, choose **Create new credential**.
3. Fill in the two fields:
   - **Name:** `Authorization`
   - **Value:** `Bearer ` followed by the token. There's a space after "Bearer".
4. Rename the credential (top left) to `GitHub Actions token`, then click **Save** and close it.
5. Close the node. Double-click **Check run status**, choose the same **GitHub Actions token** credential, and close it.

## 5. Create the Airtable credential (lets n8n read the articles)
1. Go to https://airtable.com/create/tokens → **Create token**.
2. **Name:** `n8n-cloud-read`.
3. **Scopes:** add **data.records:read** only. n8n only reads.
4. **Access:** **+ Add a base** → **AI Operator Weekly**.
5. Click **Create token** and copy it (`pat…`).
6. In n8n, double-click **Read newest articles from Airtable**.
7. Under **Credential for Airtable Personal Access Token API**, choose **Create new credential** and paste the token into **Access Token**.
8. Rename the credential to `Airtable (read)`, then **Save** and close it.
9. Press **Ctrl + S** to save the workflow.

## 6. Run it
1. Click **Execute workflow** at the bottom of the canvas. Depending on the n8n version, it may just say **Execute**.
2. Watch the nodes light up. **Wait 15 seconds** and **Check run status** repeat until GitHub reports the run as finished, usually 2–4 rounds.
3. Success means every node on the top path has a green tick and **Newest articles (result)** shows **10 items**.
4. **Don't click Publish.** The workflow is manual on purpose, so there is nothing to publish.

## 7. Inspect results and errors
- **Results:** double-click **Newest articles (result)**. On the right, switch between **Table** and **JSON**. Each row has `title`, `source`, `published`, `added_to_airtable`, `verification` (*unverified*), `url` and `github_run`, a link to the exact GitHub run.
- **The GitHub side:** open that `github_run` link. In the Actions list, the run is named **RSS collect · n8n-cloud**, and its summary shows the counts and **Paid API calls: 0**.
- **History:** open the **Executions** tab at the top of the workflow. Each run is listed as **Succeeded** (green) or **Error** (red). Click one to replay it on the canvas, then click any node to see what it received and returned.
- **Errors:** a failed execution has a red node with the message. The **Logs** panel at the bottom lists each step.

| Red node | Meaning | Fix |
|---|---|---|
| **Could not start run** | GitHub refused the token | Check the Header Auth value (`Bearer ` plus the token), the token's expiry, and Actions **Read and write** (Option A) or the **repo** scope (Option B) |
| **Run failed** | The GitHub run itself failed | Open the linked run. Its first red step says why, for example a missing or expired Airtable secret |
| **Timed out** | The run didn't finish in about 2.5 minutes | GitHub was slow to start it. Check the Actions tab, then run it again |
| Red **Read newest articles from Airtable** | The Airtable token can't read the base | Re-create it with `data.records:read` and the AI Operator Weekly base |

## 8. Keep one daily schedule
- GitHub Actions already runs the collection every morning. **Don't add a Schedule Trigger in n8n**: two schedules would mean two runs a day.
- Running the n8n workflow by hand is always safe. A repeat run adds only genuinely new articles and never creates duplicates.
