const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const code = fs.readFileSync(require('path').join(__dirname, '../lib/ai.js'), 'utf8');
const sandbox = { globalThis: {}, URL, console };
vm.runInNewContext(code, sandbox);
const AI = sandbox.globalThis.TemuAI;

assert.ok(AI);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(AI.parseJsonLoose('```json\n{"keywords":["iphone glass"]}\n```'))),
  { keywords: ['iphone glass'] }
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(AI.parseJsonLoose('prefix {"decision":"review","confidence":0.4} suffix'))),
  { decision: 'review', confidence: 0.4 }
);
console.log('ai.test.js: OK');
