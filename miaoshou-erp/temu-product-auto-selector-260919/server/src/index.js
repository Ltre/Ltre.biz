import { nowIso, plusMinutes, plusDays, randomHex, sha256Hex, sha1Hex, safeEqualText, encryptJson } from './security.js';
import { runUpstream, estimateCost } from './providers.js';

const PHONE_RE = /^1[3-9]\d{9}$/;

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '*';
  const allow = String(env.ALLOWED_ORIGINS || '*').split(',').map(x => x.trim()).filter(Boolean);
  const allowed = allow.includes('*') || allow.includes(origin) || origin.startsWith('chrome-extension://');
  return {
    'access-control-allow-origin': allowed ? origin : 'null',
    'access-control-allow-headers': 'authorization,content-type,x-admin-token',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}
function json(data, status = 200, extra = {}) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json;charset=utf-8', ...extra } }); }
function xml(data, status = 200) { return new Response(data, { status, headers: { 'content-type': 'application/xml;charset=utf-8' } }); }
function withCors(resp, request, env) { const h = new Headers(resp.headers); for (const [k,v] of Object.entries(corsHeaders(request, env))) h.set(k,v); return new Response(resp.body, { status: resp.status, headers: h }); }
async function readJson(request) { try { return await request.json(); } catch { throw Object.assign(new Error('请求 JSON 无效'), { status: 400 }); } }
function err(message, status = 400, code = 'bad_request') { return Object.assign(new Error(message), { status, code }); }
function asBool(v) { return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'; }
function publicModelId(channelSlug, modelId) { return `${channelSlug}/${modelId}`; }

async function authUser(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw err('未登录', 401, 'unauthorized');
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(`SELECT s.id session_id,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? LIMIT 1`).bind(hash).first();
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) throw err('登录已过期', 401, 'session_expired');
  if (row.status !== 'active') throw err('用户已暂停', 403, 'user_suspended');
  env.DB.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').bind(nowIso(), row.session_id).run().catch(() => {});
  return row;
}
function requireAdmin(request, env) {
  const token = request.headers.get('x-admin-token') || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || !safeEqualText(token, env.ADMIN_TOKEN)) throw err('管理员鉴权失败', 401, 'admin_unauthorized');
}

function parseXmlTag(xmlText, tag) {
  const m = String(xmlText).match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return (m?.[1] ?? m?.[2] ?? '').trim();
}
function escapeXml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function wechatReply(to, from, content) {
  return `<xml><ToUserName><![CDATA[${to}]]></ToUserName><FromUserName><![CDATA[${from}]]></FromUserName><CreateTime>${Math.floor(Date.now()/1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${String(content).replace(/\]\]>/g,'] ]>')}]]></Content></xml>`;
}
async function verifyWechatSignature(url, env) {
  if (!env.WECHAT_TOKEN) return false;
  const timestamp = url.searchParams.get('timestamp') || '';
  const nonce = url.searchParams.get('nonce') || '';
  const signature = url.searchParams.get('signature') || '';
  const raw = [env.WECHAT_TOKEN, timestamp, nonce].sort().join('');
  return safeEqualText(await sha1Hex(raw), signature);
}

async function getWechatAccessToken(env) {
  const cached = await env.DB.prepare(`SELECT cache_value,expires_at FROM runtime_cache WHERE cache_key='wechat_access_token'`).first();
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60000) return cached.cache_value;
  if (!env.WECHAT_APPID || !env.WECHAT_SECRET) throw err('WECHAT_APPID/WECHAT_SECRET 未配置', 500, 'wechat_not_configured');
  const u = new URL('https://api.weixin.qq.com/cgi-bin/token');
  u.searchParams.set('grant_type', 'client_credential'); u.searchParams.set('appid', env.WECHAT_APPID); u.searchParams.set('secret', env.WECHAT_SECRET);
  const res = await fetch(u); const data = await res.json();
  if (!res.ok || !data.access_token) throw err(`获取微信 access_token 失败：${data.errmsg || res.status}`, 502, 'wechat_token_failed');
  const expiry = new Date(Date.now() + Math.max(300, Number(data.expires_in || 7200) - 180) * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO runtime_cache(cache_key,cache_value,expires_at,updated_at) VALUES('wechat_access_token',?,?,?) ON CONFLICT(cache_key) DO UPDATE SET cache_value=excluded.cache_value,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(data.access_token, expiry, nowIso()).run();
  return data.access_token;
}
async function deliverLoginCode(env, user, code) {
  const mode = env.WECHAT_DELIVERY || 'mock';
  if (mode === 'mock') {
    if (env.AUDIT_BUCKET) await env.AUDIT_BUCKET.put(`dev-otp/${user.phone}.json`, JSON.stringify({ phone: user.phone, code, at: nowIso() }), { httpMetadata: { contentType: 'application/json' } });
    return { mode, delivered: true, dev_code: asBool(env.DEV_MODE) ? code : undefined };
  }
  if (!user.wechat_openid) throw err('该手机号尚未绑定公众号 OpenID，请先关注公众号并发送 reg:手机号 完成注册', 409, 'wechat_not_bound');
  const accessToken = await getWechatAccessToken(env);
  const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ touser: user.wechat_openid, msgtype: 'text', text: { content: `登录验证码：${code}，${Number(env.OTP_TTL_MINUTES || 5)} 分钟内有效。若非本人操作请忽略。` } }) });
  const data = await res.json();
  if (!res.ok || Number(data.errcode || 0) !== 0) throw err(`微信验证码发送失败：${data.errmsg || res.status}`, 502, 'wechat_send_failed');
  return { mode, delivered: true };
}

async function handleWechat(request, env, url) {
  if (!(await verifyWechatSignature(url, env))) throw err('微信签名校验失败', 403, 'wechat_bad_signature');
  if (request.method === 'GET') return new Response(url.searchParams.get('echostr') || '');
  const body = await request.text();
  if (parseXmlTag(body, 'Encrypt')) return xml(wechatReply(parseXmlTag(body,'FromUserName'), parseXmlTag(body,'ToUserName'), '当前服务仅启用公众号明文消息模式，请在公众号后台将消息加解密方式设为明文。'));
  const from = parseXmlTag(body, 'FromUserName'); const to = parseXmlTag(body, 'ToUserName');
  const msgType = parseXmlTag(body, 'MsgType'); const content = parseXmlTag(body, 'Content');
  if (msgType !== 'text') return xml(wechatReply(from, to, '请发送：reg:手机号，例如 reg:15911111111'));
  const m = content.match(/^\s*reg\s*[:：]\s*(1[3-9]\d{9})\s*$/i);
  if (!m) return xml(wechatReply(from, to, '注册格式：reg:手机号，例如 reg:15911111111'));
  const phone = m[1], t = nowIso();
  const existingByOpenid = await env.DB.prepare('SELECT id,phone FROM users WHERE wechat_openid=?').bind(from).first();
  if (existingByOpenid && existingByOpenid.phone !== phone) return xml(wechatReply(from, to, `当前微信已绑定手机号 ${existingByOpenid.phone}，如需更换请联系管理员。`));
  const existingPhone = await env.DB.prepare('SELECT id,wechat_openid FROM users WHERE phone=?').bind(phone).first();
  if (existingPhone?.wechat_openid && existingPhone.wechat_openid !== from) return xml(wechatReply(from, to, '该手机号已绑定其它微信账号，请联系管理员。'));
  if (existingPhone) await env.DB.prepare('UPDATE users SET wechat_openid=?,status=\'active\',updated_at=? WHERE id=?').bind(from,t,existingPhone.id).run();
  else await env.DB.prepare('INSERT INTO users(phone,wechat_openid,status,ai_enabled,created_at,updated_at) VALUES(?,?,\'active\',1,?,?)').bind(phone,from,t,t).run();
  return xml(wechatReply(from, to, `注册成功：${phone}。现在可在客户端使用该手机号获取登录验证码。`));
}

async function requestCode(request, env) {
  const body = await readJson(request); const phone = String(body.phone || '').trim();
  if (!PHONE_RE.test(phone)) throw err('手机号格式不正确');
  const user = await env.DB.prepare('SELECT * FROM users WHERE phone=?').bind(phone).first();
  if (!user) throw err('该手机号尚未注册，请先关注公众号并发送 reg:手机号', 404, 'not_registered');
  if (user.status !== 'active') throw err('用户已暂停', 403, 'user_suspended');
  const random = new Uint32Array(1); crypto.getRandomValues(random);
  const code = String(100000 + (random[0] % 900000));
  const hash = await sha256Hex(`${phone}:${code}:${env.LOGIN_CODE_SECRET || ''}`);
  const created = nowIso(), expires = plusMinutes(Number(env.OTP_TTL_MINUTES || 5));
  await env.DB.prepare('INSERT INTO login_codes(user_id,code_hash,expires_at,created_at) VALUES(?,?,?,?)').bind(user.id,hash,expires,created).run();
  const delivery = await deliverLoginCode(env, user, code);
  return json({ ok: true, expires_at: expires, delivery });
}
async function verifyCode(request, env) {
  const body = await readJson(request); const phone = String(body.phone || '').trim(); const code = String(body.code || '').trim();
  if (!PHONE_RE.test(phone) || !/^\d{6}$/.test(code)) throw err('手机号或验证码格式不正确');
  const user = await env.DB.prepare('SELECT * FROM users WHERE phone=?').bind(phone).first();
  if (!user || user.status !== 'active') throw err('用户不可登录', 403, 'user_unavailable');
  const row = await env.DB.prepare('SELECT * FROM login_codes WHERE user_id=? AND used_at IS NULL ORDER BY id DESC LIMIT 1').bind(user.id).first();
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) throw err('验证码已过期', 401, 'otp_expired');
  const expected = await sha256Hex(`${phone}:${code}:${env.LOGIN_CODE_SECRET || ''}`);
  if (!safeEqualText(expected, row.code_hash)) throw err('验证码错误', 401, 'otp_invalid');
  const token = `air_${randomHex(32)}`, tokenHash = await sha256Hex(token), t = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE login_codes SET used_at=? WHERE id=?').bind(t,row.id),
    env.DB.prepare('INSERT INTO sessions(user_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)').bind(user.id,tokenHash,plusDays(Number(env.SESSION_TTL_DAYS || 30)),t,t),
    env.DB.prepare('UPDATE users SET last_login_at=?,updated_at=? WHERE id=?').bind(t,t,user.id)
  ]);
  return json({ ok: true, token, user: { id: user.id, phone: user.phone, ai_enabled: !!user.ai_enabled } });
}
async function logout(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256Hex(token)).run();
  return json({ ok: true });
}

async function listModels(request, env) {
  const user = await authUser(request, env);
  const rows = await env.DB.prepare(`SELECT m.*,c.name channel_name,c.slug channel_slug,c.protocol FROM user_model_permissions p JOIN models m ON m.id=p.model_id JOIN channels c ON c.id=m.channel_id WHERE p.user_id=? AND p.allowed=1 AND m.enabled=1 AND c.enabled=1 ORDER BY c.name,m.display_name,m.model_id`).bind(user.id).all();
  const groups = new Map();
  for (const r of rows.results || []) {
    const key = r.channel_slug; if (!groups.has(key)) groups.set(key,{ id:key,name:r.channel_name,protocol:r.protocol,models:[] });
    let capabilities = {}; try { capabilities = JSON.parse(r.capabilities_json || '{}'); } catch {}
    groups.get(key).models.push({ id: publicModelId(r.channel_slug,r.model_id), model_id:r.model_id, name:r.display_name || r.model_id, capabilities });
  }
  return json({ ok:true, ai_enabled:!!user.ai_enabled, channels:[...groups.values()] });
}
async function resolveAllowedModel(env, userId, publicId) {
  const slash = String(publicId || '').indexOf('/'); if (slash <= 0) throw err('model 必须使用 channel/model-id 格式',400,'bad_model');
  const channelSlug = publicId.slice(0,slash), modelId = publicId.slice(slash+1);
  const row = await env.DB.prepare(`SELECT m.*,c.name channel_name,c.slug channel_slug,c.protocol,c.base_url,c.api_path,c.credentials_enc,c.enabled channel_enabled,p.allowed FROM models m JOIN channels c ON c.id=m.channel_id JOIN user_model_permissions p ON p.model_id=m.id AND p.user_id=? WHERE c.slug=? AND m.model_id=? LIMIT 1`).bind(userId,channelSlug,modelId).first();
  if (!row || !row.allowed || !row.enabled || !row.channel_enabled) throw err('当前用户无权使用该渠道/模型',403,'model_forbidden');
  row.public_id = publicId;
  return { model: row, channel: { id:row.channel_id,name:row.channel_name,slug:row.channel_slug,protocol:row.protocol,base_url:row.base_url,api_path:row.api_path,credentials_enc:row.credentials_enc } };
}
async function chatCompletions(request, env) {
  const user = await authUser(request, env); if (!user.ai_enabled) throw err('该用户 AI 推理权限已暂停',403,'ai_disabled');
  const body = await readJson(request); if (!Array.isArray(body.messages) || !body.messages.length) throw err('messages 不能为空');
  const { model, channel } = await resolveAllowedModel(env,user.id,body.model);
  const reqId = crypto.randomUUID(), started = Date.now(); let status='success', errorCode=null, usage={input_tokens:0,output_tokens:0,total_tokens:0}, response;
  try {
    const out = await runUpstream(env,channel,model,body); response=out.response; usage=out.usage || usage;
    response.model = model.public_id;
    if (asBool(env.STORE_AI_PAYLOADS) && env.AUDIT_BUCKET) await env.AUDIT_BUCKET.put(`ai/${nowIso().slice(0,10)}/${reqId}.json`, JSON.stringify({ request:{...body,authorization:undefined}, response, at:nowIso(), user_id:user.id }), { httpMetadata:{contentType:'application/json'} });
  } catch (e) { status='error'; errorCode=String(e?.status || 'upstream_error'); throw e; }
  finally {
    const cost = estimateCost(model,usage); const latency=Date.now()-started;
    await env.DB.prepare(`INSERT INTO usage_logs(request_id,user_id,channel_id,model_pk,public_model_id,upstream_model_id,input_tokens,output_tokens,total_tokens,estimated_cost_usd,latency_ms,status,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(reqId,user.id,channel.id,model.id,model.public_id,model.model_id,usage.input_tokens||0,usage.output_tokens||0,usage.total_tokens||0,cost,latency,status,errorCode,nowIso()).run().catch(()=>{});
  }
  response.relay = { ...(response.relay || {}), request_id:reqId, channel:channel.slug, usage_estimated_cost_usd:estimateCost(model,usage) };
  return json(response);
}

async function adminUsers(request, env) {
  requireAdmin(request,env);
  const rows=await env.DB.prepare(`SELECT u.*,COALESCE(x.calls,0) calls,COALESCE(x.tokens,0) tokens,COALESCE(x.cost,0) cost FROM users u LEFT JOIN (SELECT user_id,COUNT(*) calls,SUM(total_tokens) tokens,SUM(estimated_cost_usd) cost FROM usage_logs GROUP BY user_id) x ON x.user_id=u.id ORDER BY u.id DESC`).all();
  const perms=await env.DB.prepare('SELECT user_id,model_id FROM user_model_permissions WHERE allowed=1').all();
  const map=new Map(); for(const p of perms.results||[]){if(!map.has(p.user_id))map.set(p.user_id,[]);map.get(p.user_id).push(p.model_id);}
  return json({ok:true,users:(rows.results||[]).map(u=>({...u,model_ids:map.get(u.id)||[]}))});
}
async function adminPatchUser(request, env, userId) {
  requireAdmin(request,env); const b=await readJson(request); const sets=[],vals=[];
  if ('ai_enabled' in b){sets.push('ai_enabled=?');vals.push(asBool(b.ai_enabled)?1:0);} if ('status' in b){sets.push('status=?');vals.push(b.status==='active'?'active':'paused');}
  if(!sets.length) throw err('没有可更新字段'); sets.push('updated_at=?');vals.push(nowIso(),Number(userId));
  await env.DB.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).bind(...vals).run(); return json({ok:true});
}
async function adminPermissions(request, env, userId) {
  requireAdmin(request,env); const b=await readJson(request); const ids=[...new Set((b.model_ids||[]).map(Number).filter(Number.isInteger))],t=nowIso();
  const stmts=[env.DB.prepare('DELETE FROM user_model_permissions WHERE user_id=?').bind(Number(userId))];
  for(const id of ids) stmts.push(env.DB.prepare('INSERT INTO user_model_permissions(user_id,model_id,allowed,created_at,updated_at) VALUES(?,?,1,?,?)').bind(Number(userId),id,t,t));
  await env.DB.batch(stmts); return json({ok:true,count:ids.length});
}
async function adminChannels(request, env) {
  requireAdmin(request,env);
  if(request.method==='GET'){
    const ch=await env.DB.prepare(`SELECT c.*,CASE WHEN c.credentials_enc IS NULL OR c.credentials_enc='' THEN 0 ELSE 1 END has_credentials FROM channels c ORDER BY c.id`).all();
    const models=await env.DB.prepare('SELECT * FROM models ORDER BY channel_id,id').all();
    return json({ok:true,channels:(ch.results||[]).map(c=>({...c,credentials_enc:undefined,models:(models.results||[]).filter(m=>m.channel_id===c.id).map(m=>({...m,capabilities:JSON.parse(m.capabilities_json||'{}')}))}))});
  }
  const b=await readJson(request); if(!b.name||!b.slug||!b.protocol) throw err('name/slug/protocol 必填');
  const t=nowIso(); const encCred=b.credentials?await encryptJson(env.UPSTREAM_MASTER_KEY,b.credentials):null;
  const r=await env.DB.prepare(`INSERT INTO channels(name,slug,protocol,base_url,api_path,credentials_enc,enabled,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(b.name,String(b.slug).toLowerCase().replace(/[^a-z0-9-]/g,'-'),b.protocol,b.base_url||null,b.api_path||null,encCred,b.enabled===false?0:1,b.notes||null,t,t).run();
  return json({ok:true,id:r.meta?.last_row_id},201);
}
async function adminPatchChannel(request, env, channelId) {
  requireAdmin(request,env); const b=await readJson(request),sets=[],vals=[];
  for(const [k,col] of [['name','name'],['protocol','protocol'],['base_url','base_url'],['api_path','api_path'],['notes','notes']]) if(k in b){sets.push(`${col}=?`);vals.push(b[k]||null);}
  if('enabled' in b){sets.push('enabled=?');vals.push(asBool(b.enabled)?1:0);} if(b.credentials){sets.push('credentials_enc=?');vals.push(await encryptJson(env.UPSTREAM_MASTER_KEY,b.credentials));}
  sets.push('updated_at=?');vals.push(nowIso(),Number(channelId)); await env.DB.prepare(`UPDATE channels SET ${sets.join(',')} WHERE id=?`).bind(...vals).run(); return json({ok:true});
}
async function adminAddModel(request, env, channelId) {
  requireAdmin(request,env); const b=await readJson(request); if(!b.model_id) throw err('model_id 必填'); const t=nowIso();
  const cap=JSON.stringify(b.capabilities||{}); const r=await env.DB.prepare(`INSERT INTO models(channel_id,model_id,display_name,enabled,capabilities_json,input_cost_per_million,output_cost_per_million,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(Number(channelId),b.model_id,b.display_name||b.model_id,b.enabled===false?0:1,cap,b.input_cost_per_million??null,b.output_cost_per_million??null,t,t).run(); return json({ok:true,id:r.meta?.last_row_id},201);
}
async function adminUpdateModel(request, env, modelPk) {
  requireAdmin(request,env); const b=await readJson(request),sets=[],vals=[];
  if('model_id' in b){sets.push('model_id=?');vals.push(String(b.model_id).trim());}
  if('display_name' in b){sets.push('display_name=?');vals.push(b.display_name||null);}
  if('enabled' in b){sets.push('enabled=?');vals.push(asBool(b.enabled)?1:0);}
  if('capabilities' in b){sets.push('capabilities_json=?');vals.push(JSON.stringify(b.capabilities||{}));}
  if('input_cost_per_million' in b){sets.push('input_cost_per_million=?');vals.push(b.input_cost_per_million==null?null:Number(b.input_cost_per_million));}
  if('output_cost_per_million' in b){sets.push('output_cost_per_million=?');vals.push(b.output_cost_per_million==null?null:Number(b.output_cost_per_million));}
  if(!sets.length) throw err('没有可更新字段');
  sets.push('updated_at=?'); vals.push(nowIso(),Number(modelPk));
  const r=await env.DB.prepare(`UPDATE models SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();
  if(!(Number(r.meta?.changes)>0)) throw err('模型不存在',404,'model_not_found');
  return json({ok:true});
}
async function adminDeleteModel(request, env, modelPk) {
  requireAdmin(request,env);
  const used=await env.DB.prepare('SELECT COUNT(*) n FROM usage_logs WHERE model_pk=?').bind(Number(modelPk)).first();
  if(Number(used?.n||0)>0) throw err('该模型已有调用记录，无法删除；如需停用请使用启用/停用开关',409,'model_has_usage');
  const r=await env.DB.prepare('DELETE FROM models WHERE id=?').bind(Number(modelPk)).run();
  if(!(Number(r.meta?.changes)>0)) throw err('模型不存在',404,'model_not_found');
  return json({ok:true});
}
async function adminDeleteChannel(request, env, channelId) {
  requireAdmin(request,env);
  const used=await env.DB.prepare('SELECT COUNT(*) n FROM usage_logs WHERE channel_id=?').bind(Number(channelId)).first();
  if(Number(used?.n||0)>0) throw err('该渠道已有调用记录，无法删除；如需停用请使用启用/停用开关',409,'channel_has_usage');
  const r=await env.DB.prepare('DELETE FROM channels WHERE id=?').bind(Number(channelId)).run();
  if(!(Number(r.meta?.changes)>0)) throw err('渠道不存在',404,'channel_not_found');
  return json({ok:true});
}
async function adminUsage(request, env, url) {
  requireAdmin(request,env); const from=url.searchParams.get('from')||'1970-01-01T00:00:00.000Z', to=url.searchParams.get('to')||'2999-12-31T23:59:59.999Z', userId=url.searchParams.get('user_id');
  const where=['l.created_at>=?','l.created_at<=?'],bind=[from,to]; if(userId){where.push('l.user_id=?');bind.push(Number(userId));}
  const rows=await env.DB.prepare(`SELECT l.user_id,u.phone,l.public_model_id,COUNT(*) calls,SUM(l.input_tokens) input_tokens,SUM(l.output_tokens) output_tokens,SUM(l.total_tokens) total_tokens,SUM(l.estimated_cost_usd) estimated_cost_usd,AVG(l.latency_ms) avg_latency_ms,SUM(CASE WHEN l.status='error' THEN 1 ELSE 0 END) errors FROM usage_logs l JOIN users u ON u.id=l.user_id WHERE ${where.join(' AND ')} GROUP BY l.user_id,l.public_model_id ORDER BY calls DESC`).bind(...bind).all(); return json({ok:true,from,to,rows:rows.results||[]});
}
async function adminDiagnostics(request, env) {
  requireAdmin(request,env); const out={d1:null,r2:null,workers_ai:null};
  try{const x=await env.DB.prepare('SELECT COUNT(*) n FROM users').first();out.d1={ok:true,users:Number(x?.n||0)};}catch(e){out.d1={ok:false,error:e.message};}
  try{const key=`diagnostics/${crypto.randomUUID()}.txt`;await env.AUDIT_BUCKET.put(key,'ok');const o=await env.AUDIT_BUCKET.get(key);out.r2={ok:!!o,text:o?await o.text():null};await env.AUDIT_BUCKET.delete(key);}catch(e){out.r2={ok:false,error:e.message};}
  try{const model='@cf/meta/llama-3.2-3b-instruct';const r=await env.AI.run(model,{messages:[{role:'user',content:'Reply with OK only.'}],max_tokens:8});out.workers_ai={ok:true,model,response:r?.response||r?.result?.response||r?.choices?.[0]?.message?.content||r};}catch(e){out.workers_ai={ok:false,error:e.message};}
  return json({ok:true,diagnostics:out});
}
async function devRegister(request, env) {
  if(!asBool(env.DEV_MODE)) throw err('仅 DEV_MODE 可用',404); const b=await readJson(request); const phone=String(b.phone||'').trim(); if(!PHONE_RE.test(phone)) throw err('手机号格式错误'); const t=nowIso();
  await env.DB.prepare(`INSERT INTO users(phone,wechat_openid,status,ai_enabled,created_at,updated_at) VALUES(?,?,'active',1,?,?) ON CONFLICT(phone) DO UPDATE SET updated_at=excluded.updated_at`).bind(phone,b.wechat_openid||`dev_${phone}`,t,t).run(); return json({ok:true,phone});
}

async function route(request, env) {
  const url=new URL(request.url), p=url.pathname;
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders(request,env)});
  if(p==='/health') return json({ok:true,service:'generic-ai-relay',time:nowIso()});
  if(p==='/webhook/wechat') return handleWechat(request,env,url);
  if(p==='/api/auth/request-code'&&request.method==='POST') return requestCode(request,env);
  if(p==='/api/auth/verify-code'&&request.method==='POST') return verifyCode(request,env);
  if(p==='/api/auth/logout'&&request.method==='POST') return logout(request,env);
  if(p==='/api/me'&&request.method==='GET'){const u=await authUser(request,env);return json({ok:true,user:{id:u.id,phone:u.phone,ai_enabled:!!u.ai_enabled,status:u.status}});}
  if(p==='/api/models'&&request.method==='GET') return listModels(request,env);
  if(p==='/v1/chat/completions'&&request.method==='POST') return chatCompletions(request,env);
  if(p==='/api/admin/users'&&request.method==='GET') return adminUsers(request,env);
  let m=p.match(/^\/api\/admin\/users\/(\d+)$/); if(m&&request.method==='PATCH') return adminPatchUser(request,env,m[1]);
  m=p.match(/^\/api\/admin\/users\/(\d+)\/permissions$/); if(m&&request.method==='PUT') return adminPermissions(request,env,m[1]);
  if(p==='/api/admin/channels'&&(request.method==='GET'||request.method==='POST')) return adminChannels(request,env);
  m=p.match(/^\/api\/admin\/channels\/(\d+)$/);
  if(m&&request.method==='PATCH') return adminPatchChannel(request,env,m[1]);
  if(m&&request.method==='DELETE') return adminDeleteChannel(request,env,m[1]);
  m=p.match(/^\/api\/admin\/channels\/(\d+)\/models$/); if(m&&request.method==='POST') return adminAddModel(request,env,m[1]);
  m=p.match(/^\/api\/admin\/models\/(\d+)$/);
  if(m&&request.method==='PATCH') return adminUpdateModel(request,env,m[1]);
  if(m&&request.method==='DELETE') return adminDeleteModel(request,env,m[1]);
  if(p==='/api/admin/usage'&&request.method==='GET') return adminUsage(request,env,url);
  if(p==='/api/admin/diagnostics'&&request.method==='POST') return adminDiagnostics(request,env);
  if(p==='/api/dev/register'&&request.method==='POST') return devRegister(request,env);
  if(env.ASSETS) return env.ASSETS.fetch(request);
  throw err('Not found',404,'not_found');
}

export default {
  async fetch(request, env) {
    try { return withCors(await route(request,env),request,env); }
    catch(e){const status=Number(e?.status)||500; return withCors(json({ok:false,error:{code:e?.code||'internal_error',message:e?.message||String(e)}},status),request,env);}
  }
};

export { publicModelId, parseXmlTag };
