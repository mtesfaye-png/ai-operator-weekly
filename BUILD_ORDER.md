# AI Operator Weekly — Build Order

The brief's 8 phases are the right skeleton, but three things should move earlier:

1. **Safety rails are built in Phase 1, not Phase 8.** Draft-only publishing, secrets-out-of-prompts and
   the "no path to send" rule are cheap to build first and expensive to retrofit.
2. **Contracts before workflows.** The JSON shapes passed Scout → Researcher → Writer → Fact Checker are
   defined up front, so each n8n phase plugs into a fixed interface and can be tested alone.
3. **Deterministic checks are code, not prompts.** Scoring, dedupe, date window, price freshness and the
   quality gate are plain functions with tests. The LLM judges; code enforces.

## Gate 0 — account checks (do in parallel with Step 1, they block Step 6)

| Check | Why it blocks | Owner |
|---|---|---|
| beehiiv plan supports Create Post API | The brief says Max/Enterprise; beehiiv's docs (checked 2026-10-18) now say **Pro and Enterprise**. Confirm on the live account. If unsupported, Step 6 ships the manual-paste fallback. | Mohil |
| beehiiv API key + publication ID + post template ID | Needed for draft creation | Mohil |
| Anthropic API key with web search/fetch enabled | Scout + Researcher | Mohil |
| Airtable workspace + personal access token (scopes: `schema.bases:write`, `data.records:read/write`) | Base creation | Intern |
| n8n instance (cloud or self-hosted) | Orchestration | Intern |
| Slack webhook or alert email | Failure alerts | Intern |

## Build sequence

| # | Step | Depends on | Status |
|---|---|---|---|
| 1 | **Foundation**: Airtable schema + setup script, source registry, scoring weights, section config, safety rules | — | ✅ built |
| 2 | **Contracts**: 4 agent prompts + JSON Schemas for each hand-off | 1 | ✅ built |
| 3 | **Core logic**: scoring, dedupe, date window, price freshness, quality gate, draft-only beehiiv client | 2 | ✅ built, tested |
| 4 | **Daily Scout**: RSS → Claude Scout (web search) → validate → date window → dedupe → score → store | 3 | ✅ built, tested |
| 5 | **Deep Research**: selection (diversity rule) → primary-source + pricing fetch → evidence enforced in code | 4 | ✅ built, tested |
| 6 | **Writer**: plan → research requests → 13-section draft + subject/preview options | 5 | ✅ built, tested |
| 7 | **Fact Checker + Quality Gate**: Opus pass → blocking gate → one revision | 6 | ✅ built, tested |
| 8 | **beehiiv draft** + manual fallback export; post ID / preview URL saved | 7, Gate 0 | ✅ built, tested (live check pending keys) |
| 9 | **Analytics** after send → Performance → learning summary fed to next Scout/plan | 8 | ✅ built, tested (live check after first send) |
| 10 | **Hardening**: retries, budget caps, alerts, backup export, n8n workflows, trigger server, README | all | ✅ built · Loom + live draft review remain |

Analytics is last because it can't be tested until a real issue has been sent. Hardening is last only in
the sense of *polish* — the blocking safety pieces already exist from Step 1–3.

## Acceptance tests (brief §13) → where they live

| Test | Covered by |
|---|---|
| Pricing staleness | `lib/pricing.js` + `tests/acceptance.test.js` |
| Duplicate collapse | `lib/dedupe.js` + test |
| Hallucinated benchmark blocked | `lib/quality_gate.js` + test |
| Date window uses event date, not crawl date | `lib/dates.js` + test |
| Publisher safety (draft only) | `lib/beehiiv.js` + test (refuses `confirmed`, `scheduled_at`, send endpoints) |
| Failure preserves body + alerts | `lib/beehiiv.js` fallback + test |
| Cost cap | `lib/budget.js` + test |
| No path to send | `lib/beehiiv.js` allow-list + test; re-verify in n8n in Step 8 |

## Review pass (2026-10-19)

Code read end to end against the brief. Fixed, each with a regression test in `tests/review_fixes.test.js`:

| Issue | Fix |
|---|---|
| Gate blocked ordinary phrases ("best practices", "the first time you…") as superlatives, so a normal Build Better section stopped the issue | `benign_phrases` in `newsletter.json`, stripped before matching |
| Brief §9 "links render correctly / UTM consistent" was not enforced | Gate blocks bare and broken links; mixed `utm_source` is a warning |
| Request ids (`req-tool-of-week`, `req-resource-…`) repeat weekly; research with no prices never looked stale, so last week's answer could be reused | Stored research is reused only if checked inside the current issue window |
| `--force` could regenerate a sent issue and overwrite its beehiiv post id (breaking analytics) | Sent issues are never regenerated |
| Web tools on the 2025 versions; no effort set (Opus 5.5 defaults to `medium`, too low for the fact checker); `refusal` produced an empty answer | `web_search_20260209` / `web_fetch_20260209`, `effort` per agent in `runtime.json`, server-side refusal fallback, refusals throw |
| Resumed `pause_turn` requests weren't budget-checked | Budget checked before each continuation |


## Stabilization pass (2026-10-19)

From an independent audit. Regression tests in `tests/stabilization.test.js` (47 tests in total).

| Issue | Fix |
|---|---|
| A `pause_turn` continuation wasn't counted against `max_calls` (two requests sent with a cap of one, `budget.calls` = 1) | The budget is checked before every HTTP request and every completed request is recorded separately (`step`, `step:continueN`, `step:repair`, `step:incomplete`). Call caps raised to match real request counts: daily 8, weekly 50; the dollar caps are unchanged |
| Running out of `max_pause_turns` returned partial text as success | Now an error |
| A 201 followed by a polling timeout was reported as failed, and the post id was dropped | The id is saved before polling; unfinished = `draft_pending`, checked again on the next run; only a 404 (`POST_CREATION_FAILED`) counts as failed; the create request is never retried |
| `--force` with an existing draft created a second beehiiv post and overwrote the stored id | No second post unless `--new-beehiiv-draft` is passed; the old id goes to `previous_beehiiv_post_ids`. The local store no longer lets `undefined` erase stored fields |
| The demo issue was 883 words against a 1,500-2,200 target, with only a warning | One evidence-only expansion pass, run before the fact check. If the draft is still out of range it is kept and flagged (review box in the draft, Slack, `review_flags`) |
| `[DRAFT TAKE]` placeholders were easy to miss | Highlighted inline and listed in the review box |
| Writer output could be cut off: 16k `max_tokens` shared with high-effort thinking, on a non-streaming 10-minute request | Tool-free calls stream with a 64k limit (30-min total, 3-min idle timeout). Effort stays `high`; splitting by section wasn't needed. A `max_tokens` stop, an early-ended stream or an unexpected stop reason is an error, never passed to the gate |

Analysis for the truncation fix: a 2,200-word draft is roughly 3-5k output tokens as JSON. Adaptive thinking at
`high` effort counts toward `max_tokens` and can add several thousand more, so 16k was a real risk for the write,
expand and revise calls. Those calls use no tools, so streaming them is simple: no `pause_turn`, no server-tool
blocks. Tool-using calls (scout, research, fact check) return compact JSON and stay non-streaming at 16k.

## Remaining live setup (needs real accounts)

1. **Gate 0:** confirm the beehiiv plan includes the Create Post API, then get the API key, publication id and
   template id; an Anthropic key; an Airtable token and workspace; an n8n instance; a Slack webhook.
2. **First live `npm run daily`** (about $0.10-0.50). This is the first real check of the 2026-02-09 web tools,
   `output_config.effort`, `fallbacks: "default"` plus its beta header, and SSE streaming. A wrong field shows up
   as an immediate 400.
3. **First live `npm run weekly`.** Watch the gate and expansion results. The gate's wording rules ("Human
   review:", "Verdict:") and the expansion prompt have only been tested against simulated output.
4. `npm run airtable:setup` against the real workspace. Replace `YOUR-AOW-SERVER` and the Slack URL in `n8n/`.
   Host the trigger server.
5. One live draft reviewed by Mohil, then the Loom walkthrough.
