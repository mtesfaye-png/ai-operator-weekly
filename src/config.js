// Central configuration: JSON config files + environment variables.
// Secrets come ONLY from the environment (n8n credentials, .env, or a secrets manager).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', f), 'utf8'));

function loadDotEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function load() {
  loadDotEnv();
  const env = process.env;
  const runtime = readJson('runtime.json');
  return {
    root: ROOT,
    dataDir: env.AOW_DATA_DIR || path.join(ROOT, 'data'),
    outDir: env.AOW_OUT_DIR || path.join(ROOT, 'out'),
    scoring: readJson('scoring.json'),
    newsletter: readJson('newsletter.json'),
    officialPricing: readJson('official_pricing_domains.json').vendors,
    runtime,
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      baseUrl: (env.AOW_ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
    },
    airtable: { token: env.AIRTABLE_TOKEN || '', baseId: env.AIRTABLE_BASE_ID || '' },
    beehiiv: {
      apiKey: env.BEEHIIV_API_KEY || '',
      publicationId: env.BEEHIIV_PUBLICATION_ID || '',
      templateId: env.BEEHIIV_POST_TEMPLATE_ID || '',
    },
    alerts: { slackWebhook: env.SLACK_WEBHOOK_URL || '' },
    server: { token: env.AOW_TRIGGER_TOKEN || '', port: Number(env.PORT || 8787) },
    timezone: env.AOW_TIMEZONE || 'America/New_York',
  };
}

module.exports = { load, ROOT };
