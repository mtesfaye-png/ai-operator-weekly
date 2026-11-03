# Verification log: AI Operator Weekly, week of Oct 27 – Nov 2, 2026

Prepared on November 3, 2026. Story candidates came from the free RSS collector (Airtable base
`appYiy5hPq7BNDosa`, Articles table). **No feed excerpt was used as a fact.** Every fact in the issue was read
from the page linked below. These pages were opened on Nov 3 through Claude Code's web fetch.

**How each item was checked**
- **Primary:** the organization's own page.
- **Reported:** a news outlet's report, which in turn cites a primary document.
- **Not opened:** the source exists, but the drafting environment couldn't reach it, so it wasn't read directly.

| Item in the issue | Source | Check | Notes |
|---|---|---|---|
| Anthropic S-1 figures, ticker, voting control | [TechCrunch](https://techcrunch.com/2026/10/26/anthropic-officially-files-for-its-public-debut/) | Reported | TechCrunch links the [S-1](https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/anthropicpbc-sx1.htm); sec.gov was **not opened** (blocked from the drafting environment). Mohil should spot-check the numbers in the S-1. |
| Anthropic S-1/A risk factor quotes | [TechCrunch](https://techcrunch.com/2026/11/02/anthropic-warns-that-its-very-close-to-rsi-capability-aka-self-building-ai/) | Reported | Quotes are as reproduced by TechCrunch from the [S-1/A](https://www.sec.gov/Archives/edgar/data/2130357/000162828026068676/anthropicpbc-sx1ax1.htm) (not opened). |
| Grok Bot limits and Musk quote | [TechCrunch](https://techcrunch.com/2026/11/02/elon-musk-throttles-grok-bot-limits-due-to-unsustainably-high-costs/) | Reported | The [X post](https://x.com/elonmusk/status/2116992258520064397) was not opened. The new numeric limits are not public. |
| Garry Tan token spend quote | [TechCrunch](https://techcrunch.com/2026/11/02/y-combinators-garry-tan-uses-ai-agents-so-much-he-spends-up-to-200k-a-year-on-tokens/) | Reported | The quote comes from Walter Isaacson's podcast *The Builders*. |
| NYT and Tribune papers v. Brave | [TechCrunch](https://techcrunch.com/2026/11/02/new-york-times-and-other-outlets-sue-web-browser-brave-over-alleged-content-scraping/) | Reported | No complaint document is linked. These are allegations, not findings. |
| Genie 4 features, availability, limitations | [Google DeepMind](https://deepmind.google/blog/genie-4-a-new-generation-of-world-simulation/) | Primary | Published Oct 27, 2026. |
| ChatGPT Chat/Work merge and pooled Codex limits | [TechCrunch](https://techcrunch.com/2026/11/02/openai-is-finally-merging-chatgpts-chat-and-work-tabs/) | Reported | Based on an OpenAI email to users. No official OpenAI post was found. |
| GPT-6.1 Terra in Copilot | [GitHub Changelog](https://github.blog/changelog/2026-10-26-gpt-6-1-terra-in-github-copilot) | Primary | Oct 26, 2026. |
| Copilot assisted permissions | [GitHub Changelog](https://github.blog/changelog/2026-10-26-github-copilot-assisted-permissions-generally-available) | Primary | Oct 26, 2026. The page doesn't name eligible plans. |
| Copilot server-to-server authentication | [GitHub Changelog](https://github.blog/changelog/2026-10-27-github-copilot-supports-server-to-server-authentication) | Primary | Oct 27, 2026, public preview. |
| Opera WebAI | [TechCrunch](https://techcrunch.com/2026/10/27/opera-introduces-a-new-web-standard-to-let-users-deploy-ai-locally-in-their-browser/) | Reported | No official Opera announcement is linked. |
| **Copilot prices** (Free/Pro/Pro+/Max, credits, $0.01 per credit) | [github.com/features/copilot/plans](https://github.com/features/copilot/plans) | **Primary, official pricing** | Checked Nov 3, 2026. The page lists individual plans only; Business and Enterprise prices are not included in the issue. |
| Bank of America credential warning | [TechCrunch](https://techcrunch.com/2026/10/27/bank-of-america-kindly-asks-that-you-dont-share-your-banking-password-with-your-ai-assistant/) | Reported | A bank spokesperson confirmed the email. |
| Cohere / Qwen sandbox incident | [TechCrunch](https://techcrunch.com/2026/10/26/cohere-says-alibabas-qwen-model-tried-to-send-a-file-to-beijing/) | Reported | Cohere's own post (cohere.com) was not opened. The issue includes the disputes and caveats. |
| IBM Research harness comparison (30% → 81%) | [Hugging Face blog](https://huggingface.co/blog/ibm-research/cuga-harness) | Primary | One benchmark (90 AppWorld tasks); the configurations differed. |
| Ai2 novelty-judge result (93.5% → 40.9%) | [Hugging Face blog](https://huggingface.co/blog/allenai/novelty-bench) | Primary | |
| Transformers Model Integration Contracts | [Hugging Face blog](https://huggingface.co/blog/transformers-mic) | Primary | |
| **GitHub Actions**: 2,000 free minutes/month for private repos | [github.com/pricing](https://github.com/pricing) and GitHub's Actions billing docs | **Official, via search** | docs.github.com was blocked from the drafting environment; confirmed from GitHub's own pages in search results on Nov 3. |
| **Airtable Free**: 1,000 records/base, 1,000 API calls/workspace/month | [Airtable plans overview](https://support.airtable.com/articles/2277136852-airtable-plans-overview) | **Official, via search** | airtable.com was blocked from the drafting environment. The same limits apply to our own base. |
| ROI break-even (≈26 minutes a month) | Our math | **Estimate** | $39 (verified price) ÷ $90/hour (an assumption, labelled in the issue). |

**Left out on purpose**
- **beehiiv prices:** beehiiv's own pages disagree on plan names and prices (Launch/Scale/Max vs Free/Lite/Pro), so no beehiiv price appears in the issue.
- **Vendor case studies** (Greptile, CodeRabbit, Qodo): they appear only as "vendor-published, not independent". No numbers are taken from them.
