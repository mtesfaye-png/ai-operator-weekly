// Structural checks on the n8n workflow exports: valid JSON, every connection points at a real node,
// inactive on import, and nothing calls beehiiv or any publish/send route.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'n8n');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  test(`n8n workflow ${f} is well-formed and draft-safe`, () => {
    const wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const names = new Set(wf.nodes.map((n) => n.name));
    assert.equal(names.size, wf.nodes.length, 'node names unique');
    assert.equal(wf.active, false, 'imports inactive so nothing runs before setup');
    assert.equal(wf.settings.timezone, 'America/New_York');
    for (const [from, out] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), `connection source ${from}`);
      out.main.flat().forEach((c) => assert.ok(names.has(c.node), `connection target ${c.node}`));
    }
    assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger'));
    const text = JSON.stringify(wf);
    assert.equal(/beehiiv|\/publish|\/send|confirmed/i.test(text), false);
  });
}
