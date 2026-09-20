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

  async function inspectRiskChallenge(service, screenshotDataUrl, pageInfo = {}) {
    const system = '你是浏览器风控页面识别器。你的任务仅是识别页面是否出现图形/图片/滑块等人机验证，并描述验证码类型和人工完成验证时应注意的页面提示。严禁求解验证码本身，严禁给出要点击的图片、文字答案、滑块坐标或任何绕过验证的方法。只输出严格 JSON。';
    const prompt = `页面检测信息：${JSON.stringify(pageInfo).slice(0, 6000)}\n请根据截图判断。返回 {"challenge":true|false,"type":"image_grid|image_click|slider|text_image|other|unknown","confidence":0到1,"manual_required":true,"summary":"不包含答案的简短说明"}。`;
    const content = [{ type: 'text', text: prompt }];
    if (screenshotDataUrl) content.push({ type: 'image_url', image_url: { url: screenshotDataUrl } });
    const r = await chat(service, [{ role: 'system', content: system }, { role: 'user', content }], { maxTokens: 450, temperature: 0 });
    const obj = parseJsonLoose(r.text);
    return {
      challenge: obj?.challenge !== false,
      type: String(obj?.type || 'unknown'),
      confidence: Math.max(0, Math.min(1, Number(obj?.confidence) || 0)),
      manual_required: true,
      summary: String(obj?.summary || '检测到风控图形验证，请人工完成后继续。').slice(0, 500)
    };
  }

  root.TemuAI = { ensureOriginPermission, requestCode, verifyCode, logout, getMe, getModels, chat, callText, parseJsonLoose, expandKeywords, reviewCandidate, inspectRiskChallenge };
})(typeof globalThis !== 'undefined' ? globalThis : this);
