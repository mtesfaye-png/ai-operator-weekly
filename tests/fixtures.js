// Shared fixtures for acceptance tests. All URLs are example placeholders.
const NOW = new Date('2026-10-18T15:00:00Z');
const WINDOW = { start: '2026-10-12', end: '2026-10-18' };

const packet = () => ({
  generated_at: '2026-10-17T14:00:00Z',
  stories: [
    {
      story_id: '2026-10-14-acme-model-release', verified: true, event_date: '2026-10-14',
      claims: [
        { claim_id: 'c1', text: 'Acme released Model Z', claim_type: 'release', status: 'confirmed', evidence_urls: ['https://acme.example/news/model-z'] },
        { claim_id: 'c2', text: 'Model Z Pro costs $20/month', claim_type: 'pricing', status: 'confirmed', evidence_urls: ['https://acme.example/pricing'] },
      ],
      pricing: [{ product: 'Model Z', plan: 'Pro', amount: 20, currency: 'USD', billing_basis: 'per_month', source_url: 'https://acme.example/pricing', source_is_official: true, checked_at: '2026-10-17T14:00:00Z' }],
      limitations: ['US only at launch'],
    },
  ],
  resources: ['https://docs.acme.example/guide'],
});

const draft = () => ({
  subject_options: ['Model Z lands', 'What changed this week', 'The operator brief'],
  preview_text: 'Model Z, pricing and one workflow to steal',
  claims_used: ['c1', 'c2'],
  sections: [
    { id: 'big5', title: 'The 5 Biggest Things in AI', story_ids: ['2026-10-14-acme-model-release'], markdown: '**Acme shipped Model Z.** [Announcement](https://acme.example/news/model-z)' },
    { id: 'tool_of_week', title: 'Tool of the Week', markdown: 'Model Z Pro: $20/month (checked Oct 17). Who it\'s for: solo operators. Who should skip: teams needing SSO. **Verdict: Watch**' },
    { id: 'build_better', title: 'Build Better', markdown: '1. Give examples.\n2. Ask for structured output.\n3. Run small evals.' },
    { id: 'workflow', title: 'Workflow of the Week', markdown: 'Steps 1-4. Human review: approve before anything reaches a customer.' },
    { id: 'one_thing', title: 'One Thing to Try', markdown: 'Save one prompt template you reuse. [Guide](https://docs.acme.example/guide)' },
  ],
  word_count: 60,
});

const passFactCheck = () => ({ verdict: 'PASS', items: [{ claim: 'Acme released Model Z', status: 'PASS', severity: 'high', evidence_url: 'https://acme.example/news/model-z' }] });

module.exports = { NOW, WINDOW, packet, draft, passFactCheck };
