const assert = require('assert');
const R = require('../lib/rules.js');

const filter = R.parseFilterRules('只要高清/高透/透明钢化膜\n不要防窥膜、磨砂膜、水凝膜/软膜\n2-4片装\n手机屏幕膜，不要镜头膜');
const limits = R.parseLimitRules('规避商标/品牌词：Spigen, ESR\n同一任务标题相似度 >= 0.82 视为重复\n每个关键词最多扫描80个商品\n最多翻3页\n最多打开20个详情页确认');

assert(filter.requireFeatures.includes('hd'));
assert(filter.requireFeatures.includes('tempered'));
assert(filter.excludeFeatures.includes('privacy'));
assert(filter.excludeFeatures.includes('lens'));
assert.deepStrictEqual(filter.packRange, { min: 2, max: 4 });
assert.strictEqual(limits.maxProductsPerKeyword, 80);
assert.strictEqual(limits.maxPages, 3);
assert.strictEqual(limits.maxDetails, 20);

let ev = R.evaluate({ title: '3pcs Ultra HD Tempered Glass Screen Protector for iPhone 17 Pro Max' }, filter, limits, {});
assert.strictEqual(ev.decision, 'pass');
assert.strictEqual(ev.packCount, 3);

ev = R.evaluate({ title: '3pcs Privacy Tempered Glass Screen Protector for iPhone 17 Pro Max' }, filter, limits, {});
assert.strictEqual(ev.decision, 'excluded');
assert(ev.reasons.some(x => x.includes('防窥')));

ev = R.evaluate({ title: '5pcs Ultra HD Tempered Glass Screen Protector for Samsung Galaxy S25' }, filter, limits, {});
assert.strictEqual(ev.decision, 'excluded');
assert(ev.reasons.some(x => x.includes('片数')));

assert(R.diceSimilarity('3pcs ultra hd tempered glass screen protector iphone 17 pro max', '3 pcs ultra hd tempered glass screen protector for iphone 17 pro max') > 0.82);
assert.strictEqual(R.productIdFromUrl('https://www.temu.com/a-b-g-605979282356559.html'), '605979282356559');
console.log('rules.test.js: OK');

const generic = R.parseFilterRules('必须包含：9H, full coverage\n不要：支架, 黑边');
assert(generic.requireTerms.includes('9h'));
assert(generic.requireTerms.includes('full coverage'));
assert(generic.excludeTerms.includes('支架'));
assert(generic.excludeTerms.includes('黑边'));

const visualLimits = R.parseLimitRules('规避商标和Logo\n每个关键词最多扫描20个商品');
assert.strictEqual(visualLimits.visualTrademarkReview, true);
const visualEv = R.evaluate({ title: '3pcs Ultra HD Tempered Glass Screen Protector' }, R.parseFilterRules('只要高清钢化膜'), visualLimits, {});
assert.strictEqual(visualEv.decision, 'review');
