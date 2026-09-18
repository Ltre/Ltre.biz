const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const ctx = {
  chrome: { permissions: { contains: async () => true, request: async () => true } },
  URL,
  fetch: async () => { throw new Error('network must not be called in unit test'); }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../lib/ai.js'), 'utf8'), ctx);

const A = ctx.TemuAI;
assert(A.PROVIDERS.openai);
assert(A.PROVIDERS.anthropic);
assert(A.PROVIDERS.gemini);
assert(A.PROVIDERS.deepseek);
assert(A.PROVIDERS.custom_openai);
assert.deepStrictEqual(JSON.parse(JSON.stringify(A.parseJsonLoose('```json\n{"decision":"review"}\n```'))), { decision: 'review' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(A.parseJsonLoose('prefix ["a","b"] suffix'))), ['a', 'b']);
console.log('ai.test.js: OK');
