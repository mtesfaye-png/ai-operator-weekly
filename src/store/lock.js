// One collect run at a time per data folder, across processes (trigger server, CLI, a second container).
// The lock is a file created with O_EXCL; a lock older than STALE_MS is left over from a crash and is taken over.
// Holds no secrets; lives in data/ (gitignored).

const fs = require('fs');
const path = require('path');

const STALE_MS = 30 * 60000;
const file = (dataDir, name) => path.join(dataDir, `${name}.lock`);

// Returns a release function, or null if another live run holds the lock.
function acquire(dataDir, name, now = Date.now()) {
  fs.mkdirSync(dataDir, { recursive: true });
  const f = file(dataDir, name);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(f, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }), { flag: 'wx' });
      return () => fs.rmSync(f, { force: true });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let at = 0;
      try { at = Date.parse(JSON.parse(fs.readFileSync(f, 'utf8')).at) || 0; } catch { /* unreadable: treat as stale */ }
      if (now - at < STALE_MS) return null;
      fs.rmSync(f, { force: true });
    }
  }
  return null;
}

module.exports = { acquire, STALE_MS };
