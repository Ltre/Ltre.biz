(function (root) {
  'use strict';

  const FEATURE_GROUPS = {
    hd: {
      label: '高清/高透',
      terms: ['高清', '高透', '超清', '透明', '清晰', 'hd', 'ultra hd', 'high definition', 'clear', 'crystal clear', 'ultra clear']
    },
    privacy: {
      label: '防窥',
      terms: ['防窥', '防偷窥', 'privacy', 'anti spy', 'anti-spy', 'anti peeping', 'anti-peeping']
    },
    tempered: {
      label: '钢化膜',
      terms: ['钢化', '钢化膜', 'tempered', 'tempered glass', '9h', 'screen protector glass']
    },
    matte: {
      label: '磨砂',
      terms: ['磨砂', 'matte', 'frosted', 'anti glare', 'anti-glare']
    },
    hydrogel: {
      label: '水凝膜/软膜',
      terms: ['水凝', '水凝膜', 'hydrogel', 'soft film', 'tpu film', 'pet film']
    },
    lens: {
      label: '镜头膜',
      terms: ['镜头膜', '镜头保护', 'camera lens', 'lens protector', 'camera protector', 'camera glass']
    },
    screen: {
      label: '屏幕膜',
      terms: ['屏幕膜', '手机膜', 'screen protector', 'screen film', 'display protector', 'protective glass']
    }
  };

  const DEFAULTS = {
    maxProductsPerKeyword: 80,
    maxPages: 3,
    maxDetails: 20,
    maxScrollsPerPage: 8,
    dedupeThreshold: 0.82,
    noHistoricalRepeat: true,
    blockedBrands: [],
    allowedCompatibilityBrands: ['iphone', 'apple', 'samsung', 'galaxy'],
    minPrice: null,
    maxPrice: null,
    minSold: null,
    minRating: null,
    visualTrademarkReview: false
  };

  const EXAMPLE = {
    keywords: `iphone手机膜\niphone钢化膜\n三星钢化膜\nSamsung Galaxy钢化膜`,
    filterRules: `只要高清/高透/透明钢化膜\n不要防窥膜、磨砂膜、水凝膜/软膜\n2-4片装\n手机屏幕膜，不要镜头膜`,
    limitRules: `规避商标/品牌词：Spigen, ESR, ZAGG, Belkin, OtterBox\n允许兼容品牌词：iPhone, Apple, Samsung, Galaxy\n同一任务标题相似度 >= 0.82 视为重复\n历史已采集商品不要重复\n每个关键词最多扫描80个商品\n最多翻3页\n最多打开20个详情页确认`
  };

  function clean(s) {
    return String(s || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/[_–—]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitLines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function splitTerms(s) {
    return String(s || '')
      .split(/[，,、;；|/]+/)
      .map(v => clean(v).replace(/^(?:和|及|以及)\s*/, '').trim())
      .filter(Boolean);
  }

  function detectFeatureKeys(line) {
    const t = clean(line);
    const keys = [];
    for (const [key, group] of Object.entries(FEATURE_GROUPS)) {
      if (group.terms.some(term => t.includes(clean(term)))) keys.push(key);
    }
    return keys;
  }

  function parsePackRange(text) {
    const t = clean(text);
    let m = t.match(/(\d+)\s*(?:-|~|～|至|到)\s*(\d+)\s*(?:片|个|pcs?|pieces?|pack)/i);
    if (m) return { min: Number(m[1]), max: Number(m[2]) };
    m = t.match(/(?:只要|要求|限定|必须)?\s*(\d+)\s*(?:片|个|pcs?|pieces?)\s*(?:装|pack)?/i);
    if (m && /片|pcs?|pieces?|装|pack/i.test(t)) return { min: Number(m[1]), max: Number(m[1]) };
    return null;
  }

  function parseFilterRules(text) {
    const rules = {
      requireFeatures: new Set(),
      excludeFeatures: new Set(),
      requireTerms: [],
      excludeTerms: [],
      packRange: null,
      raw: splitLines(text)
    };

    for (const lineRaw of rules.raw) {
      const line = clean(lineRaw);
      const pack = parsePackRange(line);
      if (pack) rules.packRange = pack;

      // Handle mixed expressions such as “手机屏幕膜，不要镜头膜” by
      // treating text before the first negative marker as positive context and
      // the remainder as exclusions.
      const negMatch = line.match(/(?:不要|排除|禁止|避开|规避)/);
      if (negMatch) {
        const idx = negMatch.index || 0;
        const before = line.slice(0, idx);
        const after = line.slice(idx + negMatch[0].length);
        detectFeatureKeys(before).forEach(k => rules.requireFeatures.add(k));
        detectFeatureKeys(after).forEach(k => rules.excludeFeatures.add(k));

        const colonPart = lineRaw.split(/[：:]/).slice(1).join(':');
        if (colonPart) {
          rules.excludeTerms.push(...splitTerms(colonPart));
        } else {
          // Generic negative phrases are useful for rules like “不要带支架、不要黑边”.
          const generic = splitTerms(after).map(v => clean(v).replace(/^(?:不要|排除|禁止|避开|规避)\s*/, '')).filter(v => v.length >= 2 && v.length <= 40);
          rules.excludeTerms.push(...generic);
        }
        continue;
      }

      const features = detectFeatureKeys(line);
      const isRequire = /^(?:只要|必须|要求|仅要|需要)|(?:必须|只要)/.test(line);
      if (isRequire || features.length) {
        // Domain-specific: a positive feature line is interpreted as required.
        features.forEach(k => rules.requireFeatures.add(k));
        const colonPart = lineRaw.split(/[：:]/).slice(1).join(':');
        if (colonPart && /(?:必须包含|包含词|关键词|要求|只要)/.test(line)) {
          rules.requireTerms.push(...splitTerms(colonPart));
        }
      }
    }

    // "屏幕膜，不要镜头膜" should require screen and exclude lens.
    const all = clean(text);
    if (/不要[^\n]*(?:镜头|camera lens|lens protector)/i.test(all)) rules.excludeFeatures.add('lens');
    if (/(?:手机屏幕膜|屏幕保护膜|screen protector)/i.test(all)) rules.requireFeatures.add('screen');

    return {
      ...rules,
      requireFeatures: Array.from(rules.requireFeatures),
      excludeFeatures: Array.from(rules.excludeFeatures)
    };
  }

  function parseNumberLike(s) {
    if (s == null) return null;
    const t = clean(s).replace(/,/g, '');
    const m = t.match(/([\d.]+)\s*([k万w]?)/i);
    if (!m) return null;
    let n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    const unit = m[2].toLowerCase();
    if (unit === 'k') n *= 1000;
    if (unit === '万' || unit === 'w') n *= 10000;
    return n;
  }

  function parseLimitRules(text) {
    const cfg = { ...DEFAULTS };
    const lines = splitLines(text);
    let genericTrademarkAvoidance = false;
    for (const raw of lines) {
      const line = clean(raw);
      let m;
      if ((m = line.match(/(?:规避|避开|排除|禁止)[^：:]{0,12}(?:商标|品牌)[^：:]*[：:]\s*(.+)$/))) {
        cfg.blockedBrands = splitTerms(m[1]);
      } else if (/(?:规避|避开|不要|排除|禁止)[^\n]{0,16}(?:商标|logo|品牌)/i.test(line)) {
        genericTrademarkAvoidance = true;
      }
      if ((m = line.match(/允许[^：:]{0,12}(?:兼容|品牌)[^：:]*[：:]\s*(.+)$/))) {
        cfg.allowedCompatibilityBrands = splitTerms(m[1]);
      }
      if ((m = line.match(/(?:相似度|重复阈值)[^\d]*(0?\.\d+|1(?:\.0+)?)/))) {
        const v = Number(m[1]);
        if (v >= 0.5 && v <= 1) cfg.dedupeThreshold = v;
      }
      if (/历史[^\n]*(?:不要重复|去重)|已采集[^\n]*(?:不要重复|排除)/.test(line)) cfg.noHistoricalRepeat = true;
      if (/允许历史重复|不检查历史/.test(line)) cfg.noHistoricalRepeat = false;
      if ((m = line.match(/每个关键词[^\d]{0,12}(?:最多|上限)[^\d]*(\d+)\s*(?:个|件)?(?:商品)?/))) cfg.maxProductsPerKeyword = clamp(Number(m[1]), 5, 500);
      if ((m = line.match(/最多[^\d]*(\d+)\s*(?:页|page)/))) cfg.maxPages = clamp(Number(m[1]), 1, 20);
      if ((m = line.match(/最多[^\d]*(?:打开)?[^\d]*(\d+)\s*(?:个|件)?详情/))) cfg.maxDetails = clamp(Number(m[1]), 0, 100);
      if ((m = line.match(/(?:最多滚动|滚动上限)[^\d]*(\d+)\s*(?:次|屏)?/))) cfg.maxScrollsPerPage = clamp(Number(m[1]), 1, 30);
      if ((m = line.match(/价格\s*(?:>=|≥|不少于|最低)\s*([\d.]+)/))) cfg.minPrice = Number(m[1]);
      if ((m = line.match(/价格\s*(?:<=|≤|不高于|最高)\s*([\d.]+)/))) cfg.maxPrice = Number(m[1]);
      if ((m = line.match(/(?:销量|已售)\s*(?:>=|≥|不少于|最低)\s*([\d.k万w]+)/i))) cfg.minSold = parseNumberLike(m[1]);
      if ((m = line.match(/(?:评分|星级)\s*(?:>=|≥|不少于|最低)\s*([\d.]+)/))) cfg.minRating = Number(m[1]);
    }
    cfg.visualTrademarkReview = genericTrademarkAvoidance && !(cfg.blockedBrands || []).length;
    return cfg;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function containsAny(text, terms) {
    const t = clean(text);
    return terms.some(term => t.includes(clean(term)));
  }

  function extractPackCount(text) {
    const t = clean(text);
    const patterns = [
      /(?:^|\D)(\d{1,2})\s*(?:pcs?|pieces?|片|个)\b/i,
      /(?:pack of|set of)\s*(\d{1,2})/i,
      /(\d{1,2})\s*(?:pack|count|ct)\b/i,
      /(?:^|\D)(\d{1,2})\s*片装/
    ];
    for (const p of patterns) {
      const m = t.match(p);
      if (m) return Number(m[1]);
    }
    return null;
  }

  function featurePresence(text, key) {
    const group = FEATURE_GROUPS[key];
    if (!group) return false;
    return containsAny(text, group.terms);
  }

  function brandBlocked(text, cfg) {
    const t = clean(text);
    for (const brand of cfg.blockedBrands || []) {
      const b = clean(brand);
      if (!b) continue;
      if (!t.includes(b)) continue;
      // If explicitly allowed for compatibility, treat "for/compatible with X" as compatibility, not seller brand.
      if ((cfg.allowedCompatibilityBrands || []).some(a => clean(a) === b)) {
        const compat = new RegExp(`(?:for|compatible\\s+with|适用|兼容)\\s*${escapeRegExp(b)}`, 'i');
        if (compat.test(t)) continue;
      }
      return brand;
    }
    return null;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function evaluate(item, parsedFilter, limitCfg, opts) {
    opts = opts || {};
    const text = clean([item.title, item.text, item.description, item.altText].filter(Boolean).join(' '));
    const reasons = [];
    const unknown = [];

    const badBrand = brandBlocked(text, limitCfg);
    if (badBrand) reasons.push(`命中规避品牌/商标词：${badBrand}`);
    if (limitCfg.visualTrademarkReview) unknown.push('需人工确认图片/商品主体是否带商标或 Logo');

    for (const key of parsedFilter.excludeFeatures || []) {
      if (featurePresence(text, key)) reasons.push(`命中排除项：${FEATURE_GROUPS[key]?.label || key}`);
    }

    for (const term of parsedFilter.excludeTerms || []) {
      if (term && clean(text).includes(clean(term))) reasons.push(`命中排除词：${term}`);
    }

    for (const term of parsedFilter.requireTerms || []) {
      if (term && !clean(text).includes(clean(term))) unknown.push(`未确认包含词：${term}`);
    }

    for (const key of parsedFilter.requireFeatures || []) {
      if (!featurePresence(text, key)) unknown.push(`未确认：${FEATURE_GROUPS[key]?.label || key}`);
    }

    const pack = extractPackCount(text);
    if (parsedFilter.packRange) {
      if (pack == null) unknown.push(`未确认片数（要求 ${parsedFilter.packRange.min}-${parsedFilter.packRange.max}）`);
      else if (pack < parsedFilter.packRange.min || pack > parsedFilter.packRange.max) reasons.push(`片数 ${pack} 不在 ${parsedFilter.packRange.min}-${parsedFilter.packRange.max} 范围`);
    }

    if (limitCfg.minPrice != null) {
      if (item.price == null) unknown.push(`未确认价格（要求 >= ${limitCfg.minPrice}）`);
      else if (item.price < limitCfg.minPrice) reasons.push(`价格 ${item.price} < ${limitCfg.minPrice}`);
    }
    if (limitCfg.maxPrice != null) {
      if (item.price == null) unknown.push(`未确认价格（要求 <= ${limitCfg.maxPrice}）`);
      else if (item.price > limitCfg.maxPrice) reasons.push(`价格 ${item.price} > ${limitCfg.maxPrice}`);
    }
    if (limitCfg.minSold != null) {
      if (item.sold == null) unknown.push(`未确认销量（要求 >= ${limitCfg.minSold}）`);
      else if (item.sold < limitCfg.minSold) reasons.push(`销量 ${item.sold} < ${limitCfg.minSold}`);
    }
    if (limitCfg.minRating != null) {
      if (item.rating == null) unknown.push(`未确认评分（要求 >= ${limitCfg.minRating}）`);
      else if (item.rating < limitCfg.minRating) reasons.push(`评分 ${item.rating} < ${limitCfg.minRating}`);
    }

    if (opts.historicalDuplicate) reasons.push('历史任务中已执行过采集');
    if (opts.taskDuplicateOf) reasons.push(`与本任务商品高度相似：${opts.taskDuplicateOf}`);

    const decision = reasons.length ? 'excluded' : unknown.length ? 'review' : 'pass';
    return { decision, reasons, unknown, packCount: pack };
  }

  function normalizeTitleForSimilarity(title) {
    return clean(title)
      .replace(/\b(?:new|hot|sale|fashion|premium|quality|best|latest|202[0-9])\b/g, ' ')
      .replace(/(?:新品|热卖|爆款|优质|高级|促销|特价)/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function ngrams(s, n) {
    const compact = normalizeTitleForSimilarity(s).replace(/\s+/g, '');
    const arr = [];
    if (compact.length <= n) return compact ? [compact] : [];
    for (let i = 0; i <= compact.length - n; i++) arr.push(compact.slice(i, i + n));
    return arr;
  }

  function diceSimilarity(a, b) {
    const aa = ngrams(a, 3);
    const bb = ngrams(b, 3);
    if (!aa.length || !bb.length) return 0;
    const counts = new Map();
    for (const x of aa) counts.set(x, (counts.get(x) || 0) + 1);
    let intersection = 0;
    for (const x of bb) {
      const c = counts.get(x) || 0;
      if (c > 0) {
        intersection++;
        counts.set(x, c - 1);
      }
    }
    return (2 * intersection) / (aa.length + bb.length);
  }

  function productIdFromUrl(url) {
    try {
      const u = new URL(url, 'https://www.temu.com/');
      let m = u.pathname.match(/-g-(\d+)\.html/i);
      if (m) return m[1];
      for (const key of ['goods_id', 'goodsId', 'goodsid', 'product_id']) {
        const v = u.searchParams.get(key);
        if (v) return v;
      }
    } catch (_) {}
    return null;
  }

  function canonicalUrl(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      const id = productIdFromUrl(url);
      if (id) return `${u.origin}${u.pathname}`;
      ['refer_page_name', 'refer_page_id', 'refer_page_sn', '_x_sessn_id', '_x_vst_scene'].forEach(k => u.searchParams.delete(k));
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  function fingerprint(item) {
    const id = item.productId || productIdFromUrl(item.url || '');
    return {
      id: id || null,
      titleNorm: normalizeTitleForSimilarity(item.title || ''),
      key: id ? `id:${id}` : `title:${normalizeTitleForSimilarity(item.title || '')}`
    };
  }

  const api = {
    FEATURE_GROUPS,
    DEFAULTS,
    EXAMPLE,
    clean,
    splitLines,
    parseFilterRules,
    parseLimitRules,
    extractPackCount,
    evaluate,
    diceSimilarity,
    normalizeTitleForSimilarity,
    productIdFromUrl,
    canonicalUrl,
    fingerprint,
    parseNumberLike
  };

  root.TemuRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
