(function (root) {
  'use strict';

  const PROVIDERS = {
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com', model: 'gpt-5' },
    anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' },
    gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.6-flash' },
    deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
    custom_openai: { label: '自定义 OpenAI 兼容中转', baseUrl: '', model: '' }
  };

  function trimSlash(s) { return String(s || '').trim().replace(/\/+$/, ''); }
  function baseOriginPattern(baseUrl) {
    const u = new URL(baseUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error('AI Base URL 仅支持 http/https');
    return `${u.protocol}//${u.host}/*`;
  }

  async function ensureOriginPermission(profile, requestIfMissing) {
    const pattern = baseOriginPattern(profile.baseUrl);
    const has = await chrome.permissions.contains({ origins: [pattern] });
    if (has) return true;
    if (!requestIfMissing) return false;
    return chrome.permissions.request({ origins: [pattern] });
  }

  async function jsonFetch(url, init, timeoutMs = 60000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : {}; } catch (_) {}
      if (!res.ok) {
        const detail = data?.error?.message || data?.message || text.slice(0, 500) || `HTTP ${res.status}`;
        throw new Error(`${res.status} ${res.statusText}: ${detail}`);
      }
      return data ?? { rawText: text };
    } finally {
      clearTimeout(timer);
    }
  }

  function joinApi(base, path) {
    const b = trimSlash(base);
    if (!b) throw new Error('AI Base URL 不能为空');
    if (b.endsWith('/v1') && path.startsWith('/v1/')) return b + path.slice(3);
    return b + path;
  }

  async function callOpenAICompatible(profile, systemPrompt, userPrompt) {
    const url = profile.apiPath
      ? joinApi(profile.baseUrl, profile.apiPath.startsWith('/') ? profile.apiPath : `/${profile.apiPath}`)
      : joinApi(profile.baseUrl, '/v1/chat/completions');
    const data = await jsonFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${profile.apiKey || ''}`
      },
      body: JSON.stringify({
        model: profile.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        max_tokens: 1200
      })
    });
    return data?.choices?.[0]?.message?.content || data?.output_text || '';
  }

  async function callOpenAI(profile, systemPrompt, userPrompt) {
    // Official OpenAI profile uses Responses API; custom relays use Chat Completions.
    if (profile.provider === 'custom_openai') return callOpenAICompatible(profile, systemPrompt, userPrompt);
    const url = profile.apiPath
      ? joinApi(profile.baseUrl, profile.apiPath.startsWith('/') ? profile.apiPath : `/${profile.apiPath}`)
      : joinApi(profile.baseUrl, '/v1/responses');
    const data = await jsonFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${profile.apiKey || ''}`
      },
      body: JSON.stringify({
        model: profile.model,
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: 1200
      })
    });
    if (data?.output_text) return data.output_text;
    const parts = [];
    for (const item of data?.output || []) {
      for (const c of item?.content || []) if (c?.text) parts.push(c.text);
    }
    return parts.join('\n');
  }

  async function callAnthropic(profile, systemPrompt, userPrompt) {
    const url = profile.apiPath
      ? joinApi(profile.baseUrl, profile.apiPath.startsWith('/') ? profile.apiPath : `/${profile.apiPath}`)
      : joinApi(profile.baseUrl, '/v1/messages');
    const data = await jsonFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': profile.apiKey || '',
        'anthropic-version': profile.anthropicVersion || '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: profile.model,
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    return (data?.content || []).filter(x => x?.type === 'text').map(x => x.text).join('\n');
  }

  async function callGemini(profile, systemPrompt, userPrompt) {
    const model = encodeURIComponent(profile.model || '');
    const url = profile.apiPath
      ? joinApi(profile.baseUrl, profile.apiPath.startsWith('/') ? profile.apiPath : `/${profile.apiPath}`)
      : joinApi(profile.baseUrl, `/v1beta/models/${model}:generateContent`);
    const data = await jsonFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': profile.apiKey || ''
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
      })
    });
    return (data?.candidates?.[0]?.content?.parts || []).map(p => p?.text || '').join('\n');
  }

  async function callText(profile, systemPrompt, userPrompt) {
    if (!profile?.provider) throw new Error('未选择 AI 配置');
    if (!profile.baseUrl || !profile.model || !profile.apiKey) throw new Error('AI 配置缺少 Base URL / 模型 / API Key');
    const allowed = await ensureOriginPermission(profile, false);
    if (!allowed) throw new Error('AI API 域名尚未授权。请到“AI 推理设置”中保存/测试该配置并允许域名访问。');
    if (profile.provider === 'anthropic') return callAnthropic(profile, systemPrompt, userPrompt);
    if (profile.provider === 'gemini') return callGemini(profile, systemPrompt, userPrompt);
    if (profile.provider === 'deepseek') return callOpenAICompatible(profile, systemPrompt, userPrompt);
    return callOpenAI(profile, systemPrompt, userPrompt);
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

  async function expandKeywords(profile, explicitKeywords, prompt) {
    const system = '你是电商搜索词规划器。只输出严格 JSON，不要 Markdown。不要包含解释。';
    const user = `已有搜索关键词：\n${explicitKeywords.join('\n')}\n\n备用提示词：\n${prompt}\n\n请根据备用提示词补充必要的 Temu 搜索关键词。返回 {"keywords":["..."]}。不要删除已有关键词，不要产生明显同义重复，最多新增20个。`;
    const text = await callText(profile, system, user);
    const obj = parseJsonLoose(text);
    return Array.isArray(obj?.keywords) ? obj.keywords.map(x => String(x).trim()).filter(Boolean).slice(0, 20) : [];
  }

  async function reviewCandidate(profile, candidate, prompts) {
    const system = '你是电商商品筛选复核器。只依据提供的商品文本和用户规则判断。不要臆测图片中不存在的信息。只输出严格 JSON。';
    const user = `商品标题：${candidate.title || ''}\n商品页面文本：${String(candidate.text || candidate.description || '').slice(0, 12000)}\n商品图片 alt：${candidate.altText || ''}\n价格：${candidate.price ?? '未知'}；销量：${candidate.sold ?? '未知'}；评分：${candidate.rating ?? '未知'}\n\n确定性规则已无法完全判断，当前原因：${[...(candidate.reasons || []), ...(candidate.unknown || [])].join('；')}\n\n商品筛选备用提示词：\n${prompts.filterPrompt || '(空)'}\n\n限制规则备用提示词：\n${prompts.limitPrompt || '(空)'}\n\n返回：{"decision":"pass|review|excluded","confidence":0到1,"reasons":["简短理由"]}。如果信息不足必须用 review；不要把兼容某品牌的字样自动当作侵权商标。`;
    const text = await callText(profile, system, user);
    const obj = parseJsonLoose(text);
    const decision = ['pass', 'review', 'excluded'].includes(obj?.decision) ? obj.decision : 'review';
    const confidence = Math.max(0, Math.min(1, Number(obj?.confidence) || 0));
    return {
      decision: confidence >= 0.75 ? decision : 'review',
      confidence,
      reasons: Array.isArray(obj?.reasons) ? obj.reasons.map(String).slice(0, 5) : []
    };
  }

  root.TemuAI = {
    PROVIDERS,
    ensureOriginPermission,
    callText,
    parseJsonLoose,
    expandKeywords,
    reviewCandidate
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
