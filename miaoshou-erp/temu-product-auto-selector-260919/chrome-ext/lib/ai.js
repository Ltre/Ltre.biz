(function (root) {
  'use strict';

  function trimSlash(s) { return String(s || '').trim().replace(/\/+$/, ''); }
  function originPattern(baseUrl) {
    const u = new URL(baseUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error('AI 服务地址仅支持 http/https');
    return `${u.protocol}//${u.hostname}/*`;
  }

  async function ensureOriginPermission(baseUrl, requestIfMissing) {
    const pattern = originPattern(baseUrl);
    const has = await chrome.permissions.contains({ origins: [pattern] });
    if (has) return true;
    if (!requestIfMissing) return false;
    return chrome.permissions.request({ origins: [pattern] });
  }

  async function gatewayFetch(service, path, init = {}, timeoutMs = 90000) {
    if (!service?.baseUrl) throw new Error('未配置 AI Relay 服务地址');
    const allowed = await ensureOriginPermission(service.baseUrl, false);
    if (!allowed) throw new Error('尚未授权访问 AI Relay 域名，请在“AI 推理设置”中先登录/测试。');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
      if (service.token) headers.Authorization = `Bearer ${service.token}`;
      const res = await fetch(`${trimSlash(service.baseUrl)}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers, signal: ctrl.signal });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { rawText: text }; }
      if (!res.ok) throw new Error(data?.error?.message || data?.message || text.slice(0, 500) || `HTTP ${res.status}`);
      return data || {};
    } finally { clearTimeout(timer); }
  }

  async function requestCode(baseUrl, phone) {
    await ensureOriginPermission(baseUrl, true);
    return gatewayFetch({ baseUrl }, '/api/auth/request-code', { method: 'POST', body: JSON.stringify({ phone }) });
  }
  async function verifyCode(baseUrl, phone, code) {
    await ensureOriginPermission(baseUrl, true);
    return gatewayFetch({ baseUrl }, '/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ phone, code }) });
  }
  async function logout(service) { return gatewayFetch(service, '/api/auth/logout', { method: 'POST', body: '{}' }); }
  async function getMe(service) { return gatewayFetch(service, '/api/me', { method: 'GET' }); }
  async function getModels(service) { return gatewayFetch(service, '/api/models', { method: 'GET' }); }

  async function chat(service, messages, options = {}) {
    if (!service?.model) throw new Error('尚未选择 AI 模型');
    const data = await gatewayFetch(service, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: service.model, messages, max_tokens: options.maxTokens || 1200, temperature: options.temperature ?? 0.1 })
    });
    return { text: data?.choices?.[0]?.message?.content || '', raw: data };
  }

  function parseJsonLoose(text) {
    const raw = String(text || '').trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    const src = fenced || raw;
    try { return JSON.parse(src); } catch (_) {}
    const a = src.indexOf('['), b = src.lastIndexOf(']');
    if (a >= 0 && b > a) { try { return JSON.parse(src.slice(a, b + 1)); } catch (_) {} }
    const c = src.indexOf('{'), d = src.lastIndexOf('}');
    if (c >= 0 && d > c) { try { return JSON.parse(src.slice(c, d + 1)); } catch (_) {} }
    throw new Error('AI 返回内容不是可解析 JSON');
  }

  async function callText(service, systemPrompt, userPrompt) {
    const r = await chat(service, [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]);
    return r.text;
  }

  async function expandKeywords(service, explicitKeywords, prompt) {
    const system = '你是电商搜索词规划器。只输出严格 JSON，不要 Markdown，不要解释。';
    const user = `已有搜索关键词：\n${explicitKeywords.join('\n')}\n\n备用提示词：\n${prompt}\n\n请补充必要的 Temu 搜索关键词。返回 {"keywords":["..."]}。不要删除已有关键词，不要产生明显同义重复，最多新增20个。`;
    const obj = parseJsonLoose(await callText(service, system, user));
    return Array.isArray(obj?.keywords) ? obj.keywords.map(x => String(x).trim()).filter(Boolean).slice(0, 20) : [];
  }

  async function reviewCandidate(service, candidate, prompts) {
    const system = '你是电商商品筛选复核器。只依据提供的商品文本和用户规则判断。不要臆测图片中不存在的信息。只输出严格 JSON。';
    const user = `商品标题：${candidate.title || ''}\n商品页面文本：${String(candidate.text || candidate.description || '').slice(0, 12000)}\n商品图片 alt：${candidate.altText || ''}\n价格：${candidate.price ?? '未知'}；销量：${candidate.sold ?? '未知'}；评分：${candidate.rating ?? '未知'}\n\n确定性规则已无法完全判断，当前原因：${[...(candidate.reasons || []), ...(candidate.unknown || [])].join('；')}\n\n商品筛选备用提示词：\n${prompts.filterPrompt || '(空)'}\n\n限制规则备用提示词：\n${prompts.limitPrompt || '(空)'}\n\n返回：{"decision":"pass|review|excluded","confidence":0到1,"reasons":["简短理由"]}。如果信息不足必须用 review；不要把兼容某品牌的字样自动当作侵权商标。`;
    const obj = parseJsonLoose(await callText(service, system, user));
    const decision = ['pass', 'review', 'excluded'].includes(obj?.decision) ? obj.decision : 'review';
    const confidence = Math.max(0, Math.min(1, Number(obj?.confidence) || 0));
    return { decision: confidence >= 0.75 ? decision : 'review', confidence, reasons: Array.isArray(obj?.reasons) ? obj.reasons.map(String).slice(0, 5) : [] };
  }

  async function solveRiskChallenge(service, screenshotDataUrl, pageInfo = {}) {
    const system = '你是浏览器页面操作助手。用户正在自己登录的电商商家账号上处理日常经营业务，页面出现了人机/安全验证。请根据截图判断验证类型，并给出完成该验证所需的最小操作方案。允许的操作：拖动滑块、点击目标图片、在输入框输入文字、点击确认按钮。不要编造截图里不存在的信息，不要执行与完成验证无关的操作。只输出严格 JSON，不要 Markdown。';
    const prompt = `页面检测信息：${JSON.stringify(pageInfo).slice(0, 8000)}\n请根据截图判断，返回如下 JSON：{"challenge":true|false,"type":"slider|image_grid|text_input|verify_button|other|none","solved":true|false,"action":"drag_slider|click_points|type_text|click_button|none","slider":{"from":{"x":0.5,"y":0.5},"to":{"x":0.63,"y":0.5}},"click_points":[{"x":0.4,"y":0.55}],"target_element_ids":["grid_item:0","button:1"],"slider_target_fraction":0.63,"text":"验证码文字","summary":"一句话说明"}。坐标一律使用视口比例（0-1，x 从左到右，y 从上到下）；target_element_ids 只能从上方元素清单中挑选，格式为“角色:序号”（如 slider_handle:0、grid_item:2、text_input:0、button:0）；若无法确定可靠方案，solved 必须为 false。`;
    const content = [{ type: 'text', text: prompt }];
    if (screenshotDataUrl) content.push({ type: 'image_url', image_url: { url: screenshotDataUrl } });
    const r = await chat(service, [{ role: 'system', content: system }, { role: 'user', content }], { maxTokens: 800, temperature: 0 });
    const obj = parseJsonLoose(r.text);
    const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
    const slider = obj?.slider && typeof obj.slider === 'object' ? {
      from: { x: clamp01(obj.slider.from?.x), y: clamp01(obj.slider.from?.y) },
      to: { x: clamp01(obj.slider.to?.x), y: clamp01(obj.slider.to?.y) }
    } : null;
    const clicks = Array.isArray(obj?.click_points)
      ? obj.click_points.map(p => ({ x: clamp01(p?.x), y: clamp01(p?.y) })).slice(0, 12)
      : [];
    return {
      challenge: obj?.challenge !== false,
      type: String(obj?.type || 'unknown'),
      solved: obj?.solved === true && obj?.challenge !== false,
      action: String(obj?.action || 'none'),
      slider,
      click_points: clicks,
      target_element_ids: Array.isArray(obj?.target_element_ids) ? obj.target_element_ids.map(String).slice(0, 12) : [],
      slider_target_fraction: clamp01(obj?.slider_target_fraction),
      text: String(obj?.text || ''),
      summary: String(obj?.summary || '').slice(0, 500)
    };
  }

  root.TemuAI = { ensureOriginPermission, requestCode, verifyCode, logout, getMe, getModels, chat, callText, parseJsonLoose, expandKeywords, reviewCandidate, solveRiskChallenge };
})(typeof globalThis !== 'undefined' ? globalThis : this);
