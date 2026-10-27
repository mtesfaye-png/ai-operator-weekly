// Marks that this machine's local archive has been reconciled with a given Airtable base. When the file is
// missing (temporary cloud container, new machine) or names another base, collect re-reads the base's
// article IDs before writing. Holds no secrets; lives in data/ (gitignored).

const fs = require('fs');
const path = require('path');

const file = (dataDir) => path.join(dataDir, 'airtable_sync_state.json');
const read = (dataDir) => { try { return JSON.parse(fs.readFileSync(file(dataDir), 'utf8')); } catch { return null; } };
const write = (dataDir, state) => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file(dataDir), JSON.stringify(state, null, 2)); };

module.exports = { read, write };
