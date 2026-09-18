(() => {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const randBetween = (min, max) => Math.round(min + Math.random() * Math.max(0, max - min));
  const ERP_EXTENSION_ID = 'ecofkipcicjifkppbgnkaghcfofmpkia';

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity || 1) > 0;
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function nativeSetValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function isChallengePage() {
    const body = (document.body?.innerText || '').toLowerCase().slice(0, 18000);
    if (/(?:verify you are human|are you a robot|security verification|captcha|human verification|人机验证|安全验证|滑块验证|请完成验证|请验证|访问异常)/i.test(body)) return true;
    const challengeSelectors = [
      'iframe[src*="captcha" i]', 'iframe[src*="challenge" i]', 'iframe[src*="recaptcha" i]', 'iframe[src*="arkose" i]',
      '[id*="captcha" i]', '[class*="captcha" i]', '[id*="challenge" i][role="dialog"]', '[class*="challenge" i][role="dialog"]'
    ];
    for (const sel of challengeSelectors) {
      try { if (Array.from(document.querySelectorAll(sel)).some(visible)) return true; } catch (_) {}
    }
    return false;
  }

  function findSearchInput() {
    const selectors = [
      'input[type="search"]',
      'input[name="search"]',
      'input[placeholder*="Search" i]',
      'input[placeholder*="搜索"]',
      'input[aria-label*="Search" i]',
      'input[aria-label*="搜索"]'
    ];
    for (const sel of selectors) {
      const list = Array.from(document.querySelectorAll(sel));
      const hit = list.find(visible);
      if (hit) return hit;
    }
    return Array.from(document.querySelectorAll('input')).find(el => visible(el) && /search|搜索/i.test(`${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`));
  }

  function clickableSearchButton(input) {
    const form = input?.closest('form');
    if (form) {
      const btn = Array.from(form.querySelectorAll('button,[role="button"],input[type="submit"]')).find(visible);
      if (btn) return btn;
    }
    const all = Array.from(document.querySelectorAll('button,[role="button"],a'));
    return all.find(el => visible(el) && /^(?:search|搜索)$/i.test(textOf(el))) ||
      all.find(el => visible(el) && /search|搜索/i.test(`${el.getAttribute('aria-label') || ''} ${el.title || ''}`));
  }

  async function searchKeyword(keyword) {
    if (isChallengePage()) return { ok: false, challenge: true, error: '检测到 Temu 人机/安全验证' };
    const input = findSearchInput();
    if (!input) return { ok: false, error: '未找到 Temu 搜索框。请确认当前页面为 Temu 首页或搜索页。' };
    input.focus();
    nativeSetValue(input, keyword);
    const before = location.href;
    const btn = clickableSearchButton(input);

    // Reply to the extension before navigation can tear down this content script.
    setTimeout(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      setTimeout(() => {
        if (location.href === before && btn && document.contains(btn)) btn.click();
      }, 320);
    }, 40);
    return { ok: true, beforeUrl: before, keyword };
  }

  function productId(url) {
    try {
      const u = new URL(url, location.href);
      const m = u.pathname.match(/-g-(\d+)\.html/i);
      if (m) return m[1];
      return u.searchParams.get('goods_id') || u.searchParams.get('goodsId') || u.searchParams.get('product_id');
    } catch (_) { return null; }
  }

  function canonical(url) {
    try {
      const u = new URL(url, location.href);
      u.hash = '';
      return `${u.origin}${u.pathname}`;
    } catch (_) { return url; }
  }

  function parsePrice(text) {
    const t = String(text || '').replace(/,/g, '');
    const patterns = [
      /(?:US\$|CA\$|AU\$|NZ\$|HK\$|SG\$|[$£€¥￥])\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
      /([0-9]+(?:\.[0-9]{1,2})?)\s*(?:USD|GBP|EUR|CNY|RMB)/i
    ];
    for (const p of patterns) {
      const m = t.match(p);
      if (m) return Number(m[1]);
    }
    return null;
  }

  function parseSold(text) {
    const t = String(text || '').replace(/,/g, '');
    const m = t.match(/(?:^|[^\d.])([\d]+(?:\.[\d]+)?)\s*([kK万wW]?)\s*(?:\+?\s*)?(?:sold|已售|销量|件已售|人付款)/i);
    if (!m) return null;
    let n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    if (/k/i.test(m[2])) n *= 1000;
    if (/[万w]/i.test(m[2])) n *= 10000;
    return n;
  }

  function parseRating(text) {
    const t = String(text || '');
    let m = t.match(/\b([0-5](?:\.\d)?)\s*(?:\/\s*5|stars?|星)/i);
    if (m) return Number(m[1]);
    m = t.match(/(?:rating|评分)[^\d]{0,5}([0-5](?:\.\d)?)/i);
    return m ? Number(m[1]) : null;
  }

  function nearestCard(link) {
    let node = link;
    let best = link;
    for (let i = 0; i < 8 && node?.parentElement; i++) {
      node = node.parentElement;
      const txt = textOf(node);
      const productAnchors = Array.from(node.querySelectorAll?.('a[href]') || []).filter(a =>
        /-g-\d+\.html/i.test(a.href || '') || /[?&](?:goods_id|goodsId|product_id)=\d+/i.test(a.href || '')
      );
      const unique = new Set(productAnchors.map(a => productId(a.href) || canonical(a.href)));
      if (unique.size <= 1 && txt.length >= 15 && txt.length <= 1800) best = node;
      if (unique.size > 1 || txt.length > 2200) break;
    }
    return best;
  }

  function leafTextOf(root) {
    if (!root) return '';
    const parts = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.children.length === 0) {
        const t = textOf(el);
        if (t && t.length <= 600) parts.push(t);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function extractTitle(link, card) {
    const direct = [
      link.getAttribute('aria-label'),
      link.getAttribute('title'),
      card?.querySelector('[title]')?.getAttribute('title'),
      card?.querySelector('img[alt]')?.getAttribute('alt')
    ].map(s => (s || '').trim()).filter(s => s.length >= 6);
    if (direct.length) return direct.sort((a, b) => b.length - a.length)[0].slice(0, 500);

    const pieces = Array.from(card?.querySelectorAll?.('h2,h3,[class*="title" i],[class*="name" i],span,div') || [])
      .map(textOf)
      .filter(s => s.length >= 10 && s.length <= 500 && !/^[$£€¥￥]\s*\d/.test(s));
    if (pieces.length) return pieces.sort((a, b) => b.length - a.length)[0].slice(0, 500);
    return textOf(link).slice(0, 500);
  }

  function collectCurrentCards() {
    const anchors = Array.from(document.querySelectorAll('a[href]')).filter(a => {
      const href = a.href || '';
      return /-g-\d+\.html/i.test(href) || /[?&](?:goods_id|goodsId|product_id)=\d+/i.test(href);
    });
    const map = new Map();
    for (const a of anchors) {
      const id = productId(a.href) || canonical(a.href);
      if (!id || map.has(id)) continue;
      const card = nearestCard(a);
      const leafText = leafTextOf(card);
      const cardText = (leafText || textOf(card)).slice(0, 2200);
      const title = extractTitle(a, card);
      if (!title || title.length < 5) continue;
      const img = card?.querySelector?.('img');
      const image = img?.currentSrc || img?.src || null;
      map.set(id, {
        productId: productId(a.href),
        url: canonical(a.href),
        title,
        text: cardText,
        image,
        altText: img?.alt || '',
        price: parsePrice(cardText),
        sold: parseSold(cardText),
        rating: parseRating(cardText)
      });
    }
    return Array.from(map.values());
  }

  async function scanResults(options) {
    options = options || {};
    if (isChallengePage()) return { ok: false, challenge: true, error: '检测到 Temu 人机/安全验证' };
    const maxProducts = Math.max(5, Number(options.maxProducts || 80));
    const maxScrolls = Math.max(1, Number(options.maxScrolls || 8));
    const all = new Map();
    let stable = 0;
    let last = 0;

    for (let i = 0; i <= maxScrolls; i++) {
      for (const item of collectCurrentCards()) {
        const key = item.productId || item.url;
        if (!all.has(key)) all.set(key, item);
        if (all.size >= maxProducts) break;
      }
      if (all.size >= maxProducts) break;
      if (i === maxScrolls) break;
      window.scrollTo({ top: Math.max(document.documentElement.scrollHeight - 900, 0), behavior: 'smooth' });
      await sleep(randBetween(1500, 2600));
      if (all.size === last) stable++; else stable = 0;
      last = all.size;
      if (stable >= 3) break;
    }

    const next = findNextButton();
    return {
      ok: true,
      items: Array.from(all.values()).slice(0, maxProducts),
      hasNext: !!next,
      url: location.href,
      challenge: false
    };
  }

  function findNextButton() {
    const selectors = [
      'a[rel="next"]',
      'button[aria-label*="Next" i]',
      'a[aria-label*="Next" i]',
      'button[aria-label*="下一页"]',
      'a[aria-label*="下一页"]'
    ];
    for (const sel of selectors) {
      const hit = Array.from(document.querySelectorAll(sel)).find(el => visible(el) && !el.disabled);
      if (hit) return hit;
    }
    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"]'));
    return candidates.find(el => visible(el) && !el.disabled && /^(?:next|下一页|下页|›|>)$/i.test(textOf(el)));
  }

  async function clickNext() {
    if (isChallengePage()) return { ok: false, challenge: true };
    const btn = findNextButton();
    if (!btn) return { ok: false, error: '未找到下一页按钮' };
    const before = location.href;
    btn.scrollIntoView({ block: 'center' });
    // As with search, respond before a full navigation destroys this script.
    setTimeout(() => { if (document.contains(btn)) btn.click(); }, 40);
    return { ok: true, beforeUrl: before };
  }

  function detailData() {
    if (isChallengePage()) return { ok: false, challenge: true, error: '检测到 Temu 人机/安全验证' };
    const h1 = Array.from(document.querySelectorAll('h1')).find(visible);
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const title = (textOf(h1) || ogTitle || document.title || '').slice(0, 700);
    const metaDesc = document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content || '';

    // Keep detail analysis scoped around the product title. Reading the entire body
    // can pull recommendation-card text into the decision and create false excludes.
    let scope = h1 || document.querySelector('main') || document.body;
    let node = scope;
    for (let i = 0; i < 7 && node?.parentElement; i++) {
      const parent = node.parentElement;
      const len = textOf(parent).length;
      if (len >= 180 && len <= 14000) scope = parent;
      if (len > 18000) break;
      node = parent;
    }
    let scopedText = textOf(scope).slice(0, 14000);
    if (scopedText.length < 180) scopedText = textOf(document.querySelector('main') || document.body).slice(0, 12000);
    const bodyText = `${title} ${metaDesc} ${scopedText}`.replace(/\s+/g, ' ').slice(0, 18000);
    const scopedImages = Array.from(scope?.querySelectorAll?.('img') || []);
    const alts = scopedImages.map(i => i.alt).filter(Boolean).join(' ').slice(0, 3500);
    return {
      ok: true,
      productId: productId(location.href),
      url: canonical(location.href),
      title,
      description: metaDesc,
      text: bodyText,
      altText: alts,
      price: parsePrice(bodyText),
      sold: parseSold(bodyText),
      rating: parseRating(bodyText)
    };
  }

  function allRoots() {
    const roots = [document];
    const walker = document.createTreeWalker(document.documentElement || document, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) roots.push(node.shadowRoot);
    }
    return roots;
  }

  function findErpButton(customSelector) {
    const roots = allRoots();
    if (customSelector) {
      for (const root of roots) {
        try {
          const el = root.querySelector(customSelector);
          if (el && visible(el)) return { el, source: 'custom-selector', score: 999 };
        } catch (_) {}
      }
    }

    const hits = [];
    for (const root of roots) {
      const nodes = Array.from(root.querySelectorAll('button,a,[role="button"],div,span'));
      for (const el of nodes) {
        if (!visible(el)) continue;
        const txt = textOf(el).trim();
        if (!txt || txt.length > 40) continue;
        let score = 0;
        if (/^采集此产品$/.test(txt)) score += 120;
        else if (/^立即采集$/.test(txt)) score += 110;
        else if (/^采集商品$/.test(txt)) score += 100;
        else if (/^采集$/.test(txt)) score += 70;
        else if (/采集此产品|立即采集/.test(txt)) score += 60;
        if (!score) continue;
        if (el.matches('button,a,[role="button"]')) score += 30;
        const ancestry = `${el.id || ''} ${el.className || ''} ${el.closest('[id],[class]')?.id || ''} ${el.closest('[id],[class]')?.className || ''}`.toLowerCase();
        if (/miaoshou|91miaoshou|msfetch|妙手|cross.?border|erp|ecofkipcicjifkppbgnkaghcfofmpkia/.test(ancestry)) score += 80;
        const st = getComputedStyle(el);
        if (st.position === 'fixed' || st.position === 'sticky') score += 15;
        hits.push({ el, source: 'auto-text', score, txt });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0] || null;
  }

  function detectExtensionIframes() {
    return Array.from(document.querySelectorAll('iframe')).map(f => f.src || '').filter(src => src.startsWith('chrome-extension://'));
  }

  function targetErpIframes() {
    return detectExtensionIframes().filter(src => src.startsWith(`chrome-extension://${ERP_EXTENSION_ID}/`));
  }

  async function triggerErp(options) {
    options = options || {};
    if (isChallengePage()) return { ok: false, challenge: true, error: '检测到 Temu 人机/安全验证' };
    const hit = findErpButton(options.customSelector || '');
    if (!hit) {
      const extFrames = detectExtensionIframes();
      const targetFrames = targetErpIframes();
      return {
        ok: false,
        error: extFrames.length
          ? `检测到扩展 iframe（其中跨境ERP助手 ${targetFrames.length} 个），但无法直接读取其中按钮。可在高级设置填写跨境ERP助手页面按钮 CSS 选择器；若其完全使用封闭扩展 iframe，则 Chrome 的扩展隔离机制不允许另一个扩展直接点击内部控件。`
          : `未找到跨境ERP助手的“采集此产品/立即采集”按钮。请确认扩展已启用、已登录并刷新 Temu 页面。目标扩展 ID：${ERP_EXTENSION_ID}`,
        extensionIframes: extFrames.length,
        targetErpIframes: targetFrames.length
      };
    }
    hit.el.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(100);
    const rect = hit.el.getBoundingClientRect();
    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];
    for (const type of events) {
      try {
        hit.el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          view: window
        }));
      } catch (_) {}
    }
    try { hit.el.click(); } catch (_) {}
    await sleep(900);
    const body = (document.body?.innerText || '').slice(-12000);
    const confirmed = /采集成功|已采集|采集中|collect(?:ed|ing)/i.test(body);
    return { ok: true, triggered: true, confirmed, source: hit.source, text: hit.txt || textOf(hit.el) };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      switch (msg?.type) {
        case 'PING': return { ok: true, url: location.href, challenge: isChallengePage() };
        case 'SEARCH_KEYWORD': return searchKeyword(msg.keyword);
        case 'SCAN_RESULTS': return scanResults(msg.options);
        case 'CLICK_NEXT': return clickNext();
        case 'GET_DETAIL': return detailData();
        case 'TRIGGER_ERP': return triggerErp(msg.options);
        case 'CHECK_CHALLENGE': return { ok: true, challenge: isChallengePage() };
        default: return { ok: false, error: 'Unknown message type' };
      }
    })().then(sendResponse).catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  });
})();
