import { decryptJson } from './security.js';

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }
function joinUrl(base, path) {
  const b = trimSlash(base);
  const p = String(path || '').startsWith('/') ? path : `/${path || ''}`;
  return `${b}${p}`;
}
function asInt(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
function normalizeUsage(data) {
  const u = data?.usage || data?.result?.usage || {};
  const input = asInt(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens);
  const output = asInt(u.completion_tokens ?? u.output_tokens ?? u.outputTokens);
  return { input_tokens: input, output_tokens: output, total_tokens: asInt(u.total_tokens) || input + output };
}
function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(x => x?.type === 'text' || typeof x === 'string').map(x => typeof x === 'string' ? x : x.text || '').join('\n');
}
function findDataImage(messages) {
  for (const m of messages || []) {
    for (const part of Array.isArray(m?.content) ? m.content : []) {
      const url = part?.image_url?.url || part?.image_url || '';
      if (part?.type === 'image_url' && /^data:image\//i.test(url)) return url;
    }
  }
  return null;
}

async function fetchJson(url, init, timeoutMs = 90000) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw_text: text }; }
    if (!res.ok) throw Object.assign(new Error(data?.error?.message || data?.message || text.slice(0, 800) || `HTTP ${res.status}`), { status: res.status, upstream: data });
    return data;
  } finally { clearTimeout(timer); }
}

function openAiResponse(model, content, usage = {}, raw = null) {
  return {
    id: `chatcmpl-relay-${crypto.randomUUID()}`,
    object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: 'assistant', content: String(content || '') }, finish_reason: 'stop' }],
    usage: { prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0, total_tokens: usage.total_tokens || 0 },
    relay: raw ? { upstream_request_id: raw?.id || null } : undefined
  };
}

async function runOpenAICompatible(channel, model, body, creds) {
  const url = joinUrl(channel.base_url, channel.api_path || '/v1/chat/completions');
  const headers = { 'content-type': 'application/json', ...(creds.headers || {}) };
  if (creds.api_key && !headers.Authorization && !headers.authorization) headers.Authorization = `Bearer ${creds.api_key}`;
  const payload = { ...body, model: model.model_id, stream: false };
  delete payload.relay_metadata;
  const data = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  return { response: data, usage: normalizeUsage(data) };
}

function anthropicContent(content) {
  if (typeof content === 'string') return content;
  const out = [];
  for (const p of content || []) {
    if (p?.type === 'text') out.push({ type: 'text', text: p.text || '' });
    if (p?.type === 'image_url') {
      const url = p?.image_url?.url || p?.image_url || '';
      const m = String(url).match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
      if (m) out.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }
  }
  return out;
}

async function runAnthropic(channel, model, body, creds) {
  const url = joinUrl(channel.base_url || 'https://api.anthropic.com', channel.api_path || '/v1/messages');
  const system = (body.messages || []).filter(x => x.role === 'system').map(x => textFromContent(x.content)).join('\n');
  const messages = (body.messages || []).filter(x => x.role !== 'system').map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: anthropicContent(x.content) }));
  const headers = { 'content-type': 'application/json', 'anthropic-version': creds.anthropic_version || '2023-06-01', ...(creds.headers || {}) };
  if (creds.api_key) headers['x-api-key'] = creds.api_key;
  const data = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify({ model: model.model_id, max_tokens: body.max_tokens || 1200, system, messages }) });
  const content = (data.content || []).filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
  const usage = { input_tokens: asInt(data?.usage?.input_tokens), output_tokens: asInt(data?.usage?.output_tokens) };
  usage.total_tokens = usage.input_tokens + usage.output_tokens;
  return { response: openAiResponse(model.public_id, content, usage, data), usage };
}

function geminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  const out = [];
  for (const p of content || []) {
    if (p?.type === 'text') out.push({ text: p.text || '' });
    if (p?.type === 'image_url') {
      const url = p?.image_url?.url || p?.image_url || '';
      const m = String(url).match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
      if (m) out.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
  }
  return out;
}

async function runGemini(channel, model, body, creds) {
  const path = channel.api_path || `/v1beta/models/${encodeURIComponent(model.model_id)}:generateContent`;
  const url = joinUrl(channel.base_url || 'https://generativelanguage.googleapis.com', path);
  const systemText = (body.messages || []).filter(x => x.role === 'system').map(x => textFromContent(x.content)).join('\n');
  const contents = (body.messages || []).filter(x => x.role !== 'system').map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: geminiParts(x.content) }));
  const headers = { 'content-type': 'application/json', ...(creds.headers || {}) };
  if (creds.api_key) headers['x-goog-api-key'] = creds.api_key;
  const data = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify({ systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined, contents, generationConfig: { maxOutputTokens: body.max_tokens || 1200 } }) });
  const content = (data?.candidates?.[0]?.content?.parts || []).map(p => p?.text || '').join('\n');
  const um = data?.usageMetadata || {};
  const usage = { input_tokens: asInt(um.promptTokenCount), output_tokens: asInt(um.candidatesTokenCount), total_tokens: asInt(um.totalTokenCount) };
  return { response: openAiResponse(model.public_id, content, usage, data), usage };
}

async function runWorkersAI(env, model, body) {
  if (!env.AI) throw new Error('Workers AI binding 未配置');
  const image = findDataImage(body.messages);
  const messages = (body.messages || []).map(m => ({ role: m.role, content: textFromContent(m.content) }));
  const input = { messages, max_tokens: body.max_tokens || 1200, stream: false };
  if (image) input.image = image;
  const data = await env.AI.run(model.model_id, input);
  const content = data?.response ?? data?.result?.response ?? data?.choices?.[0]?.message?.content ?? '';
  const usage = normalizeUsage(data);
  return { response: openAiResponse(model.public_id, content, usage, data), usage };
}

export async function runUpstream(env, channel, model, body) {
  const creds = await decryptJson(env.UPSTREAM_MASTER_KEY, channel.credentials_enc);
  if (channel.protocol === 'workers_ai') return runWorkersAI(env, model, body);
  if (channel.protocol === 'anthropic') return runAnthropic(channel, model, body, creds);
  if (channel.protocol === 'gemini') return runGemini(channel, model, body, creds);
  return runOpenAICompatible(channel, model, body, creds);
}

export function estimateCost(model, usage) {
  const inputRate = Number(model.input_cost_per_million || 0);
  const outputRate = Number(model.output_cost_per_million || 0);
  return (Number(usage.input_tokens || 0) / 1_000_000) * inputRate + (Number(usage.output_tokens || 0) / 1_000_000) * outputRate;
}
