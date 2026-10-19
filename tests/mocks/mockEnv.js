// Builds options for a fully simulated run: fake keys, fake APIs, isolated data/ and out/ folders.
// Used by `node src/cli.js <workflow> --mock` and by the end-to-end test.

const fs = require('fs');
const path = require('path');
const { load } = require('../../src/config');
const { fakeFetch, fakeState, MOCK_SOURCES } = require('./fakeApis');

function mockOptions({ dataDir, outDir, sent = process.env.AOW_MOCK_SENT === '1', failBeehiiv = false } = {}) {
  const base = load();
  const root = base.root;
  const cfg = {
    ...base,
    dataDir: dataDir || path.join(root, 'data-mock'),
    outDir: outDir || path.join(root, 'out-mock'),
    anthropic: { apiKey: 'mock-key', baseUrl: 'https://api.anthropic.com' },
    airtable: { token: '', baseId: '' }, // mock runs always use the local store
    beehiiv: { apiKey: 'mock-key', publicationId: 'pub_00000000-0000-0000-0000-000000000001', templateId: '' },
    alerts: { slackWebhook: 'https://slack.example/hook' },
    runtime: { ...base.runtime, retry_base_ms: 1 },
  };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const srcFile = path.join(cfg.dataDir, 'sources.json');
  if (!fs.existsSync(srcFile)) fs.writeFileSync(srcFile, JSON.stringify(MOCK_SOURCES, null, 2));
  // Persist beehiiv mock state across separate CLI invocations (weekly, then analytics).
  const stateFile = path.join(cfg.dataDir, '_mock_beehiiv.json');
  if (fs.existsSync(stateFile)) fakeState.posts = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (!mockOptions.hooked) { mockOptions.hooked = true; process.on('exit', () => { try { fs.writeFileSync(stateFile, JSON.stringify(fakeState.posts)); } catch {} }); }
  fakeState.sent = sent;
  fakeState.failBeehiiv = failBeehiiv;
  return { cfg, fetchImpl: fakeFetch, now: fakeState.now, issueDate: '2026-10-18' };
}

module.exports = { mockOptions };
