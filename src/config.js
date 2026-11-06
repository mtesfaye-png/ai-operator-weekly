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
    alerts: {
      slackWebhook: env.SLACK_WEBHOOK_URL || '',
      // Email alerts, e.g. Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=you@gmail.com,
      // SMTP_PASS=<16-character app password>, ALERT_EMAIL_TO=you@gmail.com (comma-separated for several).
      // Off until a password is set when a login is configured, so alerts don't fail on every send.
      email: env.SMTP_HOST && env.ALERT_EMAIL_TO && !(env.SMTP_USER && !env.SMTP_PASS) ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 465),
        user: env.SMTP_USER || '',
        pass: (env.SMTP_PASS || '').replace(/\s+/g, ''),
        from: env.ALERT_EMAIL_FROM || env.SMTP_USER || env.ALERT_EMAIL_TO.split(',')[0].trim(),
        to: env.ALERT_EMAIL_TO.split(',').map((s) => s.trim()).filter(Boolean),
      } : null,
      macNotify: env.AOW_MAC_NOTIFY === '1',
    },
    server: { token: env.AOW_TRIGGER_TOKEN || '', port: Number(env.PORT || 8787) },
    timezone: env.AOW_TIMEZONE || 'America/New_York',
  };
}

module.exports = { load, ROOT };
