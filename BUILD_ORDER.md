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

Still open (need real accounts): Gate 0 checks, first live `daily` + `weekly`, live beehiiv draft reviewed by Mohil, Loom.
