// Alert delivery: email (SMTP, e.g. Gmail with an app password), Slack, and a macOS notification.
// Every configured channel is tried; a failing channel never stops the others or the run.
// No npm dependencies: a minimal SMTP client over implicit TLS (port 465) or STARTTLS (port 587).

const net = require('net');
const tls = require('tls');
const os = require('os');
const { execFile } = require('child_process');

// Reads SMTP replies line by line; resolves with the full reply once the final line ("250 ok") arrives.
function replyReader(sock) {
  let buf = '';
  let lines = [];
  const replies = [];
  let waiting = null;
  let failure = null;
  const onData = (d) => {
    buf += d.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      const m = raw.match(/^(\d{3})([ -]?)(.*)$/);
      if (!m) continue;
      lines.push(m[3]);
      if (m[2] !== '-') {
        const reply = { code: Number(m[1]), text: lines.join('\n') };
        lines = [];
        if (waiting) { const w = waiting; waiting = null; w.resolve(reply); } else replies.push(reply);
      }
    }
  };
  sock.on('data', onData);
  return {
    next: () => new Promise((resolve, reject) => {
      if (replies.length) return resolve(replies.shift());
      if (failure) return reject(failure);
      waiting = { resolve, reject };
    }),
    fail: (e) => { failure = e; if (waiting) { const w = waiting; waiting = null; w.reject(e); } },
    detach: () => sock.removeListener('data', onData),
  };
}

function encodeHeader(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function buildMessage({ from, to, subject, text }) {
  const body = Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: AI Operator Weekly <${from}>`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@aow.local>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

// opts: { host, port, user, pass, from, to: [..], secure (implicit TLS), timeoutMs, tlsOptions }
async function sendMail(opts, { subject, text }) {
  const port = Number(opts.port || 465);
  const implicit = opts.secure !== undefined ? opts.secure : port === 465;
  const timeoutMs = opts.timeoutMs || 20000;
  const connect = () => new Promise((resolve, reject) => {
    const s = implicit
      ? tls.connect({ host: opts.host, port, servername: opts.host, ...(opts.tlsOptions || {}) }, () => resolve(s))
      : net.connect({ host: opts.host, port }, () => resolve(s));
    s.once('error', reject);
  });
  let sock = await connect();
  let rd = replyReader(sock);
  const timer = setTimeout(() => { rd.fail(new Error('SMTP timeout')); sock.destroy(); }, timeoutMs);
  sock.on('error', (e) => rd.fail(e));
  // label: what to call this step in an error message. Never the line itself for login steps.
  const cmd = async (line, okCodes, label) => {
    if (line !== null) sock.write(`${line}\r\n`);
    const r = await rd.next();
    if (!okCodes.includes(r.code)) throw new Error(`SMTP ${label || (line === null ? 'greeting' : line.split(' ')[0])} failed: ${r.code} ${r.text.slice(0, 200)}`);
    return r;
  };
  try {
    await cmd(null, [220]);
    let ehlo = await cmd(`EHLO ${os.hostname() || 'localhost'}`, [250]);
    const offersTls = /STARTTLS/i.test(ehlo.text);
    // requireTls: false exists only for the local fake server in tests.
    if (!implicit && !offersTls && opts.requireTls !== false) throw new Error('SMTP server does not offer STARTTLS; refusing to send the password in clear text');
    if (!implicit && offersTls) {
      await cmd('STARTTLS', [220]);
      rd.detach();
      sock = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: sock, servername: opts.host, ...(opts.tlsOptions || {}) }, () => resolve(t));
        t.once('error', reject);
      });
      rd = replyReader(sock);
      sock.on('error', (e) => rd.fail(e));
      ehlo = await cmd(`EHLO ${os.hostname() || 'localhost'}`, [250]);
    }
    if (opts.user) {
      await cmd('AUTH LOGIN', [334]);
      await cmd(Buffer.from(opts.user).toString('base64'), [334], 'login (user name)');
      await cmd(Buffer.from(opts.pass || '').toString('base64'), [235], 'login (password)');
    }
    await cmd(`MAIL FROM:<${opts.from}>`, [250]);
    for (const r of opts.to) await cmd(`RCPT TO:<${r}>`, [250, 251]);
    await cmd('DATA', [354]);
    const msg = buildMessage({ from: opts.from, to: opts.to, subject, text }).replace(/\r\n\./g, '\r\n..');
    await cmd(`${msg}\r\n.`, [250], 'message');
    sock.write('QUIT\r\n');
  } finally {
    clearTimeout(timer);
    sock.end();
  }
}

function subjectFor(text) {
  const first = text.replace(/^\[AI Operator Weekly · (\w+)\]\s*/, (_, w) => `${w}: `).split(/(?<=[.!?])\s/)[0];
  return `AI Operator Weekly · ${first}`.slice(0, 140);
}

function macNotify(text) {
  return new Promise((resolve) => {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execFile('osascript', ['-e', `display notification "${esc(text.slice(0, 220))}" with title "AI Operator Weekly"`], () => resolve());
  });
}

// cfg.alerts: { slackWebhook, email: { host, port, user, pass, from, to: [] }, macNotify }
function makeNotifier(cfg, fetchImpl = fetch, deps = {}) {
  const send = deps.sendMail || sendMail;
  const notify = deps.macNotify || macNotify;
  const a = cfg.alerts || {};
  return async (text) => {
    const results = [];
    console.error(`ALERT: ${text}`);
    if (a.email && a.email.host && a.email.to && a.email.to.length) {
      try { await send(a.email, { subject: subjectFor(text), text }); results.push('email'); } catch (e) { console.error(`ALERT (email failed: ${e.message})`); }
    }
    if (a.slackWebhook) {
      try {
        const r = await fetchImpl(a.slackWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        if (r && r.ok === false) throw new Error(`HTTP ${r.status}`);
        results.push('slack');
      } catch (e) { console.error(`ALERT (Slack failed: ${e.message})`); }
    }
    if (a.macNotify) { await notify(text); results.push('mac'); }
    return results;
  };
}

module.exports = { sendMail, makeNotifier, buildMessage, subjectFor };
